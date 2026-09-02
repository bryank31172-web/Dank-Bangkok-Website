import { createStaffSession, staffIdentity } from "./_auth.js";
import { directoryConfigured, findStaffByKey } from "./_staff-directory.js";
import { requireRate } from "./_ratelimit.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireRate(req, res, "staff-session", 10, 900))) return;
  const key = String(req.body?.key || "").trim(); if (!key) return res.status(400).json({ error: "Staff key required" });
  let staff = staffIdentity(key);
  if (!staff && directoryConfigured()) staff = await findStaffByKey(key);
  if (!staff) return res.status(401).json({ error: "Wrong key" });
  const token = createStaffSession(staff);
  return res.status(200).json({ ok: true, token: token || key, staff: { id: staff.id, name: staff.name, role: staff.role } });
}
