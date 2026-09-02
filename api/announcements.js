import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { keyFrom, requireStaff, requireManagement, staffRole, isManagementRole } from "./_auth.js";

const STORE_KEY = "staff:announcements";
const TTL = 60 * 60 * 24 * 365 * 3;
const PRIORITIES = new Set(["normal", "important", "urgent"]);
const AUDIENCES = new Set(["all", "professional-staff", "part-time-staff"]);
const STATUSES = new Set(["draft", "published", "scheduled"]);
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

function canRead(item, role, now = Date.now()) {
  if (isManagementRole(role)) return true;
  if (item.status === "draft") return false;
  if (item.status === "scheduled" && new Date(item.publishAt || 0).getTime() > now) return false;
  return item.audience === "all" || item.audience === role;
}
function normalize(body, existing = {}) {
  const status = STATUSES.has(body.status) ? body.status : "published";
  const publishAt = status === "scheduled" ? new Date(body.publishAt || 0) : null;
  if (status === "scheduled" && Number.isNaN(publishAt.getTime())) throw new Error("A valid publish date is required");
  const targets = {
    portal: true,
    line: Boolean(body.targets?.line),
    telegram: Boolean(body.targets?.telegram),
  };
  return {
    ...existing,
    title: clean(body.title, 120),
    body: clean(body.body, 2000),
    priority: PRIORITIES.has(body.priority) ? body.priority : "normal",
    audience: AUDIENCES.has(body.audience) ? body.audience : "all",
    status,
    publishAt: status === "scheduled" ? publishAt.toISOString() : null,
    targets,
    delivery: {
      portal: "ready",
      line: targets.line ? "pending" : "not-requested",
      telegram: targets.telegram ? "pending" : "not-requested",
    },
  };
}
function sorted(items) {
  const rank = { urgent: 3, important: 2, normal: 1 };
  return [...items].sort((a, b) => (rank[b.priority] - rank[a.priority]) || (new Date(b.publishAt || b.createdAt) - new Date(a.publishAt || a.createdAt)));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireStaff(req, res)) return;
  const role = staffRole(keyFrom(req));
  const items = (await getJSON(STORE_KEY)) || [];
  if (req.method === "GET") return res.status(200).json({ ok: true, role, canManage: isManagementRole(role), announcements: sorted(items.filter((x) => canRead(x, role))) });
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  const managerRole = requireManagement(req, res); if (!managerRole) return;
  const action = clean(req.body?.action, 20);
  if (action === "delete") {
    const id = clean(req.body?.id, 80), next = items.filter((x) => x.id !== id);
    if (next.length === items.length) return res.status(404).json({ error: "Announcement not found" });
    await setJSON(STORE_KEY, next, TTL);
    return res.status(200).json({ ok: true });
  }
  if (action !== "create" && action !== "update") return res.status(400).json({ error: "Unknown action" });
  try {
    const id = clean(req.body?.id, 80), index = items.findIndex((x) => x.id === id);
    if (action === "update" && index < 0) return res.status(404).json({ error: "Announcement not found" });
    const now = new Date().toISOString();
    const item = normalize(req.body, index >= 0 ? items[index] : { id: "AN" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString("hex").toUpperCase(), createdAt: now, createdBy: managerRole });
    if (!item.title || !item.body) return res.status(400).json({ error: "Title and message are required" });
    item.updatedAt = now; item.updatedBy = managerRole;
    if (index >= 0) items[index] = item; else items.push(item);
    await setJSON(STORE_KEY, items, TTL);
    return res.status(200).json({ ok: true, announcement: item });
  } catch (e) { return res.status(400).json({ error: e.message || "Invalid announcement" }); }
}
