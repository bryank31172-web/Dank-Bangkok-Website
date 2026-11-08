/* /api/backoffice/transfers — move stock between outlets.
     GET  ?store=&status=
     POST { from_store_id, to_store_id, lines:[{item_type,item_key,qty}] }  → status 'pending'
     POST { id, action:"complete" } → writes a 'transfer_out' ledger row at the
           source and a 'transfer_in' row at the destination for every line,
           same ref_id so the two sides are traceable to each other. */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boLedgerAdjust, enc } from "../_bo-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  if (!requirePermission(req, res, "inventory_adjust")) return;
  const identity = staffIdentity(req);

  try {
    if (req.method === "GET") {
      const parts = ["select=*,lines:bo_stock_transfer_lines(*)", "order=created_at.desc"];
      if (req.query?.store) parts.push(`or=(from_store_id.eq.${enc(req.query.store)},to_store_id.eq.${enc(req.query.store)})`);
      if (req.query?.status) parts.push(`status=eq.${enc(req.query.status)}`);
      const rows = await boSelect("bo_stock_transfers", parts.join("&"));
      return res.status(200).json({ rows: rows || [] });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const b = req.body || {};

    if (b.action === "complete") {
      const [transfer] = await boSelect("bo_stock_transfers", `id=eq.${enc(b.id)}&select=*`);
      if (!transfer) return res.status(404).json({ error: "transfer not found" });
      if (transfer.status !== "pending") return res.status(409).json({ error: `transfer is '${transfer.status}', not pending` });
      const lines = await boSelect("bo_stock_transfer_lines", `transfer_id=eq.${enc(b.id)}&select=*`);
      for (const l of lines || []) {
        await boLedgerAdjust({
          itemType: l.item_type, itemKey: l.item_key, storeId: transfer.from_store_id,
          qtyDelta: -Math.abs(Number(l.qty)), reason: "transfer_out", refType: "transfer", refId: transfer.id, staffId: identity.id,
        });
        await boLedgerAdjust({
          itemType: l.item_type, itemKey: l.item_key, storeId: transfer.to_store_id,
          qtyDelta: Math.abs(Number(l.qty)), reason: "transfer_in", refType: "transfer", refId: transfer.id, staffId: identity.id,
        });
      }
      const [updated] = await boUpdate("bo_stock_transfers", `id=eq.${enc(b.id)}`, { status: "completed", completed_at: new Date().toISOString() });
      return res.status(200).json({ ok: true, row: updated });
    }

    const { from_store_id, to_store_id, lines } = b;
    if (!from_store_id || !to_store_id) return res.status(400).json({ error: "from_store_id and to_store_id required" });
    if (from_store_id === to_store_id) return res.status(400).json({ error: "from and to must be different stores" });
    const list = Array.isArray(lines) ? lines : [];
    if (!list.length) return res.status(400).json({ error: "lines required" });

    const [transfer] = await boInsert("bo_stock_transfers", { from_store_id, to_store_id, status: "pending", created_by: identity.id });
    await boInsert("bo_stock_transfer_lines", list.map((l) => ({
      transfer_id: transfer.id, item_type: l.item_type, item_key: String(l.item_key), qty: Math.abs(Number(l.qty)),
    })));
    return res.status(200).json({ ok: true, row: transfer });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
