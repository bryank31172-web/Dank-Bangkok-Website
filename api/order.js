/* POST /api/order — receives an order from the storefront checkout.
   The order is always written to storage first, then offered to every channel
   that is configured (all optional, any combination):
     - Telegram / LINE / WhatsApp   → staff phones buzz
     - Shopify (dankbkk.com)        → created as an unpaid order, see _shopify.js
     - RESEND_API_KEY set           → emailed to ORDER_EMAIL_TO
       (default dankclubbkk@gmail.com) via resend.com (free tier).
   Returns {ok:true, orderId} whenever the order was written down, whatever
   the channels did — see the comment at the bottom for why that matters.
   502 is only for the case where nothing anywhere knows the order exists.
   Paying by Wallet reserves the amount instead of spending it: the reply
   carries {walletPending:true, balance} and staff settle it from the
   console. See the wallet block below for why.                       */

import { getJSON, setJSON, indexAdd, bump } from "./_store.js";
import { listAccounts } from "./_staff-accounts.js";
import { normPhone } from "./_phone.js";
import { getBalance } from "./_wallet.js";
import { boxesInOrder, issueGifts, giftAlertLines, getGiftConfig } from "./_boxgifts.js";
import { getMenu } from "./_menu.js";
import { linePush } from "./_line.js";
import { notifyStaffWhatsApp } from "./_whatsapp.js";
import { pushShopifyOrder } from "./_shopify.js";
import { requireRate } from "./_ratelimit.js";
import { validatePromotion, normalizePromotionCode } from "./_promotion.js";

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

  try {
    const items = o.items || [];
    if (items.length && items.some((i) => i.shId)) {
      const { data: menu } = await getMenu();
      const price = {};
      const products = new Map();
      for (const p of menu || []) {
        const tiers = p.priceTiers || (p.price != null ? [{ label: p.option || "", price: p.price }] : []);
        for (const t of tiers) {
          const shId = String(t.shId || p.shId || "");
          if (shId) products.set(shId, p);
          const base = Number(t.price);
          const value = Math.max(0, Number(p.discountValue) || 0);
          const discounted = p.discountEnabled === true
            ? p.discountType === "fixed" ? base - value : base * (1 - Math.min(100, value) / 100)
            : base;
          price[`${shId}|${t.label}`] = Math.max(0, discounted);
        }
      }
      for (const it of items) {
        const product = products.get(String(it.shId || ""));
        if (!product) continue;
        it.effects = Array.isArray(product.effects)
          ? product.effects.slice(0, 6).map((effect) => String(effect).trim()).filter(Boolean)
          : [];
        it.strainType = String(product.type || "").trim();
        it.category = String(product.category || it.category || "").trim();
        const grams = String(it.option || "").match(/(\d+(?:\.\d+)?)\s*g\b/i);
        if (grams) {
          it.grams = Number(grams[1]);
          it.totalGrams = it.grams * Math.max(1, Number(it.qty) || 1);
        }
      }
      let resolved = true, recomputed = 0;
      if (!items.every((i) => i.shId)) resolved = false;
      for (const it of items) {
        if (!resolved) break;
        const unit = price[`${it.shId}|${it.option || ""}`];
        if (unit == null || !Number.isFinite(unit)) { resolved = false; break; }
        it.unitPrice = unit;
        recomputed += unit * (Number(it.qty) || 1);
      }
      const clientSub = Number(o.subtotal);
      if (resolved && (!Number.isFinite(clientSub) || clientSub < recomputed - 0.5)) {
        const disc = Math.max(0, Number(o.discount) || 0);
        const fee = Math.max(0, Number(o.deliveryFee) || 0);
        o.subtotal = Math.round(recomputed);
        o.total = Math.max(0, Math.round(recomputed - disc + fee));
        o.priceAdjusted = true;
      }
    }
  } catch (e) {
    console.error("price guard skipped:", e.message);
  }

  const submittedPromotion = normalizePromotionCode(o.promo);
  const itemSubtotal = (o.items || []).reduce((sum, item) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const unit = Number(item.unitPrice ?? item.price);
    const line = Number(item.lineTotal);
    return sum + (Number.isFinite(unit) ? Math.max(0, unit) * qty : Number.isFinite(line) ? Math.max(0, line) : 0);
  }, 0);
  const authoritativeSubtotal = itemSubtotal > 0 ? Math.round(itemSubtotal) : Math.max(0, Number(o.subtotal) || 0);
  const submittedDeliveryFee = matchedTable ? 0 : 100;
  if (submittedPromotion) {
    try {
      const promotion = await validatePromotion(submittedPromotion, authoritativeSubtotal, submittedDeliveryFee);
      if (!promotion.ok) return res.status(400).json({ error: "invalid promotion", reason: promotion.reason, minimum: promotion.minimum });
      o.promo = promotion.code;
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

  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
  const itemLines = o.items
    .map((i) => `• ${i.name} (${i.option || ""}) ×${i.qty} — ฿${i.lineTotal}`)
    .join("\n");
  const tableDisplay = o.tableLabel || matchedTable;
  const where = matchedTable
    ? `🪑 TABLE ${tableDisplay} — bring it over`
    : o.fulfilment === "delivery"
    ? `🚚 Delivery — ${o.delivery?.zone || ""}\n${o.delivery?.address || ""}`
    : `🏬 Pickup — ${o.pickup?.branch || ""}${o.pickup?.time ? " at " + o.pickup.time : ""}`;
  const promoCode = String(o.promo || "").trim().toUpperCase().slice(0, 24);
  const promoBlock = promoCode
    ? `\n🎟️ Code: ${promoCode}${/^FREEJOINT$/.test(promoCode) ? "  ← 🚬 ADD ONE FREE JOINT" : ""}`
    : "";

  const staffAlert =
    `🛒 NEW ORDER ${orderId} — dankbkk.com\n\n${itemLines}${giftBlock}${promoBlock}\n\n` +
    `Total: ฿${o.total ?? o.subtotal}${o.member ? " (member ⭐)" : ""}\n` +
    `Pay: ${o.payment}\n${where}\n` +
    `Customer: ${o.customer?.name || "-"} · ${o.customer?.phone}\n` +
    `${o.notes ? "Notes: " + o.notes + "\n" : ""}\n` +
    `➡️ Open: https://${host}/staffportal#orders`;

  const onlineStaffAlert =
    `🛒 NEW ORDER ${orderId}\n` +
    `Total: ฿${o.total ?? o.subtotal}\n` +
    `Type: ${o.fulfilment || "order"}\n` +
    `Open securely: https://${host}/staffportal#orders`;

  const results = [];
  let saved = false;
  const takenAt = Date.now();

  try {
    await setJSON("order:" + orderId, { ...o, orderId, at: takenAt, status: "new" });
    await indexAdd(orderId, "orders:index");
    const who = normPhone(o.customer?.phone);
    if (who.length >= 6) await indexAdd(orderId, "orders:by:" + who);
    if (o.promo) await bump("promotion:uses:" + o.promo, 60 * 60 * 24 * 365 * 10);
    saved = true;
  } catch (e) { console.error("order save failed:", e.message); }

  /* Destinations are developer-managed server secrets, never staff-account
     fields. Set STAFF_NOTIFICATION_DESTINATIONS_JSON in the deployment
     environment as {"account-id":{"telegramChatId":"123","lineUserId":"U..."}}
     (a staff name may be used as a fallback key). The online heartbeat still
     decides whether that destination receives this minimal alert. */
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
    const lineIds=[...new Set(destinations.map(x=>String(x.lineUserId||"").trim()).filter(x=>/^U[0-9a-f]{32}$/i.test(x)))];
    const sends=[];
    if(process.env.TELEGRAM_BOT_TOKEN)for(const chatId of telegramIds)sends.push(
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text:onlineStaffAlert})})
        .then(async r=>{if(!r.ok){const why=await r.json().catch(()=>({}));console.error("telegram staff send failed:",r.status,why.description||"")}return r.ok})
        .catch(e=>{console.error("telegram staff send threw:",e.message);return false})
    );
    if(process.env.LINE_CHANNEL_ACCESS_TOKEN)for(const userId of lineIds)sends.push(linePush(userId,onlineStaffAlert).then(r=>Boolean(r.ok)).catch(()=>false));
    if(sends.length)results.push(...await Promise.all(sends));
  }catch(e){console.error("online staff notification lookup failed:",e.message)}

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
      const html = `<h2>🌿 New order ${orderId} — dankbkk.com</h2>
        <p>${lines}</p>
        ${giftHtml}
        <p><b>Subtotal:</b> ฿${o.subtotal}${o.member ? " (member)" : ""}<br>
        <b>Payment:</b> ${o.payment}<br>
        <b>Fulfilment:</b> ${o.fulfilment}<br>
        <b>Name:</b> ${esc(o.customer?.name)} · <b>Phone:</b> ${esc(o.customer?.phone)}<br>
        ${matchedTable
          ? `<b>Table:</b> ${esc(o.tableLabel || matchedTable)}`
          : o.fulfilment === "delivery"
          ? `<b>Area:</b> ${esc(o.delivery?.zone)} · <b>Address:</b> ${esc(o.delivery?.address)}`
          : `<b>Branch:</b> ${esc(o.pickup?.branch)} · <b>Time:</b> ${esc(o.pickup?.time)}`}<br>
        ${o.notes ? `<b>Notes:</b> ${esc(o.notes)}` : ""}</p>`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.ORDER_EMAIL_FROM || "orders@dankbkk.com",
          to: [OWNER_EMAIL],
          subject: `🌿 Order ${orderId} · ฿${o.total ?? o.subtotal} · ${o.fulfilment}`,
          html,
        }),
      });
      results.push(r.ok);
    } catch (e) { results.push(false); }
  }

  if (results.some(Boolean)) return res.status(200).json({ ok: true, orderId, delivered: true, ...walletInfo });

  if (results.length === 0) console.log("ORDER (no channels configured):", orderId, JSON.stringify(o));
  else console.error("ORDER: every alert channel failed, order saved:", saved, orderId);
  if (saved) return res.status(200).json({ ok: true, orderId, delivered: false, ...walletInfo });
  return res.status(502).json({ error: "all order channels failed" });
}

const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
