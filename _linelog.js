/* /api/paygbp — GB Prime Pay (v3). Docs: https://doc.gbprimepay.com
   Env:
     GBP_SECRET_KEY   secret key (server; Basic auth username, blank password)
     GBP_PUBLIC_KEY   public key (browser card tokenisation; optional)
   Actions:
     POST {orderId, action:"qr"}            → PromptPay QR (data URL) to scan
     POST {orderId, action:"card", token}   → charge a tokenised card
   Amounts are read from the saved order (server-side). GBP notifies
   /api/gbp-webhook (set as backgroundUrl) to confirm payment.               */

import { getJSON } from "./_store.js";

const SECRET = process.env.GBP_SECRET_KEY || "";
const BASE = "https://api.gbprimepay.com";
const AUTH = () => "Basic " + Buffer.from(SECRET + ":").toString("base64");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!SECRET) return res.status(200).json({ ok: false, error: "not_configured" });

  const b = req.body || {};
  const order = await getJSON("order:" + b.orderId);
  if (!order) return res.status(404).json({ error: "order not found" });
  const amount = Number((order.total ?? order.subtotal)).toFixed(2);
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
  const bg = `https://${host}/api/gbp-webhook`;
  const referenceNo = String(b.orderId);

  try {
    if (b.action === "qr") {
      const r = await fetch(`${BASE}/v3/qrcode`, {
        method: "POST",
        headers: { Authorization: AUTH(), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ amount, referenceNo, backgroundUrl: bg, detail: "dankbkk.com order" }),
      });
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("image")) {
        const buf = Buffer.from(await r.arrayBuffer());
        return res.status(200).json({ ok: true, qr: "data:image/png;base64," + buf.toString("base64"), referenceNo });
      }
      const j = await r.json();
      const qr = j.qrcode || j.qrCode || j.resultUrl || (j.data && (j.data.qrcode || j.data.qrImage)) || null;
      return res.status(200).json({ ok: Boolean(qr), qr, referenceNo, raw: j });
    }
    if (b.action === "card") {
      if (!b.token) return res.status(400).json({ error: "card token required" });
      const r = await fetch(`${BASE}/v3/charge`, {
        method: "POST",
        headers: { Authorization: AUTH(), "Content-Type": "application/json" },
        body: JSON.stringify({
          token: b.token, amount, referenceNo, detail: "dankbkk.com order",
          customerName: order.customer?.name || "", responseUrl: `https://${host}/?paid=gbp&order=${b.orderId}`,
          backgroundUrl: bg,
        }),
      });
      const j = await r.json();
      const paid = j.resultCode === "00" || /success/i.test(j.resultMessage || "");
      return res.status(200).json({ ok: paid, paid, redirect: j.gbpReferenceNo ? j.data : (j.redirectUrl || null), raw: j });
    }
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
}
