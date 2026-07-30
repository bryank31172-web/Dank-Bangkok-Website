/* /api/wallet — customer store-credit with a +10% top-up bonus.

   Bonus %: TOPUP_BONUS_PCT (default 10). Top-ups are paid via Omise
   (PromptPay QR or card); the wallet is credited amount + bonus once the
   charge is confirmed (polled here and/or via omise-webhook).

     GET  ?phone=...                       → {balance, bonusPct, configured}
     GET  ?checkTopup=chrg_...&phone=...    → {paid, balance}
     POST {action:"topup_promptpay", phone, amount}  → {chargeId, qr, willReceive}
     POST {action:"topup_card", phone, amount, token} → {paid, balance}
     POST {action:"settle", orderId, key}   → {ok, balance}   (staff only)

   Security: credit is idempotent per charge (topup record's `credited`
   flag); the bonus and amount are computed server-side. Spending credit
   is staff-only — see the settle action.                              */

import { getJSON, setJSON } from "./_store.js";
import { getBalance, credit, debit } from "./_wallet.js";
import { requireStaff } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";

const SK = process.env.OMISE_SECRET_KEY || "";
const BONUS = Number(process.env.TOPUP_BONUS_PCT || 10);
const AUTH = () => "Basic " + Buffer.from(SK + ":").toString("base64");

async function omise(path, body) {
  const r = await fetch("https://api.omise.co" + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: AUTH(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.object === "error") throw new Error(j.code + ": " + j.message);
  return j;
}
const withBonus = (amt) => amt + Math.round((amt * BONUS) / 100);

async function creditTopup(chargeId) {
  // idempotent: only credits once per charge
  const rec = await getJSON("topup:" + chargeId);
  if (!rec || rec.credited) return rec ? await getBalance(rec.phone) : 0;
  const total = withBonus(rec.amount);
  const bal = await credit(rec.phone, total, `Top-up ฿${rec.amount} +${BONUS}% bonus`);
  rec.credited = true;
  await setJSON("topup:" + chargeId, rec, 60 * 60 * 24 * 30);
  return bal;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      /* A balance lookup needs nothing but a phone number, which makes this a
         free "does this number exist and how much can it spend" oracle. A real
         fix is a customer login; until then, at least make sweeping the number
         space expensive. The limit is well above what one shopper's browser
         does (it refreshes on load and after each wallet action). */
      if (!(await requireRate(req, res, "wallet-get", 30, 300))) return;
      if (req.query?.checkTopup) {
        if (!SK) return res.status(200).json({ paid: false });
        const c = await omise("/charges/" + encodeURIComponent(req.query.checkTopup));
        let balance = await getBalance(req.query.phone);
        if (c.paid) balance = await creditTopup(c.id);
        return res.status(200).json({ paid: Boolean(c.paid), balance });
      }
      const balance = await getBalance(req.query?.phone);
      return res.status(200).json({ balance, bonusPct: BONUS, configured: Boolean(SK) });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const b = req.body || {};

    /* Settle a wallet order — the other half of the reserve in /api/order.
       Money only ever leaves a wallet from here, behind the staff key, because
       the request that creates an order is unauthenticated and a phone number
       is not a credential. Staff hand over the goods, tap settle, and the debit
       happens once.

       Idempotent by the walletSettled flag on the order: pressing the button
       twice (or a retry after a flaky response) returns the same balance and
       does not debit again. Two settles racing each other on different
       instances could still both pass the flag check — that needs a lock we
       have no primitive for here, and a human pressing one button twice in the
       same 200ms is not the case worth building it for. */
    if (b.action === "settle") {
      if (!requireStaff(req, res)) return;
      const id = String(b.orderId || "");
      if (!id) return res.status(400).json({ error: "orderId required" });
      const o = await getJSON("order:" + id);
      if (!o) return res.status(404).json({ error: "order not found" });
      if (o.payment !== "Wallet" || !o.walletReserved)
        return res.status(400).json({ error: "not a wallet order" });

      const phone = o.customer?.phone;
      if (o.walletSettled)
        return res.status(200).json({ ok: true, balance: await getBalance(phone), alreadySettled: true });

      const amt = Math.round(Number(o.walletAmount ?? o.total ?? o.subtotal));
      const r = await debit(phone, amt, "Order " + id);
      if (!r.ok) return res.status(402).json({ error: r.error || "insufficient wallet", balance: r.balance });

      o.payStatus = "paid";
      o.walletSettled = true;
      o.walletSettledAt = Date.now();
      o.walletBalanceAfter = r.balance;
      await setJSON("order:" + id, o);
      return res.status(200).json({ ok: true, balance: r.balance, orderId: id, amount: amt });
    }

    if (!b.phone) return res.status(400).json({ error: "phone required" });
    const amount = Math.round(Number(b.amount));
    if (!amount || amount < 100) return res.status(400).json({ error: "min top-up ฿100" });
    if (!SK) return res.status(200).json({ ok: false, error: "not_configured" });

    if (b.action === "topup_promptpay") {
      const satang = amount * 100;
      const src = await omise("/sources", { type: "promptpay", amount: satang, currency: "thb" });
      const c = await omise("/charges", {
        amount: satang, currency: "thb", source: src.id,
        description: `dankbkk.com wallet top-up ฿${amount}`,
        metadata: { topupId: "T" + Date.now(), phone: b.phone, kind: "topup" },
      });
      await setJSON("topup:" + c.id, { phone: b.phone, amount, bonusPct: BONUS, credited: false, chargeId: c.id }, 60 * 60 * 24 * 30);
      const qr = c.source?.scannable_code?.image?.download_uri || null;
      return res.status(200).json({ ok: true, chargeId: c.id, qr, willReceive: withBonus(amount), bonusPct: BONUS });
    }

    if (b.action === "topup_card") {
      if (!b.token) return res.status(400).json({ error: "card token required" });
      const satang = amount * 100;
      const c = await omise("/charges", {
        amount: satang, currency: "thb", card: b.token,
        description: `dankbkk.com wallet top-up ฿${amount}`,
        metadata: { phone: b.phone, kind: "topup" },
      });
      await setJSON("topup:" + c.id, { phone: b.phone, amount, bonusPct: BONUS, credited: false, chargeId: c.id }, 60 * 60 * 24 * 30);
      let balance = await getBalance(b.phone);
      if (c.paid) balance = await creditTopup(c.id);
      return res.status(200).json({ ok: Boolean(c.paid), paid: Boolean(c.paid), balance, willReceive: withBonus(amount), authorizeUri: c.authorize_uri || null, chargeId: c.id });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("wallet error:", e.message);
    return res.status(502).json({ ok: false, error: e.message });
  }
}
