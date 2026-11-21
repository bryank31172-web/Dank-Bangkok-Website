/* POST /api/order — receives an order from the storefront checkout.
   The order is always written to storage first, then offered to every channel
   that is configured (all optional, any combination):
     - Telegram / LINE / WhatsApp   → staff phones buzz
     - Shopify (dankbangkok.com)        → created as an unpaid order, see _shopify.js
     - RESEND_API_KEY set           → emailed to ORDER_EMAIL_TO
       (default dankclubbkk@gmail.com) via resend.com (free tier).
   Returns {ok:true, orderId} whenever the order was written down, whatever
   the channels did — see the comment at the bottom for why that matters.
   502 is only for the case where nothing anywhere knows the order exists.
   Paying by Wallet reserves the amount instead of spending it: the reply
   carries {walletPending:true, balance} and staff settle it from the
   console. See the wallet block below for why.                       */

import { createDelivery } from "./_delivery.js";
import { getJSON, setJSON, indexAdd, bump } from "./_store.js";
import { listAccounts } from "./_staff-accounts.js";
import { normPhone } from "./_phone.js";
import { getBalance } from "./_wallet.js";
import { boxesInOrder, issueGifts, giftAlertLines, getGiftConfig } from "./_boxgifts.js";
import { recordPromotionRedemption } from "./_promotion.js";
import { getMenu } from "./_menu.js";
import { notifyStaffLine, lineMessages } from "./_line.js";
import { deliveryOrderCard, createLinkCard } from "./_delivery-line.js";
import { notifyStaffWhatsApp } from "./_whatsapp.js";
import { pushShopifyOrder } from "./_shopify.js";
import { requireRate } from "./_ratelimit.js";
import { validatePromotion, normalizePromotionCode } from "./_promotion.js";
import { computeEta } from "./_route.js";
import { deliveryQuote } from "./_delivery-fee.js";
import { priceOrderItems, assertPriceVerified, OrderInputError } from "./_order-pricing.js";

const OWNER_EMAIL = process.env.ORDER_EMAIL_TO || "dankclubbkk@gmail.com";

