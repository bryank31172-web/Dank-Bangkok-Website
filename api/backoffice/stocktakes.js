/* /api/backoffice/stocktakes — stock-count sessions (StoreHub-style: start → count → complete).
     GET   ?store=&status=                           → sessions, each with its lines
     POST  { store_id, items:[{item_type,item_key}] } → start a session; snapshots each
            item's current ledger balance into expected_qty so the counted value
            can be compared against it later.
     PATCH { id, lines:[{item_type,item_key,counted_qty}] } → record counts (repeatable)
     POST  { id, action:"complete" }                  → for every line whose counted_qty
            differs from expected_qty, writes one bo_inventory_ledger row
            (reason:'stocktake', qty_delta = counted - expected) and marks the
            session completed. Lines never counted are left out of the ledger
            entirely — "not counted" is not the same claim as "counted as zero". */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boLatestBalance, boLedgerAdjust, enc } from "../_bo-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  const identity = staffIdentity(req);

  try {
    if (req.method === "GET") {
      if (!requirePermission(req, res, "inventory_view")) return;
      const parts = ["select=*,lines:bo_stocktake_lines(*)", "order=started_at.desc"];
      if (req.query?.store) parts.push(`store_id=eq.${enc(req.query.store)}`);
      if (req.query?.status) parts.push(`status=eq.${enc(req.query.status)}`);
      const rows = await boSelect("bo_stocktakes", parts.join("&"));
      return res.status(200).json({ rows: rows || [] });
    }

    if (!requirePermission(req, res, "inventory_adjust")) return;

    if (req.method === "POST" && !req.body?.action) {
      const { store_id, items } = req.body || {};
      if (!store_id) return res.status(400).json({ error: "store_id required" });
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return res.status(400).json({ error: "items required (what you're about to count)" });

      const [session] = await boInsert("bo_stocktakes", { store_id, started_by: identity.id, status: "in_progress" });
      const lines = [];
      for (const it of list) {
        const expected = await boLatestBalance(it.item_type, it.item_key, store_id);
        lines.push({ stocktake_id: session.id, item_type: it.item_type, item_key: String(it.item_key), expected_qty: expected });
      }
      await boInsert("bo_stocktake_lines", lines);
      return res.status(200).json({ ok: true, row: { ...session, lines } });
    }

    if (req.method === "PATCH") {
      const { id, lines } = req.body || {};
      if (!id) return res.status(400).json({ error: "id required" });
      const list = Array.isArray(lines) ? lines : [];
      for (const l of list) {
        await boUpdate(
          "bo_stocktake_lines",
          `stocktake_id=eq.${enc(id)}&item_type=eq.${enc(l.item_type)}&item_key=eq.${enc(l.item_key)}`,
          { counted_qty: Number(l.counted_qty) }
        );
      }
      return res.status(200).json({ ok: true, updated: list.length });
    }

    if (req.method === "POST" && req.body?.action === "complete") {
      const { id } = req.body;
      const [session] = await boSelect("bo_stocktakes", `id=eq.${enc(id)}&select=*`);
      if (!session) return res.status(404).json({ error: "session not found" });
      if (session.status !== "in_progress") return res.status(409).json({ error: `session is '${session.status}', not in_progress` });

      const lines = await boSelect("bo_stocktake_lines", `stocktake_id=eq.${enc(id)}&select=*`);
      const adjustments = [];
      for (const l of lines || []) {
        if (l.counted_qty == null) continue;
        const delta = Number(l.counted_qty) - Number(l.expected_qty);
        if (delta === 0) continue;
        const row = await boLedgerAdjust({
          itemType: l.item_type, itemKey: l.item_key, storeId: session.store_id,
          qtyDelta: delta, reason: "stocktake", refType: "stocktake", refId: session.id,
          staffId: identity.id, note: `stocktake expected ${l.expected_qty}, counted ${l.counted_qty}`,
        });
        adjustments.push(row);
      }
      const [updated] = await boUpdate("bo_stocktakes", `id=eq.${enc(id)}`, { status: "completed", completed_at: new Date().toISOString() });
      return res.status(200).json({ ok: true, session: updated, adjustments });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
