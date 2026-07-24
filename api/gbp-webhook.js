/* POST /api/gbp-webhook — GB Prime Pay payment notification (backgroundUrl).
   GBP posts the result (referenceNo + resultCode); mark the order paid on
   success. GBP fields vary a little by product, so we check the common ones. */
import { getJSON, setJSON } from "./_store.js";

const SECRET = process.env.WEBHOOK_SECRET || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  // If a secret is configured, require it in the callback URL (set the GBP
  // backgroundUrl to .../api/gbp-webhook?secret=YOUR_WEBHOOK_SECRET). This stops
  // anyone from POSTing a fake "paid" for a known order id.
  if (SECRET && req.query?.secret !== SECRET) return res.status(401).json({ error: "bad secret" });
  try {
    const b = req.body || {};
    const ref = b.referenceNo || b.referenceno || b.data?.referenceNo;
    const ok = b.resultCode === "00" || /success|paid/i.test(b.resultMessage || b.status || "");
    if (ref && ok) {
      const o = await getJSON("order:" + ref);
      if (o) { o.payStatus = "paid"; o.gateway = "gbp"; await setJSON("order:" + ref, o); }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true });
  }
}
