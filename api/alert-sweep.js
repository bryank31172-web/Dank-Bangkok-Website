import { requireStaff, safeEq } from "./_auth.js";
import { sweepPendingAlerts } from "./_alerts.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cron = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const cronOk = Boolean(process.env.CRON_SECRET) && safeEq(cron, process.env.CRON_SECRET);
  if (!cronOk && !requireStaff(req, res)) return;
  const report = await sweepPendingAlerts();
  return res.status(200).json({ ok: true, ...report });
}
