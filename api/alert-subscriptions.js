import { requireStaff } from "./_auth.js";
import { saveSubscription, removeSubscription, pushSubscriptionHealth, vapidPublicKey } from "./_alerts.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireStaff(req, res)) return;
  if (req.method === "GET") return res.status(200).json({ ...(await pushSubscriptionHealth()), publicKey: vapidPublicKey() });
  if (req.method === "POST") {
    try {
      const count = await saveSubscription(req.body?.subscription, req.body?.label);
      return res.status(200).json({ ok: true, subscribers: count });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }
  if (req.method === "DELETE") {
    const count = await removeSubscription(req.body?.endpoint);
    return res.status(200).json({ ok: true, subscribers: count });
  }
  return res.status(405).json({ error: "method not allowed" });
}
