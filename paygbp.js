/* POST /api/order — receives an order from the storefront checkout.
   What happens to it (all optional, any combination):
     1. ORDER_FORWARD_URL set  → forwarded as JSON (e.g. your BRYAN POS
        app's own order-intake endpoint, so it lands in the Orders tab).
     2. RESEND_API_KEY set     → emailed to ORDER_EMAIL_TO
        (default dankclubbkk@gmail.com) via resend.com (free tier).
   Always returns {ok:true, orderId} if at least one channel succeeded,
   so the storefront can show success. If everything fails, returns 502
   and the storefront automatically falls back to LINE.               */

import { setJSON, indexAdd } from "./_store.js";
import { debit } from "./_wallet.js";
import { pushTransaction } from "./_storehub.js";
import { getMenu } from "./_menu.js";
import { notifyStaffLine } from "./_line.js";

const OWNER_EMAIL = process.env.ORDER_EMAIL_TO || "dankclubbkk@gmail.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const o = req.body || {};
  if (!o.items?.length || !o.customer?.phone) {
    return res.status(400).json({ error: "invalid order" });
  }
  const orderId = "DK" + Date.now().toString(36).toUpperCase();

  // --- Server-side price guard -------------------------------------------
  // For live (StoreHub) items, recompute the charge base from the menu so a
  // tampered client price can't underpay. It only tightens (never overcharges
  // beyond menu price, never rejects) and is skipped unless every item resolves
  // in the menu — so the built-in demo catalog (no shId) is unaffected.
  try {
    const items = o.items || [];
    if (items.length && items.every((i) => i.shId)) {
      const menu = await getMenu();
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
  } catch (e) { /* never block an order on the price guard */ }

  // Pay from wallet (store credit) if chosen — verify + deduct server-side.
  if (o.payment === "Wallet") {
    const amt = Math.round(Number(o.total ?? o.subtotal));
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "invalid amount" });
    const r = await debit(o.customer?.phone, amt, "Order " + orderId);
    if (!r.ok) return res.status(402).json({ error: "insufficient wallet", balance: r.balance });
    o.payStatus = "paid";
    o.walletPaid = true;
    o.walletBalanceAfter = r.balance;
  }

  const results = [];

  // 0) ALWAYS save the order so it shows in the staff console's Orders tab
  try {
    await setJSON("order:" + orderId, { orderId, ...o, at: Date.now(), status: "new" });
    await indexAdd(orderId, "orders:index");
  } catch (e) { console.error("order save failed:", e.message); }

  // 0b) Telegram ping — staff phones buzz instantly (same bot as chat handoffs)
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
      const lines = o.items.map((i) => `• ${i.name} (${i.option}) ×${i.qty} — ฿${i.lineTotal}`).join("\n");
      const where = o.fulfilment === "delivery"
        ? `🚚 Delivery — ${o.delivery?.zone || ""}\n${o.delivery?.address || ""}`
        : `🏬 Pickup — ${o.pickup?.branch || ""} ${o.pickup?.time ? "at " + o.pickup.time : ""}`;
      const text =
        `🛒 NEW ORDER ${orderId} — dankbkk.com\n\n${lines}\n\nTotal: ฿${o.total ?? o.subtotal}${o.member ? " (member ⭐)" : ""}\nPay: ${o.payment}\n${where}\n` +
        `Customer: ${o.customer?.name || "-"} · ${o.customer?.phone}\n${o.notes ? "Notes: " + o.notes + "\n" : ""}` +
        `\n➡️ Open: https://${host}/staff.html#orders`;
      const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
      });
      results.push(r.ok);
    } catch (e) { results.push(false); }
  }

  // 0b-LINE) Same alert pushed to LINE (Bryan / staff group) if LINE_TO is set
  try {
    const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
    const lines = o.items.map((i) => `• ${i.name} (${i.option}) ×${i.qty} — ฿${i.lineTotal}`).join("\n");
    const where = o.fulfilment === "delivery"
      ? `🚚 Delivery — ${o.delivery?.zone || ""} ${o.delivery?.address || ""}`
      : `🏬 Pickup — ${o.pickup?.branch || ""} ${o.pickup?.time || ""}`;
    const r = await notifyStaffLine(
      `🛒 NEW ORDER ${orderId} — dankbkk.com\n\n${lines}\n\nTotal: ฿${o.total ?? o.subtotal}\nPay: ${o.payment}\n${where}\nCustomer: ${o.customer?.name || "-"} · ${o.customer?.phone}\n➡️ https://${host}/staff.html#orders`
    );
    if (r.ok) results.push(true);
  } catch (e) { /* non-fatal */ }

  // 0c) Push into StoreHub as an online transaction (optional; STOREHUB_PUSH_ORDERS=1)
  try { const r = await pushTransaction(o, orderId); if (r && r.ok) results.push(true); } catch (e) { /* non-fatal */ }

  // 1) Forward into the POS flow
  if (process.env.ORDER_FORWARD_URL) {
    try {
      const r = await fetch(process.env.ORDER_FORWARD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, ...o }),
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
        <p><b>Subtotal:</b> ฿${o.subtotal}${o.member ? " (member)" : ""}<br>
        <b>Payment:</b> ${o.payment}<br>
        <b>Fulfilment:</b> ${o.fulfilment}<br>
        <b>Name:</b> ${esc(o.customer?.name)} · <b>Phone:</b> ${esc(o.customer?.phone)}<br>
        ${o.fulfilment === "delivery"
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

  if (results.length === 0) {
    // Nothing configured yet — accept and log so testing works,
    // but tell the client so it can also push via LINE.
    console.log("ORDER (no channels configured):", orderId, JSON.stringify(o));
    return res.status(200).json({ ok: true, orderId, delivered: false });
  }
  if (results.some(Boolean)) return res.status(200).json({ ok: true, orderId, delivered: true });
  return res.status(502).json({ error: "all order channels failed" });
}

const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
