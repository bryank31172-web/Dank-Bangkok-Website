/* /api/backoffice/suppliers
     GET    → active suppliers (?all=1 includes inactive)
     POST   { name, contact_name?, phone?, email?, address?, note? } → create
     PATCH  { id, ...fields }                                        → update
     DELETE { id }  → soft delete (active:false). Never hard-deleted: purchase
                      orders reference suppliers historically and must still
                      resolve the name even after a supplier is retired. */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boAudit, enc } from "../_bo-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured", detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });
  if (!requirePermission(req, res, "suppliers")) return;
  const identity = staffIdentity(req);

  try {
    if (req.method === "GET") {
      const q = req.query?.all ? "" : "active=eq.true&";
      const rows = await boSelect("bo_suppliers", `${q}select=*&order=name.asc`);
      return res.status(200).json({ rows: rows || [] });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const name = String(b.name || "").trim();
      if (!name) return res.status(400).json({ error: "name required" });
      const row = await boInsert("bo_suppliers", {
        name, contact_name: b.contact_name || null, phone: b.phone || null,
        email: b.email || null, address: b.address || null, note: b.note || null,
      });
      const created = row?.[0] || row;
      await boAudit({ actorId: identity.id, action: "create", entityType: "supplier", entityId: created.id, after: created });
      return res.status(200).json({ ok: true, row: created });
    }

    if (req.method === "PATCH") {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = {};
      for (const f of ["name", "contact_name", "phone", "email", "address", "note", "active"]) {
        if (b[f] !== undefined) patch[f] = b[f];
      }
      const [before] = await boSelect("bo_suppliers", `id=eq.${enc(b.id)}&select=*`);
      const row = await boUpdate("bo_suppliers", `id=eq.${enc(b.id)}`, patch);
      const updated = row?.[0] || row;
      await boAudit({ actorId: identity.id, action: "update", entityType: "supplier", entityId: b.id, before, after: updated });
      return res.status(200).json({ ok: true, row: updated });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id || req.body?.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const [before] = await boSelect("bo_suppliers", `id=eq.${enc(id)}&select=*`);
      const row = await boUpdate("bo_suppliers", `id=eq.${enc(id)}`, { active: false });
      const updated = row?.[0] || row;
      await boAudit({ actorId: identity.id, action: "delete", entityType: "supplier", entityId: id, before, after: updated, note: "soft delete (active:false)" });
      return res.status(200).json({ ok: true, row: updated });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
