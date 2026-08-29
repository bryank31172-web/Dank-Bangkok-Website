import { requireStaff } from "./_auth.js";
import { configuredChannels, listOrderAlerts, pushSubscriptionHealth } from "./_alerts.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  if (!requireStaff(req, res)) return;
  const alerts = await listOrderAlerts(Number(req.query?.limit) || 100);
  return res.status(200).json({
    alerts,
    configured: configuredChannels(),
    push: await pushSubscriptionHealth(),
  });
}
