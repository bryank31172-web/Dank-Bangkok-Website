/* /api/paybeam — Beam Checkout (beamcheckout.com), a Thai gateway.

   Bryan picked this over Omise on 25 Aug 2026: Omise had taken a month to
   approve and Beam charges 0% on PromptPay QR, which is how nearly every
   customer here actually pays. Cards are quoted from ~1.8%.

   Env (Beam dashboard → Developers → API keys):
     BEAM_MERCHANT_ID    the merchant id — Basic-auth username
     BEAM_API_KEY        the secret api key — Basic-auth password. Server only.
     BEAM_PARTNER_ID     optional. Only partner integrations send this; a shop
                         using its own account leaves it unset.
     BEAM_API_BASE       optional override. Point it at the Playground host to
                         test without moving money; unset means production.

   Actions:
     POST {orderId, action:"qr"}    → PromptPay QR to scan  (0% fee)
     POST {orderId, action:"card"}  → hosted card page to redirect to
     GET  ?chargeId=...             → poll a charge, marks the order paid

   Beam confirms payment by webhook to /api/beam-webhook. The GET poll exists
   because a customer watching a QR wants the screen to change the moment they
   pay, and a webhook cannot reach the phone. The webhook remains the source of
   truth — it arrives even if the customer closes the tab mid-payment.

   As with every other gateway here, the AMOUNT IS READ FROM THE SAVED ORDER
   on the server. A client that can name its own price is a shop that can be
   charged ฿1 for ฿10,000 of flower.                                          */

import { getJSON, setJSON } from "./_store.js";

const MID = process.env.BEAM_MERCHANT_ID || "";
const KEY = process.env.BEAM_API_KEY || "";
const PARTNER = process.env.BEAM_PARTNER_ID || "";
const BASE = (process.env.BEAM_API_BASE || "https://api.beamcheckout.com").replace(/\/+$/, "");

export const beamOn = () => Boolean(MID && KEY);

/* Beam takes the amount as an integer in the smallest unit — satang, 100 to
   the baht — the same convention Omise uses in api/pay.js.

   This is the one number in this file worth being paranoid about: if it were
   actually baht, every order would be billed one hundred times over. It is in
   its own function, used everywhere, so there is exactly one line to change
   and one place to look. Confirm it against the Playground with a known
   amount before taking real money — see BEAM.md. */
const toMinorUnits = (baht) => Math.round(Number(baht) * 100);

const auth = () => "Basic " + Buffer.from(MID + ":" + KEY).toString("base64");

async function beam(path, body) {
  const headers = { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json" };
  if (PARTNER) headers["X-Beam-Partner-ID"] = PARTNER;
  const r = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error body */ }
  if (!r.ok) {
    const msg = (j && (j.message || j.error || j.code)) || text.slice(0, 200) || ("HTTP " + r.status);
    throw new Error("beam " + r.status + ": " + msg);
  }
  return j || {};
}

/* Beam returns the next step as an "action". A QR payment comes back as an
   encoded image; a card payment as a URL to send the browser to. The exact
   casing has moved between versions of their docs, so read every spelling
   rather than trusting one and showing the customer a blank box. */
function readQR(j) {
  const a = j.action || j.nextAction || {};
  const img = a.encodedImage || a.encoded_image || j.encodedImage || {};
  const raw = (typeof img === "string" ? img : (img.imageData || img.data || img.image || img.base64 || "")) || "";
  if (!raw) return null;
  return /^data:|^https?:/.test(raw) ? raw : "data:image/png;base64," + raw;
}
function readRedirect(j) {
  const a = j.action || j.nextAction || {};
  return a.redirectUrl || a.redirect_url || a.url || j.redirectUrl || j.paymentUrl || j.webPaymentUrl || null;
}
const chargeIdOf = (j) => j.chargeId || j.id || j.charge_id || null;

/* Beam's own words for a settled payment. Anything not on this list is left
   alone rather than guessed at — an order wrongly stamped paid is stock that
   walks out of the shop for free. */
const PAID = /^(succeeded|success|paid|completed|captured)$/i;
export const beamPaid = (status) => PAID.test(String(status || ""));

export async function markOrderPaid(orderId, chargeId) {
  try {
    const o = await getJSON("order:" + orderId);
    if (o && o.payStatus !== "paid") {
      o.payStatus = "paid";
      o.chargeId = chargeId || o.chargeId;
      o.gateway = "beam";
      await setJSON("order:" + orderId, o);
    }
  } catch (e) { console.error("beam markOrderPaid:", e.message); }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!beamOn()) return res.status(200).json({ ok: false, error: "not_configured" });

  try {
    if (req.method === "GET") {
      const id = req.query?.chargeId;
      if (!id) return res.status(400).json({ error: "chargeId required" });
      const c = await beam("/api/v1/charges/" + encodeURIComponent(id));
      const paid = beamPaid(c.status);
      const ref = c.referenceId || c.reference_id;
      if (paid && ref) await markOrderPaid(ref, id);
      return res.status(200).json({ paid, status: c.status || "unknown" });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const b = req.body || {};
    const order = await getJSON("order:" + b.orderId);
    if (!order) return res.status(404).json({ error: "order not found — place the order first" });

    const baht = Number(order.total ?? order.subtotal);
    if (!Number.isFinite(baht) || baht <= 0) return res.status(400).json({ error: "invalid amount" });
    const amount = toMinorUnits(baht);

    const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "www.dankbangkok.com";
    const returnUrl = `https://${host}/?paid=beam&order=${encodeURIComponent(b.orderId)}`;

    const common = {
      amount,
      currency: "THB",
      referenceId: String(b.orderId),
      returnUrl,
    };

    if (b.action === "qr") {
      const j = await beam("/api/v1/charges", {
        ...common,
        paymentMethod: {
          paymentMethodType: "QR_PROMPT_PAY",
          /* Beam expires the QR itself. Fifteen minutes is long enough to find
             a banking app and short enough that a stale code in a screenshot
             is not still chargeable tomorrow. */
          qrPromptPay: { expiryTime: new Date(Date.now() + 15 * 60 * 1000).toISOString() },
        },
      });
      const qr = readQR(j);
      return res.status(200).json({
        ok: Boolean(qr), qr, chargeId: chargeIdOf(j),
        paid: beamPaid(j.status), amount: baht,
        error: qr ? undefined : "no QR in Beam's reply",
      });
    }

    if (b.action === "card") {
      const j = await beam("/api/v1/charges", { ...common, paymentMethod: { paymentMethodType: "CARD" } });
      const redirect = readRedirect(j);
      return res.status(200).json({
        ok: Boolean(redirect), redirect, chargeId: chargeIdOf(j),
        paid: beamPaid(j.status), amount: baht,
        error: redirect ? undefined : "no payment page in Beam's reply",
      });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    /* Never throw a 500 at a customer holding a full cart: the order is
       already saved, so say the payment could not start and let the checkout
       fall back to cash or a transfer. Same rule as the Redis outage of
       13 Aug — a broken dependency must not close the shop. */
    console.error("beam error:", e.message);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
