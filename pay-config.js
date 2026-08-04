/* /api/pay2c2p — 2C2P Payment Token (v4.3), redirect flow.
   Docs: https://developer.2c2p.com/docs/api-payment-token
   Env:
     TWOC2P_MERCHANT_ID   your 2C2P merchant ID
     TWOC2P_SECRET        your 2C2P secret key (JWT HMAC-SHA256)
     TWOC2P_ENV           "sandbox" (default) or "production"

   Flow: POST {orderId} → we build a JWT-signed paymentToken request, call
   2C2P, decode the JWT response, and return {webPaymentUrl}. The storefront
   redirects the customer there to pay; 2C2P then calls /api/2c2p-webhook
   (backend) and returns the shopper to the frontend URL.                    */

import crypto from "node:crypto";
import { getJSON } from "./_store.js";

const MID = process.env.TWOC2P_MERCHANT_ID || "";
const SECRET = process.env.TWOC2P_SECRET || "";
const HOST = (process.env.TWOC2P_ENV === "production")
  ? "https://pgw.2c2p.com" : "https://sandbox-pgw.2c2p.com";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
function jwtSign(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(header + "." + body).digest());
  return `${header}.${body}.${sig}`;
}
function jwtDecode(token) {
  const parts = String(token).split(".");
  return JSON.parse(Buffer.from(parts[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString());
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!MID || !SECRET) return res.status(200).json({ ok: false, error: "not_configured" });

  const b = req.body || {};
  const order = await getJSON("order:" + b.orderId);
  if (!order) return res.status(404).json({ error: "order not found" });
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
  const proto = (req.headers?.["x-forwarded-proto"] || "https");

  const payload = {
    merchantID: MID,
    invoiceNo: String(b.orderId).replace(/[^A-Za-z0-9]/g, "").slice(0, 20),
    description: "dankbkk.com order",
    amount: Number((order.total ?? order.subtotal)).toFixed(2),
    currencyCode: "THB",
    frontendReturnUrl: `${proto}://${host}/?paid=2c2p&order=${b.orderId}`,
    backendReturnUrl: `${proto}://${host}/api/2c2p-webhook`,
    paymentChannel: [], // let 2C2P show all enabled options (cards, PromptPay, wallets)
  };
  try {
    const r = await fetch(`${HOST}/payment/4.3/paymentToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: jwtSign(payload) }),
    });
    const j = await r.json();
    const decoded = j.payload ? jwtDecode(j.payload) : j;
    if (decoded.webPaymentUrl) return res.status(200).json({ ok: true, webPaymentUrl: decoded.webPaymentUrl });
    return res.status(502).json({ ok: false, error: decoded.respDesc || "2c2p error", respCode: decoded.respCode });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
}
