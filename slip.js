/* /api/slip — customer uploads a payment slip (crypto / transfer / PromptPay).
     POST {orderId, image}  (image = data URL, resized client-side)
        → stores the slip, flags the order, pings staff (Telegram) if set.
     GET  ?id=<orderId>&key=<STAFF_KEY>  → { image }  (staff console viewer)
   Stored separately from the order so the orders list stays light.          */
import { getJSON, setJSON } from "./_store.js";
import { notifyStaffLine } from "./_line.js";

const STAFF_KEY = process.env.STAFF_KEY || "dankstaff";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    if (req.query?.key !== STAFF_KEY) return res.status(401).json({ error: "bad key" });
    const img = await getJSON("slip:" + req.query.id);
    return res.status(200).json({ image: img || null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const b = req.body || {};
  if (!b.orderId || !b.image || !/^data:image\//.test(b.image)) return res.status(400).json({ error: "orderId + image required" });
  if (b.image.length > 600000) return res.status(413).json({ error: "image too large" }); // ~450KB

  await setJSON("slip:" + b.orderId, b.image, 60 * 60 * 24 * 60);
  const o = await getJSON("order:" + b.orderId);
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
