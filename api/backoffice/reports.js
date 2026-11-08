/* /api/backoffice/reports?type=sales-by-product|sales-by-store|stock-value|cogs
   Read-only aggregations. sales-by-* read the existing site_kv order records
   (same source /api/sales uses) — no second sales table. stock-value/cogs read
   the inventory ledger + product/ingredient cost fields. Ships the first two
   now; stock-value/cogs are the Phase 5 "advanced analytics" ask. */
import { requirePermission } from "../_auth.js";
import { boConfigured, boSelect, enc } from "../_bo-db.js";
import { getJSON, indexList } from "../_store.js";

async function salesByProduct(since) {
  const ids = await indexList("orders:index");
  const items = new Map();
  for (const id of ids.slice(0, 500)) {
    const o = await getJSON("order:" + id);
    if (!o || o.status === "cancelled" || !o.at || o.at < since) continue;
    for (const i of o.items || []) {
      const n = String(i.name || "").trim();
      if (!n) continue;
      const rec = items.get(n) || { name: n, qty: 0, gross: 0 };
      rec.qty += Number(i.qty) || 1;
      rec.gross += Math.round(Number(i.lineTotal) || 0);
      items.set(n, rec);
    }
  }
  return [...items.values()].sort((a, b) => b.gross - a.gross);
}

async function salesByStore(since) {
  // Orders in this repo don't currently carry a store_id (BRYAN POS is
  // single-feed) — reported as a flagged unknown rather than guessed.
  return { note: "Orders aren't tagged by outlet in the current order record shape — per-outlet sales reporting needs that field added at the order-write step first.", rows: [] };
}

async function stockValue(store) {
  const settings = await boSelect("bo_product_settings", "select=product_key,cost_price");
  const costByKey = new Map((settings || []).map((s) => [s.product_key, Number(s.cost_price) || 0]));
  const storeFilter = store && store !== "all" ? `&store_id=eq.${enc(store)}` : "";
  const latest = await boSelect(
    "bo_inventory_ledger",
    `item_type=eq.product&select=item_key,store_id,balance_after,created_at&order=item_key.asc,store_id.asc,created_at.desc${storeFilter}`
  );
  const seen = new Set();
  let total = 0;
  const rows = [];
  for (const row of latest || []) {
    const k = row.item_key + "|" + row.store_id;
    if (seen.has(k)) continue; // first row per (item,store) after the sort above is the latest
    seen.add(k);
    const cost = costByKey.get(row.item_key) || 0;
    const value = cost * Number(row.balance_after);
    total += value;
    rows.push({ product_key: row.item_key, store_id: row.store_id, balance: row.balance_after, cost_price: cost, value });
  }
  return { total, rows };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!requirePermission(req, res, "dashboard")) return;

  const type = req.query?.type;
  const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30));
  const since = Date.now() - days * 86400000;

  try {
    if (type === "sales-by-product") return res.status(200).json({ rows: await salesByProduct(since), source: "recorded" });
    if (type === "sales-by-store") return res.status(200).json({ ...(await salesByStore(since)), source: "unavailable" });
    if (type === "stock-value") {
      if (!boConfigured()) return res.status(503).json({ error: "not configured" });
      return res.status(200).json({ ...(await stockValue(req.query?.store)), source: "derived" });
    }
    return res.status(400).json({ error: "type must be one of: sales-by-product, sales-by-store, stock-value" });
  } catch (e) {
    return res.status(502).json({ error: "report error", detail: String(e.message || e) });
  }
}
