/* POST /api/omise-webhook — Omise event notifications.
   Set this URL in your Omise dashboard → Webhooks:
     https://dankbkk.com/api/omise-webhook
   On charge.complete we re-fetch the charge from Omise's API using the
   secret key (never trusting the webhook body alone) and mark the matching
   order as paid — so the staff console shows PAID even if the customer
   closed the page before the QR payment confirmed.                        */

import { getJSON, setJSON } from "./_store.js";
import { credit } from "./_wallet.js";

const SK = process.env.OMISE_SECRET_KEY || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!SK) return res.status(200).json({ ok: true }); // nothing to do

  try {
    const evt = req.body || {};
    const chargeId = evt?.data?.id;
    if (evt.key === "charge.complete" && chargeId) {
      // verify against the API — don't trust the webhook payload
      const r = await fetch("https://api.omise.co/charges/" + encodeURIComponent(chargeId), {
        headers: { Authorization: "Basic " + Buffer.from(SK + ":").toString("base64") },
      });
      const c = await r.json();
      if (c.paid && c.metadata?.orderId) {
        const o = await getJSON("order:" + c.metadata.orderId);
        if (o && o.payStatus !== "paid") {
          o.payStatus = "paid";
          o.chargeId = c.id;
          await setJSON("order:" + c.metadata.orderId, o);
        }
      }
      // wallet top-up: credit amount + bonus once
      if (c.paid && c.metadata?.kind === "topup") {
        const rec = await getJSON("topup:" + c.id);
        if (rec && !rec.credited) {
          const bonus = Math.round((rec.amount * (rec.bonusPct || 10)) / 100);
          await credit(rec.phone, rec.amount + bonus, `Top-up ฿${rec.amount} +${rec.bonusPct || 10}% bonus`);
          rec.credited = true;
          await setJSON("topup:" + c.id, rec, 60 * 60 * 24 * 30);
        }
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("omise-webhook:", e.message);
    return res.status(200).json({ ok: true }); // 200 so Omise doesn't retry forever
  }
}
