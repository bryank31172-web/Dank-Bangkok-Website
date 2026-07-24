/* /api/pay — Omise (Opn Payments) integration.

   Env vars (from your Omise dashboard → Keys):
     OMISE_PUBLIC_KEY   pkey_...  (sent to the browser for card tokenization)
     OMISE_SECRET_KEY   skey_...  (server-side charging — never leaves here)

   Endpoints:
     GET  ?config=1                → {configured, publicKey}
     GET  ?chargeId=chrg_...       → {paid, status}  (also marks the order paid)
     POST {action:"charge_card", orderId, token}
     POST {action:"charge_promptpay", orderId}
          → {ok, chargeId, paid, qr}  (qr = PromptPay QR image URL to scan)

   Security: the charge AMOUNT is always read from the saved order record on
   the server — the client never supplies it. Card data is tokenized in the
   browser by Omise.js and only the one-time token reaches this endpoint.   */

import { getJSON, setJSON } from "./_store.js";

const SK = process.env.OMISE_SECRET_KEY || "";
const PK = process.env.OMISE_PUBLIC_KEY || "";
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

async function markPaid(orderId, chargeId) {
  try {
    const o = await getJSON("order:" + orderId);
    if (o && o.payStatus !== "paid") {
      o.payStatus = "paid";
      o.chargeId = chargeId;
      await setJSON("order:" + orderId, o);
    }
  } catch (e) { console.error("markPaid:", e.message); }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      if (req.query?.config) {
        return res.status(200).json({ configured: Boolean(SK && PK), publicKey: PK });
      }
      const id = req.query?.chargeId;
      if (!id) return res.status(400).json({ error: "chargeId required" });
      if (!SK) return res.status(200).json({ paid: false, status: "not_configured" });
      const c = await omise("/charges/" + encodeURIComponent(id));
      if (c.paid && c.metadata?.orderId) await markPaid(c.metadata.orderId, c.id);
      return res.status(200).json({ paid: Boolean(c.paid), status: c.status });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    if (!SK) return res.status(200).json({ ok: false, error: "not_configured" });

    const b = req.body || {};
    const order = await getJSON("order:" + b.orderId);
    if (!order) return res.status(404).json({ error: "order not found — place the order first" });
    const amount = Math.round(Number(order.total ?? order.subtotal) * 100); // satang (final total incl. delivery/discount)
    if (!amount || amount < 2000) return res.status(400).json({ error: "invalid amount" });

    if (b.action === "charge_card") {
      if (!b.token) return res.status(400).json({ error: "card token required" });
      const c = await omise("/charges", {
        amount, currency: "thb", card: b.token,
        description: `dankbkk.com order ${b.orderId}`,
        metadata: { orderId: b.orderId },
      });
      if (c.paid) await markPaid(b.orderId, c.id);
      return res.status(200).json({
        ok: c.paid || c.status === "pending", chargeId: c.id, paid: Boolean(c.paid),
        authorizeUri: c.authorize_uri || null,   // 3-D Secure redirect if required
        failure: c.failure_message || null,
      });
    }

    if (b.action === "charge_promptpay") {
      const src = await omise("/sources", { type: "promptpay", amount, currency: "thb" });
      const c = await omise("/charges", {
        amount, currency: "thb", source: src.id,
        description: `dankbkk.com order ${b.orderId}`,
        metadata: { orderId: b.orderId },
      });
      const qr = c.source?.scannable_code?.image?.download_uri || null;
      return res.status(200).json({ ok: true, chargeId: c.id, paid: Boolean(c.paid), qr });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("pay error:", e.message);
    return res.status(502).json({ ok: false, error: e.message });
  }
}
