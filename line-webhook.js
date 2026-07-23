/* POST /api/2c2p-webhook — 2C2P backend payment notification.
   2C2P posts { payload: <JWT> }; we verify by decoding with our secret and
   mark the order paid when respCode indicates success. */
import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";

const SECRET = process.env.TWOC2P_SECRET || "";

function jwtVerifyDecode(token) {
  const [h, p, s] = String(token).split(".");
  const expect = Buffer.from(crypto.createHmac("sha256", SECRET).update(h + "." + p).digest())
    .toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  if (expect !== s) throw new Error("bad signature");
  return JSON.parse(Buffer.from(p.replace(/-/g,"+").replace(/_/g,"/"), "base64").toString());
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!SECRET) return res.status(200).json({ ok: true });
  try {
    const data = jwtVerifyDecode((req.body || {}).payload);
    // respCode "0000" = success; some accounts use "2000" for pending-settlement
    const ok = data.respCode === "0000" || /success|settled|paid/i.test(data.respDesc || "");
    if (ok && data.invoiceNo) {
      // invoiceNo was the order id with non-alphanumerics stripped; try both
      for (const key of [data.invoiceNo, "DK" + data.invoiceNo.replace(/^DK/i, "")]) {
        const o = await getJSON("order:" + key);
        if (o) { o.payStatus = "paid"; o.gateway = "2c2p"; await setJSON("order:" + key, o); break; }
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("2c2p-webhook:", e.message);
    return res.status(200).json({ ok: true });
  }
}
