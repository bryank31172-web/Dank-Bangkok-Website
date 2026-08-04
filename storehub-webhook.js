/* POST /api/storehub-webhook — instant menu refresh on a push from your
   backend. Point any of these at it:
     • StoreHub BackOffice / a middleware (e.g. storehub.io, Zapier, Make)
       configured to POST on inventory/product changes.
     • Your BRYAN POS app, on stock edit / receive / sale.
   It simply invalidates the shared menu cache so the very next read (and the
   storefront's next ~30s version poll) pulls fresh data — turning the normal
   near-real-time polling into effectively instant when a push is available.

   Shared-secret check: WEBHOOK_SECRET must be set, and sent as ?secret=... or
   header x-webhook-secret. The check used to be skipped entirely when the
   variable was unset. Nothing here is exposed by a refresh, but "if the secret
   is missing, let everyone in" is the same shape of mistake that left
   gbp-webhook able to mark orders paid, and a stranger who can force a cache
   bust in a loop can make the site re-fetch upstream all day. One required
   variable covers both webhooks.                                           */

import { bustMenu } from "./_menu.js";
import { requireEnv, safeEq } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ error: "method" });

  if (!requireEnv(res, ["WEBHOOK_SECRET"])) return;
  const got = req.query?.secret || req.headers?.["x-webhook-secret"];
  if (!safeEq(got, process.env.WEBHOOK_SECRET)) return res.status(401).json({ error: "bad secret" });
  try {
    await bustMenu();
    return res.status(200).json({ ok: true, refreshed: true });
  } catch (e) {
    return res.status(200).json({ ok: true });
  }
}
