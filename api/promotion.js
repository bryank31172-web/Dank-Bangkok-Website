import { validatePromotion } from "./_promotion.js";
import { requireRate } from "./_ratelimit.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireRate(req, res, "promotion", 30, 600))) return;

  try {
    const result = await validatePromotion(req.body?.code, req.body?.subtotal, req.body?.deliveryFee);
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  } catch (error) {
    console.error("promotion validation failed:", error.message);
    return res.status(500).json({ ok: false, reason: "unavailable" });
  }
}
