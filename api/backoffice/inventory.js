/* /api/backoffice/inventory — the append-only stock-movement ledger.
     GET  ?item_type=&item_key=&store=&from=&to=&limit=   → ledger rows, newest first
     POST { item_type, item_key, store_id, qty_delta, reason, note }
          → one new ledger row via bo_ledger_adjust(), which computes a
            race-safe balance_after inside Postgres (see migration 0001).
   "Never allow staff to silently overwrite historical stock records" (brief,
   Module C) — there is deliberately no PATCH/DELETE here. A correction is a
   new row with an opposite-sign qty_delta and a note explaining why. */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boLedgerAdjust, enc } from "../_bo-db.js";

const REASONS = new Set([
  "receive_po", "stocktake", "transfer_in", "transfer_out",
  "manual_adjust", "waste", "damage", "kitchen_consumption",
]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured", detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });

  if (req.method === "GET") {
    if (!requirePermission(req, res, "inventory_view")) return;
    const q = req.query || {};
    const parts = [];
    if (q.item_type) parts.push(`item_type=eq.${enc(q.item_type)}`);
    if (q.item_key) parts.push(`item_key=eq.${enc(q.item_key)}`);
    if (q.store) parts.push(`store_id=eq.${enc(q.store)}`);
    if (q.from) parts.push(`created_at=gte.${enc(q.from)}`);
    if (q.to) parts.push(`created_at=lte.${enc(q.to)}`);
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    parts.push(`order=created_at.desc,id.desc`, `limit=${limit}`, `select=*`);
    try {
      const rows = await boSelect("bo_inventory_ledger", parts.join("&"));
      return res.status(200).json({ rows: rows || [], total: (rows || []).length });
    } catch (e) {
      return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!requirePermission(req, res, "inventory_adjust")) return;

  const b = req.body || {};
  const itemType = String(b.item_type || "");
  const itemKey = String(b.item_key || "").trim();
  const storeId = String(b.store_id || "").trim();
  const qtyDelta = Number(b.qty_delta);
  const reason = String(b.reason || "manual_adjust");

  if (!["product", "ingredient"].includes(itemType)) return res.status(400).json({ error: "item_type must be 'product' or 'ingredient'" });
  if (!itemKey) return res.status(400).json({ error: "item_key required" });
  if (!storeId) return res.status(400).json({ error: "store_id required" });
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) return res.status(400).json({ error: "qty_delta must be a non-zero number" });
  if (!REASONS.has(reason)) return res.status(400).json({ error: `reason must be one of: ${[...REASONS].join(", ")}` });

  const identity = staffIdentity(req);
  try {
    const row = await boLedgerAdjust({
      itemType, itemKey, storeId, qtyDelta, reason,
      refType: b.ref_type || null, refId: b.ref_id || null,
      staffId: identity.id, note: b.note ? String(b.note).slice(0, 500) : null,
    });
    return res.status(200).json({ ok: true, row });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
