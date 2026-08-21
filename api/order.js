/* POST /api/order — receives an order from the storefront checkout.
   What happens to it (all optional, any combination):
     1. ORDER_FORWARD_URL set  → forwarded as JSON (e.g. your BRYAN POS
        app's own order-intake endpoint, so it lands in the Orders tab).
     2. RESEND_API_KEY set     → emailed to ORDER_EMAIL_TO
        (default dankclubbkk@gmail.com) via resend.com (free tier).
   Always returns {ok:true, orderId} if at least one channel succeeded,
   so the storefront can show success. If everything fails, returns 502
   and the storefront automatically falls back to LINE.
   Paying by Wallet reserves the amount instead of spending it: the reply
   carries {walletPending:true, balance} and staff settle it from the
   console. See the wallet block below for why.                       */

import crypto from "node:crypto";
import { setJSON, indexAdd } from "./_store.js";
import { normPhone } from "./_phone.js";
import { getBalance } from "./_wallet.js";
import { pushTransaction } from "./_storehub.js";
import { boxesInOrder, issueGifts, giftAlertLines, getGiftConfig } from "./_boxgifts.js";
import { getMenu } from "./_menu.js";
import { notifyStaffLine } from "./_line.js";
import { notifyStaffWhatsApp } from "./_whatsapp.js";
import { requireRate } from "./_ratelimit.js";

const OWNER_EMAIL = process.env.ORDER_EMAIL_TO || "dankclubbkk@gmail.com";

/* Order ids used to be nothing but "DK" + the clock in base 36, which meant
   every id placed in the same minute sat in a short contiguous range. GET
   /api/track?id= needs no key, so a few thousand guesses would have walked the
   whole day's order book — names, phone numbers, addresses. The timestamp stays
   (it sorts, and staff read it back over the phone), followed by four random
   characters from a 32-symbol alphabet with the easily-misheard letters left
   out. That is ~1M ids per timestamp to guess through instead of one. */
