import crypto from "node:crypto";
import { keyFrom, requireManagement, staffIdentity } from "./_auth.js";
import { directoryConfigured, getStaffDirectory, hashStaffKey, newStaffKey, saveStaffDirectory, validRoles } from "./_staff-directory.js";

const clean = (v, max = 100) => String(v ?? "").trim().slice(0, max);
const publicRow = (x) => ({ id: x.id, name: x.name, role: x.role, active: x.active !== false, keyHint: x.keyHint, createdAt: x.createdAt, createdBy: x.createdBy });
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const managerRole = requireManagement(req, res); if (!managerRole) return;
  if (!directoryConfigured()) return res.status(503).json({ error: "STAFF_SESSION_SECRET or STAFF_KEY_PEPPER is required" });
  const actor = staffIdentity(keyFrom(req)), rows = await getStaffDirectory();
  if (req.method === "GET") return res.status(200).json({ ok: true, staff: rows.map(publicRow) });
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  const action = clean(req.body?.action, 20);
  if (action === "create") {
    const name = clean(req.body?.name), role = clean(req.body?.role, 30);
    if (!name || !validRoles.has(role)) return res.status(400).json({ error: "Valid name and role are required" });
    if (role === "manager" && managerRole !== "owner") return res.status(403).json({ error: "Only the Owner can create a Manager" });
    const key = newStaffKey(), now = new Date().toISOString();
    const row = { id: "ST" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase(), name, role, active: true, keyHash: hashStaffKey(key), keyHint: "••••" + key.slice(-4), createdAt: now, createdBy: actor?.name || managerRole };
    rows.push(row); await saveStaffDirectory(rows);
    return res.status(200).json({ ok: true, staff: publicRow(row), key, warning: "This key is shown only once" });
  }
  if (action === "deactivate" || action === "activate" || action === "delete") {
    const id = clean(req.body?.id, 80), index = rows.findIndex((x) => x.id === id); if (index < 0) return res.status(404).json({ error: "Staff member not found" });
    const target = rows[index]; if (target.role === "manager" && managerRole !== "owner") return res.status(403).json({ error: "Only the Owner can manage a Manager" });
    if (actor?.id === target.id) return res.status(400).json({ error: "You cannot change your own access" });
    if (action === "delete") rows.splice(index, 1); else target.active = action === "activate";
    await saveStaffDirectory(rows); return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: "Unknown action" });
}