const pad2 = (value) => String(value).padStart(2, "0");
function formattedOrderId(fulfilment, minuteOffset = 0) {
  const bangkok = new Date(Date.now() + (7 * 60 + minuteOffset) * 60 * 1000);
  const prefix = fulfilment === "delivery" ? "DR" : "AS";
  return prefix
    + pad2(bangkok.getUTCDate())
    + pad2(bangkok.getUTCMonth() + 1)
    + bangkok.getUTCFullYear()
    + pad2(bangkok.getUTCHours())
    + pad2(bangkok.getUTCMinutes());
}
async function newOrderId(fulfilment) {
  /* Keep the requested minute-based ID readable while preventing two orders
     received in the same minute from overwriting one another. A collision uses
     the next unused minute code. */
  for (let offset = 0; offset < 60; offset++) {
    const candidate = formattedOrderId(fulfilment, offset);
    if (!(await getJSON("order:" + candidate))) return candidate;
  }
  throw new Error("could not allocate order id");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireRate(req, res, "order", 12, 600))) return;

  const o = req.body || {};
  /* Fields only the server (or staff, or a verified payment) may set. The
     whole body is stored as the order, so without this a browser could send
     payStatus:"paid" and the staff console would show an unpaid order as
     PAID, or pre-reserve a wallet amount, or tag the sale to any store. */
  for (const k of ["orderId", "at", "status", "payStatus", "paidAt", "paidBy", "chargeId", "walletReserved", "walletAmount",
    "walletBalance", "walletSettled", "walletSettledAt", "walletBalanceAfter", "slipUploaded", "priceAdjusted",
    "priceUnverified", "priceIssues", "box", "storeId"]) delete o[k];
  const TABLE_NAMES = ["T1", "T2", "T3", "T4", "T5", "T6", "Bar 1", "Bar 2", "C1", "C2", "C3", "C4", "C5", "C6", "C7"];
  const norm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, "");
  const matchedTable =
    o.fulfilment === "table" ? TABLE_NAMES.find((t) => norm(t) === norm(o.table)) : null;
  if (matchedTable) {
    o.table = matchedTable;
    o.tableLabel = matchedTable === "C7" ? "C7 - 2nd Floor VIP" : matchedTable;
    o.customer = { ...(o.customer || {}) };
    if (!o.customer.phone) o.customer.phone = "TABLE-" + matchedTable.replace(/\s+/g, "");
    if (!o.customer.name) o.customer.name = matchedTable;
  }
  if (!o.items?.length || !o.customer?.phone) {
    return res.status(400).json({ error: "invalid order" });
  }
  const orderId = await newOrderId(o.fulfilment);

  /* Every line is re-priced on the server (api/_order-pricing.js). The
     browser's prices, subtotal and total are never used as the amount owed.
     Lines the menu cannot price mark the order priceUnverified: it is still
     taken, but no online payment path will charge it (assertPriceVerified). */
  let menu = [];
  try {
    ({ data: menu } = await getMenu());
  } catch (e) {
    console.error("menu unavailable for pricing — every line will be unverified:", e.message);
  }
  let priced;
  try {
    priced = priceOrderItems(o.items, menu, { member: o.member === true });
  } catch (e) {
    if (e instanceof OrderInputError) return res.status(400).json({ error: "invalid order", detail: e.message });
    throw e;
  }
  o.priceAdjusted = priced.adjusted;
  o.priceUnverified = priced.unverified.length > 0;
  o.priceIssues = priced.unverified.slice(0, 20);

  const submittedPromotion = normalizePromotionCode(o.promo);
  const authoritativeSubtotal = priced.subtotal;
  // The fee is never taken from the browser: it is worked out here from the
  // customer's pin (or typed address) by road distance. See _delivery-fee.js.
  let submittedDeliveryFee = 0;
  // Set only from quote.branch below, never read back from o.delivery.branch
  // afterward: o.delivery is spread from client input a few lines down, so a
  // client-supplied `delivery.branch` would otherwise survive untouched
  // whenever quote.branch comes back empty (the fallback-fee path) and reach
  // the store-attribution block below as if it were server-resolved.
  let resolvedDeliveryBranchId = null;
  // Only deliveries pay a delivery fee. This used to run for every non-table
  // order, so pickup orders silently gained the ฿100 "distance unknown"
  // fallback fee that the storefront never showed the customer.
  if (o.fulfilment === "delivery" && !matchedTable) {
    const c = o.delivery?.coordinates;
    const hasPin = c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng));
    const address = String(o.delivery?.zone || "").trim().slice(0, 500);
    let eta = null;
    try {
      if (hasPin) eta = await computeEta({ destLat: Number(c.lat), destLng: Number(c.lng) });
      else if (address) eta = await computeEta({ address });
    } catch (e) {
      console.error("delivery distance skipped:", e.message);
    }
    const quote = deliveryQuote(eta);
    submittedDeliveryFee = quote.fee;
    o.delivery = { ...(o.delivery || {}), km: quote.km, feeFallback: quote.fallback };
    if (quote.branch) { o.delivery.branch = quote.branch; resolvedDeliveryBranchId = String(quote.branch.id); }
  }
  if (submittedPromotion) {
    try {
      const promotion = await validatePromotion(submittedPromotion, authoritativeSubtotal, submittedDeliveryFee);
      if (!promotion.ok) return res.status(400).json({ error: "invalid promotion", reason: promotion.reason, minimum: promotion.minimum });
      o.promo = promotion.code;
      o.promoGift = promotion.promotion?.type === "gift" ? promotion.promotion.gift : "";
      o.discount = promotion.discount;
      o.deliveryFee = promotion.deliveryFee;
      o.subtotal = authoritativeSubtotal;
      o.total = promotion.total;
    } catch (error) {
      console.error("promotion validation failed:", error.message);
      return res.status(503).json({ error: "promotion validation unavailable" });
    }
  } else {
    o.promo = "";
    o.discount = 0;
    o.deliveryFee = submittedDeliveryFee;
    o.subtotal = authoritativeSubtotal;
    o.total = Math.max(0, authoritativeSubtotal + submittedDeliveryFee);
  }

  if (o.payment === "Wallet") {
    if (!assertPriceVerified(o, res)) return;
    const amt = Math.round(Number(o.total ?? o.subtotal));
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "invalid amount" });
    const balance = await getBalance(o.customer?.phone);
    if (balance < amt) return res.status(402).json({ error: "insufficient wallet", balance });
    o.payStatus = "wallet_pending";
    o.walletReserved = true;
    o.walletAmount = amt;
    o.walletBalance = balance;
  }
  const walletInfo = o.walletReserved ? { walletPending: true, balance: o.walletBalance } : {};

  let giftLines = [];
  try {
    const { threshold } = await getGiftConfig();
    const { grams, boxes } = boxesInOrder(o.items, threshold);
    if (boxes >= 1) {
      giftLines = await issueGifts(boxes);
      o.box = {
        boxes,
        grams,
        threshold,
        gifts: giftLines.map((g) => ({
          id: g.id, label: g.label, qty: g.qty, remaining: g.remaining, short: Boolean(g.short),
        })),
        short: giftLines.filter((g) => g.short).map((g) => g.id),
      };
    }
  } catch (e) {
    console.error("box gifts skipped:", e.message);
  }

  const giftBlock = giftLines.length
    ? `\n\n📦 CUSTOM BOX ×${o.box.boxes} (${o.box.grams}g) — set aside:\n${giftAlertLines(giftLines)}`
    : "";
  const giftHtml = giftLines.length
    ? `<p><b>📦 Custom box ×${o.box.boxes} (${o.box.grams}g) — set aside:</b><br>${esc(
        giftAlertLines(giftLines)
      ).replace(/\n/g, "<br>")}</p>`
    : "";

  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "www.dankbangkok.com";
  const itemLines = o.items
    .map((i) => `• ${i.name} (${i.option || ""}) ×${i.qty} — ฿${i.lineTotal}`)
    .join("\n");
  const tableDisplay = o.tableLabel || matchedTable;
  const feeNote = o.delivery?.feeFallback
    ? `฿${o.deliveryFee} delivery (flat — distance unknown, confirm with customer)`
    : `฿${o.deliveryFee} delivery (${o.delivery?.km} km)`;
  const where = matchedTable
    ? `🪑 TABLE ${tableDisplay} — bring it over`
    : o.fulfilment === "delivery"
    ? `🚚 Delivery — ${o.delivery?.zone || ""}\n${o.delivery?.address || ""}\n📏 ${feeNote}`
    : `🏬 Pickup — ${o.pickup?.branch || ""}${o.pickup?.time ? " at " + o.pickup.time : ""}`;
  const promoCode = String(o.promo || "").trim().toUpperCase().slice(0, 24);
  const promoBlock = promoCode
    ? `\n🎟️ Code: ${promoCode}${o.promoGift ? `  ← 🚬 ${String(o.promoGift).toUpperCase()}` : /^FREEJOINT$/.test(promoCode) ? "  ← 🚬 ADD ONE FREE JOINT" : ""}`
    : "";

  const priceWarning = o.priceUnverified
    ? `\n⚠️ PRICE NOT VERIFIED — check before taking payment: ${o.priceIssues.map((x) => `${x.name} (${x.reason})`).join("; ")}\n`
    : "";
  const staffAlert =
    `🛒 NEW ORDER ${orderId} — dankbangkok.com\n\n${itemLines}${giftBlock}${promoBlock}\n\n` +
    priceWarning +
    `Total: ฿${o.total ?? o.subtotal}${o.member ? " (member ⭐)" : ""}\n` +
    `Pay: ${o.payment}\n${where}\n` +
    `Customer: ${o.customer?.name || "-"} · ${o.customer?.phone}\n` +
    `${o.notes ? "Notes: " + o.notes + "\n" : ""}\n` +
    `➡️ Open: https://${host}/staffportal#orders`;

  const onlineStaffAlert =
    `🛒 NEW ORDER ${orderId}\n` +
    `Total: ฿${o.total ?? o.subtotal}\n` +
    (o.priceUnverified ? `⚠️ Price not verified — check before taking payment\n` : "") +
    `Type: ${o.fulfilment || "order"}\n` +
    `Open securely: https://${host}/staffportal#orders`;

  const results = [];
  let saved = false;
  const takenAt = Date.now();

  /* Store + product attribution for BackOffice reporting (sales-by-store,
     COGS — docs/dank-backoffice/DEPLOYMENT.md's "known gaps" #2). Two of its
     own try/catches, placed after everything above has already run: a
     failure here must never affect pricing, totals or whether the order
     saves, and nothing here is trusted from the client over what's already
     been resolved server-side — storeId comes only from
     resolvedDeliveryBranchId (set above, strictly from quote.branch, never
     from the client's own o.delivery), and productKey is only ever accepted
     from the client when it matches a real id in the live catalogue, never
     taken as-is. Both were previously trusting client-controlled fields
     (a client-supplied delivery.branch survived the fallback-fee path's
     empty quote.branch; item.id was accepted unchecked) — closed after a
     security review flagged the gap; low real-world impact since it only
     ever affected attribution of the client's own order, but worth closing
     since internal reports should never trust unvalidated client input.
       storeId: a delivery order already resolves a real branch by road
       distance (api/_route.js, via the fee quote earlier in this handler)
       whenever the route provider succeeds — that id is used as-is, never
       re-derived or guessed. When the route couldn't be resolved (fallback
       flat fee), no branch exists to use, so the order is left untagged
       rather than guessed. Table/dine-in orders (checkout.html's table flow)
       and food.html's orders (table or in-house pickup — it has no other
       fulfilment) have no per-branch data anywhere in the current client
       code: one shared table list serves every branch, not one list per
       branch. Those are attributed to DANK Pattanakarn, the one physical
       location this flow is confirmed to run from today; if a second
       location ever gets its own tables, this needs a real per-table branch
       field, not a wider guess. */
  const DINE_IN_STORE_ID = "pattanakarn";
  try {
    if (o.fulfilment === "delivery") {
      if (resolvedDeliveryBranchId) o.storeId = resolvedDeliveryBranchId;
    } else if (matchedTable || o.table || o.fulfilment === "table" || o.fulfilment === "pickup") {
      o.storeId = DINE_IN_STORE_ID;
    }
  } catch (e) { console.error("store attribution skipped:", e.message); }

  /* productKey: resolved against the live catalogue (getMenu()), never
     taken as-is from the client. food.html sends each line's own catalogue
     id as `id`, which is used only once confirmed to match a real product —
     a client can't point productKey at an arbitrary id (e.g. to misattribute
     COGS to a product it didn't actually sell). Cannabis checkout (checkout.
     html/index.html) sends `shId`, which the live BRYAN POS feed doesn't
     populate (see AUDIT.md), so those lines are resolved by matching the
     line's name against the same catalogue — the identical lookup, just
     keyed by name instead of id. An unmatched name/id (renamed/delisted
     product, or a bogus client value) is left untagged, never guessed at. */
  try {
    if (o.items?.length) {
      const { data: menu } = await getMenu();
      const idSet = new Set((menu || []).map((p) => String(p.id)));
      const byId = new Map((menu || []).map(product=>[String(product.id),product]));
      const byName = new Map((menu || []).map((p) => [String(p.name || "").trim().toLowerCase(), String(p.id)]));
      for (const it of o.items) {
        if (it.productKey) continue;
        if (it.id && idSet.has(String(it.id))) { it.productKey = String(it.id); continue; }
        const key = byName.get(String(it.name || "").trim().toLowerCase());
        if (key) it.productKey = key;
      }
      // Keep verified sale-time metadata on the receipt for historical reporting.
      for(const item of o.items){
        const product=byId.get(String(item.productKey||''));
        if(!product)continue;
        item.sku=String(product.sku??'');
        item.category=String(product.category??'');
      }
    }
  } catch (e) { console.error("product_key attribution skipped:", e.message); }

  try {
    await setJSON("order:" + orderId, { ...o, orderId, at: takenAt, status: "new" });
    await indexAdd(orderId, "orders:index");
    const who = normPhone(o.customer?.phone);
    if (who.length >= 6) await indexAdd(orderId, "orders:by:" + who);
    if (o.promo) await bump("promotion:uses:" + o.promo, 60 * 60 * 24 * 365 * 10);
    saved = true;
  } catch (e) { console.error("order save failed:", e.message); }

  // Redemption history (docs/dank-backoffice/BACKOFFICE_REQUIREMENTS.md's
  // Module I gap). Deliberately its own try/catch, after `saved` is already
  // set: a failure here must never be mistaken for the order itself failing
  // to save, and must never roll anything back — it's a nice-to-have report
  // row, not something the order's success depends on.
  if (saved && o.promo) {
    try {
      await recordPromotionRedemption({ code: o.promo, orderId, discount: o.discount, phone: o.customer?.phone, at: takenAt });
    } catch (e) { console.error("promotion redemption log failed:", e.message); }
  }

  // Tracking is set up for every delivery order, but without links: staff
  // choose the rider on the LINE card, which makes the rider link and then
  // the customer link (see _delivery-line.js).
  let tracked = false;
  if (saved) {
    try { tracked = await createDelivery({ ...o, orderId }); }
    catch { console.error("Delivery tracking setup unavailable"); }
  }

  /* Telegram destinations remain developer-managed server secrets and use
     the online heartbeat. LINE is intentionally different: every saved order
     is pushed once to the configured staff group in LINE_TO. */
  try {
    let configured={};
    try{configured=JSON.parse(process.env.STAFF_NOTIFICATION_DESTINATIONS_JSON||"{}")}catch(e){console.error("invalid staff notification destinations JSON")}
    if(!configured||typeof configured!=="object"||Array.isArray(configured))configured={};
    const accounts=await listAccounts(),destinations=[];
    for(const account of accounts){
      if(account.active===false)continue;
      const presence=await getJSON("staff:presence:"+account.id);
      if(Date.now()-(Number(presence?.lastSeen)||0)>=120000)continue;
      const target=configured[account.id]||configured[account.name]||{};
      destinations.push(target&&typeof target==="object"?target:{});
    }
    const telegramIds=[...new Set(destinations.map(x=>String(x.telegramChatId||"").trim()).filter(x=>/^-?\d{5,20}$/.test(x)))];
    const sends=[];
    if(process.env.TELEGRAM_BOT_TOKEN)for(const chatId of telegramIds)sends.push(
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text:onlineStaffAlert})})
        .then(async r=>{if(!r.ok){const why=await r.json().catch(()=>({}));console.error("telegram staff send failed:",r.status,why.description||"")}return r.ok})
        .catch(e=>{console.error("telegram staff send threw:",e.message);return false})
    );
    if(sends.length)results.push(...await Promise.all(sends));
  }catch(e){console.error("online staff notification lookup failed:",e.message)}

  if (saved) {
    try {
      const card = tracked ? deliveryOrderCard({...o, orderId})
        : o.fulfilment === 'delivery' ? createLinkCard({...o, orderId}) : null;
      const r = card
        ? await lineMessages(process.env.LINE_TO, [{type: 'text', text: staffAlert.slice(0,4900)}, card])
        : await notifyStaffLine(staffAlert);
      if (!r.skipped) {
        results.push(Boolean(r.ok));
        if (!r.ok) console.error("LINE staff group send failed:", r.error || "unknown error");
      }
    } catch (e) {
      results.push(false);
      console.error("LINE staff group send threw:", e.message);
    }
  }

  try {
    const r = await notifyStaffWhatsApp(staffAlert);
    if (!r.skipped) results.push(r.ok);
  } catch (e) {}

  /* Website checkout intentionally does not create a StoreHub/POS sale.
     Staff receive the order alert and enter the sale on the POS device manually. */

  try {
    const r = await pushShopifyOrder(o, orderId, matchedTable);
    if (!r.skipped) {
      results.push(r.ok);
      if (r.ok) {
        o.shopify = { order: r.shopifyOrder, id: r.shopifyId };
        try { await setJSON("order:" + orderId, { ...o, orderId, at: takenAt, status: "new" }); }
        catch (e) { console.error("shopify ref not saved:", e.message); }
      }
    }
  } catch (e) { console.error("shopify push threw:", e.message); }

  /* ORDER_FORWARD_URL is intentionally ignored for customer checkout.
     POS remains an inbound catalogue/stock/CRM source only. */

  if (process.env.RESEND_API_KEY) {
    try {
      const lines = o.items
        .map((i) => `• ${i.name} (${i.option}) ×${i.qty} — ฿${i.lineTotal}`)
        .join("<br>");
      const html = `<h2>🌿 New order ${orderId} — dankbangkok.com</h2>
        <p>${lines}</p>
        ${giftHtml}
        <p><b>Subtotal:</b> ฿${o.subtotal}${o.member ? " (member)" : ""}<br>
        <b>Payment:</b> ${o.payment}<br>
        <b>Fulfilment:</b> ${o.fulfilment}<br>
        <b>Name:</b> ${esc(o.customer?.name)} · <b>Phone:</b> ${esc(o.customer?.phone)}<br>
        ${matchedTable
          ? `<b>Table:</b> ${esc(o.tableLabel || matchedTable)}`
          : o.fulfilment === "delivery"
          ? `<b>Area:</b> ${esc(o.delivery?.zone)} · <b>Address:</b> ${esc(o.delivery?.address)}<br><b>Delivery:</b> ${esc(feeNote)}`
          : `<b>Branch:</b> ${esc(o.pickup?.branch)} · <b>Time:</b> ${esc(o.pickup?.time)}`}<br>
        ${o.notes ? `<b>Notes:</b> ${esc(o.notes)}` : ""}</p>`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.ORDER_EMAIL_FROM || "orders@dankbangkok.com",
          to: [OWNER_EMAIL],
          subject: `🌿 Order ${orderId} · ฿${o.total ?? o.subtotal} · ${o.fulfilment}`,
          html,
        }),
      });
      results.push(r.ok);
    } catch (e) { results.push(false); }
  }

  const tracking = tracked ? { trackingPending: true } : {};
  if (results.some(Boolean)) return res.status(200).json({ ok: true, orderId, delivered: true, ...walletInfo, ...tracking });

  if (results.length === 0) console.log("ORDER (no channels configured):", orderId, JSON.stringify(o));
  else console.error("ORDER: every alert channel failed, order saved:", saved, orderId);
  if (saved) return res.status(200).json({ ok: true, orderId, delivered: false, ...walletInfo, ...tracking });
  return res.status(502).json({ error: "all order channels failed" });
}

const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
