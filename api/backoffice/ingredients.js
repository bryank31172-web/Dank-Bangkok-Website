/* /api/backoffice/ingredients — kitchen ingredient master (name, unit, cost/unit).
     GET → active ingredients (?all=1 includes inactive)
     POST   { name, unit, cost_per_unit?, supplier_id? }
     PATCH  { id, ...fields }
     DELETE { id }  → soft delete (recipes reference ingredients historically) */
import { requirePermission } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, enc } from "../_bo-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  if (!requirePermission(req, res, "food_ops")) return;

  try {
    if (req.method === "GET") {
      const q = req.query?.all ? "" : "active=eq.true&";
      const rows = await boSelect("bo_ingredients", `${q}select=*&order=name.asc`);
      return res.status(200).json({ rows: rows || [] });
    }
    if (req.method === "POST") {
      const b = req.body || {};
      const name = String(b.name || "").trim();
      const unit = String(b.unit || "").trim();
      if (!name || !unit) return res.status(400).json({ error: "name and unit required" });
      const row = await boInsert("bo_ingredients", {
        name, unit, cost_per_unit: Number(b.cost_per_unit) || 0, supplier_id: b.supplier_id || null,
      });
      return res.status(200).json({ ok: true, row: row?.[0] || row });
    }
    if (req.method === "PATCH") {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = {};
      for (const f of ["name", "unit", "cost_per_unit", "supplier_id", "track_stock", "active"]) {
        if (b[f] !== undefined) patch[f] = b[f];
      }
      const row = await boUpdate("bo_ingredients", `id=eq.${enc(b.id)}`, patch);
      return res.status(200).json({ ok: true, row: row?.[0] || row });
    }
    if (req.method === "DELETE") {
      const id = req.query?.id || req.body?.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const row = await boUpdate("bo_ingredients", `id=eq.${enc(id)}`, { active: false });
      return res.status(200).json({ ok: true, row: row?.[0] || row });
    }
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
