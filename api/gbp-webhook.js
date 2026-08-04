/* POST /api/gbp-webhook — GB Prime Pay payment notification (backgroundUrl).
   GBP posts the result (referenceNo + resultCode); mark the order paid on
   success. GBP fields vary a little by product, so we check the common ones. */
import { getJSON, setJSON } from "./_store.js";
import { requireEnv, safeEq } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  /* The secret is required in the callback URL: set the GBP backgroundUrl to
     .../api/gbp-webhook?secret=YOUR_WEBHOOK_SECRET. This is the only thing
     standing between a stranger and marking any order they can name as paid.
     It used to read `if (SECRET && …)`, so leaving WEBHOOK_SECRET unset didn't
     weaken the check — it removed it, and the endpoint that stamps orders PAID
     was open to the world. Unset now means every callback is refused. */
  if (!requireEnv(res, ["WEBHOOK_SECRET"])) return;
  if (!safeEq(req.query?.secret, process.env.WEBHOOK_SECRET)) return res.status(401).json({ error: "bad secret" });
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
