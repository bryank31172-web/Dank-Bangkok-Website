/* POST /api/eta — compute a delivery ETA and (optionally) send it on LINE.
     { destLat, destLng } or { address }   → required (the customer's location)
     { replyToken }                        → reply in the LINE chat, OR
     { to, key }                           → push to a LINE userId (needs STAFF_KEY)
   Returns { ok, minutes, travelMin, km, text }.
   Used by the LINE webhook (location pin) and can be called by staff tools.   */
import { computeEta, etaText, routeConfigured } from "./_route.js";
import { lineReply, linePush } from "./_line.js";
import { requireStaff } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!routeConfigured()) return res.status(200).json({ ok: false, error: "route provider not configured" });

  const b = req.body || {};
  if (b.destLat == null && b.destLng == null && !b.address)
    return res.status(400).json({ error: "destLat/destLng or address required" });

  // Pushing a message to an arbitrary LINE userId is a staff action and costs a
  // billable message. The check used to sit further down, after the routing
  // call had already been made and paid for, so an unauthorised caller still
  // burned a Google Routes request every time. Authorise first, work second.
  if (b.to && !b.replyToken && !requireStaff(req, res)) return;

  const eta = await computeEta({ destLat: b.destLat, destLng: b.destLng, address: b.address });
  const text = etaText(eta);

  // deliver on LINE if asked
  if (b.replyToken) await lineReply(b.replyToken, text);
  else if (b.to) await linePush(b.to, text);

  return res.status(200).json({ ok: eta.ok, minutes: eta.minutes, travelMin: eta.travelMin, km: eta.km, text });
}