const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newOrderId() {
  const bytes = crypto.randomBytes(4);
  let tail = "";
  // 256 is an exact multiple of 32, so the modulo keeps every symbol equally likely.
  for (const b of bytes) tail += ID_ALPHABET[b % 32];
  return "DK" + Date.now().toString(36).toUpperCase() + tail;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  /* Anyone can post here — that is the point of a shop — but nobody needs to
     place a dozen orders in ten minutes. Generous enough for a family sharing a
     café's address, tight enough that the order index and the staff's phones
     can't be flooded by a script. */
  if (!(await requireRate(req, res, "order", 12, 600))) return;

  const o = req.body || {};
  /* A phone number is how staff reach a delivery or pickup customer, so it stays
     required for those. A customer sitting at T3 who scanned the QR card on the
     table has no reason to hand one over — the table IS the address. Table
     orders are therefore identified by a recognised table name instead, and we
     fill the phone field with "TABLE-T3" so every downstream consumer (staff
     console, POS feed, LINE and Telegram alerts) still sees a non-empty value
     rather than needing its own special case. */
  const TABLE_NAMES = ["T1", "T2", "T3", "T4", "T5", "T6", "Bar 1", "Bar 2"];
  const norm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, "");
  const matchedTable =
    o.fulfilment === "table" ? TABLE_NAMES.find((t) => norm(t) === norm(o.table)) : null;
  if (matchedTable) {
    o.table = matchedTable;
    o.customer = { ...(o.customer || {}) };
    if (!o.customer.phone) o.customer.phone = "TABLE-" + matchedTable.replace(/\s+/g, "");
    if (!o.customer.name) o.customer.name = matchedTable;
  }
  if (!o.items?.length || !o.customer?.phone) {
    return res.status(400).json({ error: "invalid order" });
  }
  const orderId = newOrderId();

  // --- Server-side price guard -------------------------------------------
  // For live (StoreHub) items, recompute the charge base from the menu so a
  // tampered client price can't underpay. It only tightens (never overcharges
  // beyond menu price, never rejects) and is skipped unless every item resolves
  // in the menu — so the built-in demo catalog (no shId) is unaffected.
  try {
    const items = o.items || [];
    if (items.length && items.every((i) => i.shId)) {
      // getMenu() answers with a {data, rev, source, at, changedAt} record, not
      // the product array. Iterating the record threw "menu is not iterable" on
      // every order, straight into the empty catch below, so this guard had
      // never once run and a client could post its own price for anything.
      const { data: menu } = await getMenu();
      const price = {};
      for (const p of menu || []) {
        const tiers = p.priceTiers || (p.price != null ? [{ label: p.option || "", price: p.price }] : []);
        for (const t of tiers) price[`${p.shId}|${t.label}`] = Number(t.price);
      }
      let resolved = true, recomputed = 0;
      for (const it of items) {
        const unit = price[`${it.shId}|${it.option || ""}`];
        if (unit == null || !Number.isFinite(unit)) { resolved = false; break; }
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
    // A broken guard must not stop a customer ordering, but it must not be
    // invisible either — the silence above is exactly how the bug it guards
    // against survived. Log it so the next breakage shows up in the Vercel logs.
    console.error("price guard skipped:", e.message);
  }

  /* Wallet: reserve now, staff settle later.
     This used to debit the wallet right here, from a phone number that arrived
     in an unauthenticated request body — so anyone who knew a customer's number
     could spend that customer's store credit by posting an order. Until there
     is a real login (phone OTP), no unauthenticated endpoint moves money: we
     check the balance covers the order, mark it pending, and let staff settle
     it from the console (POST /api/wallet {action:"settle"}) once they have the
     customer in front of them. Nothing is deducted before that. */
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
  // Extra fields the storefront needs on a wallet order, so it can say "pay on
  // collection" rather than the "paid from your wallet" it used to say.
  const walletInfo = o.walletReserved ? { walletPending: true, balance: o.walletBalance } : {};

  /* --- Custom box: what rides along free, and taking it off the count ------
     28 grams of flower earns a box, and every box costs the shop a tin of
     hash, a brownie, a jelly, a pack of Backwoods, RAW papers, a tee and a
     hat. The count comes from the order's own weight, not from anything the
     browser claimed — see api/_boxgifts.js for why that matters.

     Wrapped, because a gift ledger that cannot be written must not cost a
     sale. If this throws the order goes through with no gift block attached
     and the reason is in the Vercel log, which is the right trade when the
     alternative is refusing several thousand baht of flower over a brownie. */
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
  /* Staff read this on their phone before they pack it, so the shortfall has
     to be in the same message as the order rather than somewhere they'd have
     to go and look. */
  const giftBlock = giftLines.length
    ? `\n\n📦 CUSTOM BOX ×${o.box.boxes} (${o.box.grams}g) — set aside:\n${giftAlertLines(giftLines)}`
    : "";
  /* Same block for the owner's email. Escaped before the newlines become <br>,
     because gift labels are staff-editable through /api/boxgifts and this lands
     in a mail client that renders HTML. */
  const giftHtml = giftLines.length
    ? `<p><b>📦 Custom box ×${o.box.boxes} (${o.box.grams}g) — set aside:</b><br>${esc(
        giftAlertLines(giftLines)
      ).replace(/\n/g, "<br>")}</p>`
    : "";

  /* One staff-facing message for every push channel. Keeping the text in one
     place prevents Telegram, LINE and WhatsApp from slowly disagreeing about
     the total, table/delivery destination or notes. */
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
  const itemLines = o.items
    .map((i) => `• ${i.name} (${i.option || ""}) ×${i.qty} — ฿${i.lineTotal}`)
    .join("\n");
  const where = matchedTable
    ? `🪑 TABLE ${matchedTable} — bring it over`
    : o.fulfilment === "delivery"
    ? `🚚 Delivery — ${o.delivery?.zone || ""}\n${o.delivery?.address || ""}`
    : `🏬 Pickup — ${o.pickup?.branch || ""}${o.pickup?.time ? " at " + o.pickup.time : ""}`;
  /* A won code that hands over goods rather than money off - the wheel's free
     joint - is invisible in the totals by design, so without this line the
     only person who needs to know never finds out and the customer is
     promised a joint nobody puts in the bag. Printed for every code, since a
     discount worth naming on the slip is worth naming here too. */
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
    `➡️ Open: https://${host}/staff.html#orders`;

  const results = [];
  /* Whether the order reached storage. It decides the reply on its own: an
     order that is written down has been taken, whatever the messengers did
     about it afterwards. */
  let saved = false;

  // 0) ALWAYS save the order so it shows in the staff console's Orders tab
  try {
    // orderId AFTER the spread. With it first, a body carrying its own
    // "orderId" overwrote the real one, so the record stored under
    // order:<returned id> claimed to be a different order entirely.
    await setJSON("order:" + orderId, { ...o, orderId, at: Date.now(), status: "new" });
    await indexAdd(orderId, "orders:index");
    /* A second index, keyed on the customer, so that pulling up one person's
       history when staff scan their card is one read instead of a walk over
       every order the shop has ever taken. Table orders get "TABLE-T3" as
       their phone and normalise to nothing, so they simply don't land here. */
    const who = normPhone(o.customer?.phone);
    if (who.length >= 6) await indexAdd(orderId, "orders:by:" + who);
    saved = true;
  } catch (e) { console.error("order save failed:", e.message); }

  // 0b) Telegram ping — staff phones buzz instantly (same bot as chat handoffs)
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: staffAlert }),
      });
      /* Telegram answers a bad chat_id or a revoked token with 200-shaped JSON
         carrying ok:false and a description - "chat not found", "Unauthorized".
         Log that sentence: it names the fix, and without it a silent false is
         indistinguishable from the network being down. The token is never
         logged, only Telegram's own words. */
      if (!r.ok) {
        const why = await r.json().catch(() => ({}));
        console.error("telegram send failed:", r.status, why.description || "");
      }
      results.push(r.ok);
    } catch (e) { console.error("telegram send threw:", e.message); results.push(false); }
  }

  // 0b-LINE) Same alert pushed to LINE (Bryan / staff group) if LINE_TO is set
  try {
    const r = await notifyStaffLine(staffAlert);
    if (!r.skipped) results.push(r.ok);
  } catch (e) { /* non-fatal */ }

  // 0b-WhatsApp) Meta Cloud API alert to one or more staff phones
  try {
    const r = await notifyStaffWhatsApp(staffAlert);
    if (!r.skipped) results.push(r.ok);
  } catch (e) { /* non-fatal */ }

  /* 0c) Push into StoreHub as an online transaction (optional; STOREHUB_PUSH_ORDERS=1).
     giftLines ride along as ฿0 lines so the POS takes the hash, brownie, tee and
     hat off its own stock too — the connector's inventory endpoints are
     read-only, so a zero-priced line on the transaction is the only write path
     there is. Gifts with no StoreHub id mapped yet are skipped inside. */
  try { const r = await pushTransaction(o, orderId, giftLines); if (r && r.ok) results.push(true); } catch (e) { /* non-fatal */ }

  // 1) Forward into the POS flow
  if (process.env.ORDER_FORWARD_URL) {
    try {
      const r = await fetch(process.env.ORDER_FORWARD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...o, orderId }), // same reason as the stored record: ours wins
      });
      results.push(r.ok);
    } catch (e) { results.push(false); }
  }

  // 2) Email the owner
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
          ? `<b>Table:</b> ${esc(matchedTable)}`
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

  /* No messenger got through. The order is still taken if it was written down
     - it is in storage and on the Orders tab, and staff will see it there.
     Telling the customer "nothing was ordered" would be false, and it would
     hand a single mistyped chat id the power to close the shop: before
     Telegram was configured this branch could not be reached, so the first
     wrong credential turned every checkout into a failure. A messenger that
     cannot deliver is reported, not obeyed.

     502 is kept for the one case that deserves it - the order reached neither
     storage nor a messenger, so nothing anywhere knows it exists. */
  if (results.length === 0) console.log("ORDER (no channels configured):", orderId, JSON.stringify(o));
  else console.error("ORDER: every alert channel failed, order saved:", saved, orderId);
  if (saved) return res.status(200).json({ ok: true, orderId, delivered: false, ...walletInfo });
  return res.status(502).json({ error: "all order channels failed" });
}

const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
