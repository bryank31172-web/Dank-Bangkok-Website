/* /api/backoffice/purchase-orders — suppliers → PO → receiving → inventory ledger.
     GET   ?store=&supplier=&status=                → list, each with its lines embedded
     POST  { supplier_id, store_id, lines:[{item_type,item_key,qty_ordered,unit_cost}], expected_date?, note? }
           → creates a draft PO with a server-assigned sequential po_number
     POST  { id, action:"send" }                     → draft/ordered
     POST  { id, action:"receive", lines:[{line_id,qty_received}] }
           → writes one bo_inventory_ledger row per line via bo_ledger_adjust
             (reason:'receive_po', ref_type:'purchase_order', ref_id:po id),
             bumps that line's qty_received, and sets the PO's status to
             'receiving' (partial) or 'completed' (every line fully received).
             Re-sending the same line_id again only adds the NEW delta you
             send — the caller must send the quantity being received in THIS
             call, not a running total, same as StoreHub's own partial-receipt
             model observed in Phase 1.
     PATCH { id, ...fields }                         → edit while draft/ordered
   Every write requires the 'purchasing' scope. */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boRpc, boLedgerAdjust, boAudit, enc } from "../_bo-db.js";

async function listPOs(q) {
  const parts = ["select=*,lines:bo_purchase_order_lines(*)", "order=created_at.desc"];
  if (q.store) parts.push(`store_id=eq.${enc(q.store)}`);
  if (q.supplier) parts.push(`supplier_id=eq.${enc(q.supplier)}`);
  if (q.status) parts.push(`status=eq.${enc(q.status)}`);
  return boSelect("bo_purchase_orders", parts.join("&"));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured", detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });
  if (!requirePermission(req, res, "purchasing")) return;
  const identity = staffIdentity(req);

  try {
    if (req.method === "GET") {
      const rows = await listPOs(req.query || {});
      return res.status(200).json({ rows: rows || [] });
    }

    if (req.method === "PATCH") {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = { updated_at: new Date().toISOString() };
      for (const f of ["supplier_id", "store_id", "order_date", "expected_date", "note"]) {
        if (b[f] !== undefined) patch[f] = b[f];
      }
      const row = await boUpdate("bo_purchase_orders", `id=eq.${enc(b.id)}&status=in.(draft,ordered)`, patch);
      if (!row?.length) return res.status(409).json({ error: "PO not found, or not editable in its current status" });
      return res.status(200).json({ ok: true, row: row[0] });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const b = req.body || {};

    // ---- state transitions (existing PO) ----
    if (b.action === "send") {
      const row = await boUpdate("bo_purchase_orders", `id=eq.${enc(b.id)}&status=eq.draft`, { status: "ordered", updated_at: new Date().toISOString() });
      if (!row?.length) return res.status(409).json({ error: "PO not found, or not in draft status" });
      await boAudit({ actorId: identity.id, action: "status_change", entityType: "purchase_order", entityId: b.id, before: { status: "draft" }, after: { status: "ordered" } });
      return res.status(200).json({ ok: true, row: row[0] });
    }

    if (b.action === "receive") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!lines.length) return res.status(400).json({ error: "lines required" });

      const [po] = await boSelect("bo_purchase_orders", `id=eq.${enc(b.id)}&select=*`);
      if (!po) return res.status(404).json({ error: "PO not found" });
      if (!["ordered", "receiving"].includes(po.status)) return res.status(409).json({ error: `cannot receive a PO in status '${po.status}'` });

      const poLines = await boSelect("bo_purchase_order_lines", `po_id=eq.${enc(b.id)}&select=*`);
      const byId = new Map((poLines || []).map((l) => [String(l.id), l]));
      const results = [];

      for (const rcv of lines) {
        const line = byId.get(String(rcv.line_id));
        const qty = Number(rcv.qty_received);
        if (!line || !Number.isFinite(qty) || qty <= 0) continue;
        const newReceived = Number(line.qty_received) + qty;
        if (newReceived > Number(line.qty_ordered) + 1e-9) {
          return res.status(400).json({ error: `line ${line.id}: receiving ${qty} would exceed qty_ordered (${line.qty_ordered}, already received ${line.qty_received})` });
        }
        await boUpdate("bo_purchase_order_lines", `id=eq.${line.id}`, { qty_received: newReceived });
        const ledgerRow = await boLedgerAdjust({
          itemType: line.item_type, itemKey: line.item_key, storeId: po.store_id,
          qtyDelta: qty, reason: "receive_po", refType: "purchase_order", refId: po.id,
          staffId: identity.id, note: `PO ${po.po_number}`,
        });
        results.push({ line_id: line.id, received: qty, ledger: ledgerRow });
      }

      const refreshedLines = await boSelect("bo_purchase_order_lines", `po_id=eq.${enc(b.id)}&select=*`);
      const fullyReceived = (refreshedLines || []).every((l) => Number(l.qty_received) >= Number(l.qty_ordered) - 1e-9);
      const newStatus = fullyReceived ? "completed" : "receiving";
      const [updatedPO] = await boUpdate("bo_purchase_orders", `id=eq.${enc(b.id)}`, { status: newStatus, updated_at: new Date().toISOString() });
      await boAudit({ actorId: identity.id, action: "status_change", entityType: "purchase_order", entityId: b.id, before: { status: po.status }, after: { status: newStatus }, note: `received ${results.length} line(s)` });
      return res.status(200).json({ ok: true, po: updatedPO, results, status: newStatus });
    }

    // ---- create ----
    const supplierId = b.supplier_id, storeId = b.store_id;
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (!supplierId || !storeId) return res.status(400).json({ error: "supplier_id and store_id required" });
    if (!lines.length) return res.status(400).json({ error: "at least one line required" });
    for (const l of lines) {
      if (!["product", "ingredient"].includes(l.item_type) || !l.item_key || !(Number(l.qty_ordered) > 0)) {
        return res.status(400).json({ error: "each line needs item_type ('product'|'ingredient'), item_key, qty_ordered > 0" });
      }
    }

    const poNumber = await boRpc("bo_next_po_number", {});
    const [po] = await boInsert("bo_purchase_orders", {
      po_number: poNumber, supplier_id: supplierId, store_id: storeId,
      status: "draft", order_date: b.order_date || null, expected_date: b.expected_date || null,
      note: b.note || null, created_by: identity.id,
    });
    await boInsert("bo_purchase_order_lines", lines.map((l) => ({
      po_id: po.id, item_type: l.item_type, item_key: String(l.item_key),
      qty_ordered: Number(l.qty_ordered), unit_cost: Number(l.unit_cost) || 0,
    })));
    const [full] = await listPOsById(po.id);
    await boAudit({ actorId: identity.id, action: "create", entityType: "purchase_order", entityId: po.id, after: full || po });
    return res.status(200).json({ ok: true, row: full || po });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}

function listPOsById(id) {
  return boSelect("bo_purchase_orders", `id=eq.${enc(id)}&select=*,lines:bo_purchase_order_lines(*)`);
}
