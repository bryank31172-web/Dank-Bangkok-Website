/* /api/slip — customer uploads a payment slip (crypto / transfer / PromptPay).
     POST {orderId, image}  (image = data URL, resized client-side)
        → stores the slip, flags the order, pings staff (Telegram) if set.
     GET  ?id=<orderId>&key=<STAFF_KEY>  → { image }  (staff console viewer)
   Stored separately from the order so the orders list stays light.

   The GET has always needed the staff key; the POST needed nothing at all, so
   anyone could store a data URL under any order id they liked — including ids
   that had never existed — and a member of staff would later open it in their
   browser. Uploads now have to be for an order that really exists, from a page
   on this deployment, within a rate limit, and the payload has to actually
   parse as a base64 image of a sane size. Staff tooling with the key skips the
   first three. The order id is the capability here: since api/order.js gives
   ids real entropy, knowing one means you either placed that order or you work
   here.                                                                     */
import { getJSON, setJSON } from "./_store.js";
import { notifyStaffLine } from "./_line.js";
import { requireStaff, isStaff, sameOrigin } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";

const MAX_IMAGE = 600000; // ~450KB of base64; the storefront resizes before sending
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    if (!requireStaff(req, res)) return;
    const img = await getJSON("slip:" + req.query.id);
    return res.status(200).json({ image: img || null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const b = req.body || {};
  const staff = isStaff(req);
  if (!staff) {
    if (!sameOrigin(req)) return res.status(403).json({ error: "forbidden" });
    if (!(await requireRate(req, res, "slip", 10, 600))) return;
  }
  if (!b.orderId || typeof b.image !== "string") return res.status(400).json({ error: "orderId + image required" });
  if (b.image.length > MAX_IMAGE) return res.status(413).json({ error: "image too large" });
  if (!IMAGE_DATA_URL.test(b.image)) return res.status(400).json({ error: "image must be a base64 image data URL" });

  const o = await getJSON("order:" + b.orderId);
  if (!o && !staff) return res.status(404).json({ error: "unknown order" });

  await setJSON("slip:" + b.orderId, b.image, 60 * 60 * 24 * 60);
  if (o) { o.slipUploaded = true; await setJSON("order:" + b.orderId, o); }

  // ping staff
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `🧾 Payment slip uploaded for order ${b.orderId}\nReview: https://${host}/staff.html#orders` }),
      });
    } catch (e) {}
  }
  // LINE alert to staff (if configured)
  try {
    const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
    await notifyStaffLine(`🧾 Payment slip uploaded for order ${b.orderId}\nReview: https://${host}/staff.html#orders`);
  } catch (e) {}
  return res.status(200).json({ ok: true });
}
