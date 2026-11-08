/* /api/backoffice/stores — outlet list for BackOffice.
     GET → [{id,name,address,active}], seeded from branches.json (the same file
     api/_route.js already reads for delivery ETA — DANK's real 4 locations,
     not StoreHub's 2 configured stores, see docs/dank-backoffice/BACKOFFICE_REQUIREMENTS.md).
   On first call with bo_stores empty, this upserts the seed into bo_stores so
   later BackOffice tables (inventory, POs, …) have real store_id foreign keys
   to point at. Safe to call repeatedly — it's an upsert on the primary key. */
import { requirePermission } from "../_auth.js";
import { boConfigured, boSelect, boInsert } from "../_bo-db.js";
import { getBranches } from "../_route.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!requirePermission(req, res, "dashboard")) return;
  if (!boConfigured()) return res.status(503).json({ error: "not configured", detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });

  try {
    let rows = await boSelect("bo_stores", "select=id,name,address,active&order=name.asc");
    if (!rows || !rows.length) {
      const branches = await getBranches();
      if (branches.length) {
        const seed = branches.map((b) => ({ id: b.id, name: b.name, address: b.origin, active: true }));
        // A concurrent request may win the insert race first; that's fine, the
        // re-select below reads whichever rows actually landed either way.
        try { await boInsert("bo_stores", seed); } catch (_) {}
        rows = await boSelect("bo_stores", "select=id,name,address,active&order=name.asc");
      }
    }
    return res.status(200).json({ rows: rows || [] });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
