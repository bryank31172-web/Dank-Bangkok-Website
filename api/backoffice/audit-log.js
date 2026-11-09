/* /api/backoffice/audit-log — read-only view onto bo_audit_log.
     GET ?entity_type=&entity_id=&actor=&limit=100
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
  parts.push(`limit=${Math.min(500, Math.max(1, Number(q.limit) || 100))}`);

  try {
    const rows = await boSelect("bo_audit_log", parts.join("&"));
    return res.status(200).json({ rows: rows || [] });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
