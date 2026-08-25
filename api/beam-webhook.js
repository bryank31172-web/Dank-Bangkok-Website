/* POST /api/beam-webhook — Beam Checkout payment notification.

   This is the reliable half of the payment. The customer's browser may be
   closed, asleep or on the underground by the time the bank settles; Beam
   posts here regardless, and this is what actually stamps an order paid.

   Set it in the Beam dashboard → Developers → Webhooks as:
     https://www.dankbangkok.com/api/beam-webhook?secret=YOUR_WEBHOOK_SECRET

   The secret in the query string is the whole of the authentication, exactly
   as in api/gbp-webhook.js. Without it, anyone who can guess an order id can
   mark it paid and walk out with the flower. So an unset WEBHOOK_SECRET
   refuses every callback rather than waving them through — the earlier
   `if (SECRET && ...)` spelling of this check meant that leaving the variable
   blank did not weaken the guard, it removed it.

   We do not trust the amount in the callback either: the order already knows
   what it costs. This only ever moves an order from unpaid to paid.          */

import { getJSON, setJSON } from "./_store.js";
import { requireEnv, safeEq } from "./_auth.js";
import { beamPaid } from "./paybeam.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!requireEnv(res, ["WEBHOOK_SECRET"])) return;
  if (!safeEq(req.query?.secret, process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "bad secret" });
  }

  try {
    const b = req.body || {};
    const d = b.data || b.charge || b;
    const ref = d.referenceId || d.reference_id || d.orderId;
    const status = d.status || b.status || b.event || b.type;
    const chargeId = d.chargeId || d.id || d.charge_id || null;

    if (ref && beamPaid(status)) {
      const o = await getJSON("order:" + ref);
      if (o && o.payStatus !== "paid") {
        o.payStatus = "paid";
        o.gateway = "beam";
        if (chargeId) o.chargeId = chargeId;
        await setJSON("order:" + ref, o);
      }
    }
    /* Always 200. A retrying gateway that cannot get an acknowledgement will
       hammer this endpoint for hours over an order we have already handled,
       or one that was never ours to begin with. */
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("beam-webhook:", e.message);
    return res.status(200).json({ ok: true });
  }
}
