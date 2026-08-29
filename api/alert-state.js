import { requireStaff } from "./_auth.js";
import { listPendingAlerts } from "./_alerts.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  if (!requireStaff(req, res)) return;
  return res.status(200).json({ alerts: await listPendingAlerts() });
}
