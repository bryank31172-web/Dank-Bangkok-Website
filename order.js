/* POST /api/storehub-webhook — instant menu refresh on a push from your
   backend. Point any of these at it:
     • StoreHub BackOffice / a middleware (e.g. storehub.io, Zapier, Make)
       configured to POST on inventory/product changes.
     • Your BRYAN POS app, on stock edit / receive / sale.
   It simply invalidates the shared menu cache so the very next read (and the
   storefront's next ~30s version poll) pulls fresh data — turning the normal
   near-real-time polling into effectively instant when a push is available.

   Optional shared-secret check: set WEBHOOK_SECRET and send it as
   ?secret=... or header x-webhook-secret. If unset, the endpoint is open
   (fine — it only forces a cache refresh, exposes nothing).                */

import { bustMenu } from "./_menu.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ error: "method" });

  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const got = req.query?.secret || req.headers?.["x-webhook-secret"];
    if (got !== secret) return res.status(401).json({ error: "bad secret" });
  }
  try {
    await bustMenu();
    return res.status(200).json({ ok: true, refreshed: true });
  } catch (e) {
    return res.status(200).json({ ok: true });
  }
}
