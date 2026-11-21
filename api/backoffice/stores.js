/* /api/backoffice/stores — outlet list for BackOffice.
     GET   → [{id,name,address,active}], seeded from branches.json (the same file
             api/_route.js already reads for delivery ETA — DANK's real 4 locations,
             not StoreHub's 2 configured stores, see docs/dank-backoffice/BACKOFFICE_REQUIREMENTS.md).
     PATCH { id, name?, address?, active? } → edit a store (e.g. deactivate a
             closed location). Does not touch branches.json — that file still
             drives delivery ETA/routing (api/_route.js) and is Bryan's to edit
             directly; this only edits BackOffice's own copy in bo_stores.
     POST  { id, name, address? } → add a store BackOffice-side only (e.g. a
             new location not yet in branches.json). Requires 'settings'.
   On first GET with bo_stores empty, this upserts the branches.json seed into
   bo_stores so later BackOffice tables (inventory, POs, …) have real store_id
   foreign keys to point at. Safe to call repeatedly — it's an upsert on the
   primary key. */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boAudit, enc } from "../_bo-db.js";
import { getBranches } from "../_route.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured", detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });

  try {
    if (req.method === "GET") {
      if (!requirePermission(req, res, "dashboard")) return;
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
    }

    if (req.method === "PATCH") {
      if (!requirePermission(req, res, "settings")) return;
      const identity = staffIdentity(req);
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = {};
      for (const f of ["name", "address", "active"]) if (b[f] !== undefined) patch[f] = b[f];
      if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });
      const [before] = await boSelect("bo_stores", `id=eq.${enc(b.id)}&select=*`);
      const row = await boUpdate("bo_stores", `id=eq.${enc(b.id)}`, patch);
      if (!row?.length) return res.status(404).json({ error: "store not found" });
      await boAudit({ actorId: identity.id, action: "update", entityType: "store", entityId: b.id, before, after: row[0] });
      return res.status(200).json({ ok: true, row: row[0] });
    }

    if (req.method === "POST") {
      if (!requirePermission(req, res, "settings")) return;
      const identity = staffIdentity(req);
      const b = req.body || {};
      const id = String(b.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      const name = String(b.name || "").trim();
      if (!id || !name) return res.status(400).json({ error: "id and name required" });
      const row = await boInsert("bo_stores", { id, name, address: b.address || null, active: true });
      const created = row?.[0] || row;
      await boAudit({ actorId: identity.id, action: "create", entityType: "store", entityId: id, after: created });
      return res.status(200).json({ ok: true, row: created });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
