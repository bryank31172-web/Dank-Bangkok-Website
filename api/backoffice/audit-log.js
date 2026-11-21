/* /api/backoffice/audit-log — read-only view onto bo_audit_log.
     GET ?entity_type=&entity_id=&actor=&from=&to=&limit=100
   from is inclusive and to is exclusive; both are ISO timestamps with a timezone.
   Covers the administrative mutations across suppliers, purchase orders,
   recipes, ingredients, stores, expenses (incl. auto-generated recurring
   ones), and staff account/role/scope changes — written by each endpoint's
   own boAudit() call (api/_bo-db.js). Stock movements have their own
   separate, already-append-only trail: /api/backoffice/inventory. */
import { requirePermission } from "../_auth.js";
import { boConfigured, boSelect, enc } from "../_bo-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  if (!requirePermission(req, res, "settings")) return;

  const q = req.query || {};
  const parts = ["select=*", "order=created_at.desc"];
  if (q.entity_type) parts.push(`entity_type=eq.${enc(q.entity_type)}`);
  if (q.entity_id) parts.push(`entity_id=eq.${enc(q.entity_id)}`);
  if (q.actor) parts.push(`actor_id=eq.${enc(q.actor)}`);
  const timestamp = value => {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  };
  const from = q.from ? timestamp(q.from) : null;
  const to = q.to ? timestamp(q.to) : null;
  if ((q.from && !from) || (q.to && !to) || (from && to && from >= to)) {
    return res.status(400).json({ error: "invalid audit date range" });
  }
  if (from) parts.push(`created_at=gte.${enc(from)}`);
  if (to) parts.push(`created_at=lt.${enc(to)}`);
  parts.push(`limit=${Math.min(500, Math.max(1, Number(q.limit) || 100))}`);

  try {
    const rows = await boSelect("bo_audit_log", parts.join("&"));
    return res.status(200).json({ rows: rows || [] });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
