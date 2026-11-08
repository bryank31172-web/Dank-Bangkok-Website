/* /api/backoffice/dashboard?store=<id|all>
   Aggregated KPIs for the Overview tab. Every figure is tagged
   source:"recorded" (comes from a row someone wrote) or "estimated" (derived/
   summed) per the brief's "never claim a payment has been verified unless a
   trusted source confirms it" rule — applied here to all figures, not just
   payments: nothing on this dashboard is allowed to read as more certain than
   it is. Sales total is read from the website's own order records (site_kv),
   NOT re-derived from the inventory ledger, since BRYAN POS — not this
   ledger — is the source of truth for completed sales. */
import { requirePermission } from "../_auth.js";
import { boConfigured, boSelect, enc } from "../_bo-db.js";
import { getJSON, indexList } from "../_store.js";

function rangeStart(range) {
  const d = new Date();
  if (range === "week") d.setDate(d.getDate() - 7);
  else if (range === "month") d.setDate(d.getDate() - 30);
  else d.setHours(0, 0, 0, 0); // today
  return d;
}

async function recentSales(since) {
  // Reuses the same order index /api/sales reads from; capped so a dashboard
  // call never has to walk the whole archive.
  const ids = await indexList("orders:index");
  let total = 0, count = 0;
  for (const id of ids.slice(0, 500)) {
    const o = await getJSON("order:" + id);
    if (!o || !o.at || o.at < since.getTime()) continue;
    total += Number(o.total) || 0;
    count += 1;
  }
  return { total, count };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!requirePermission(req, res, "dashboard")) return;

  const range = ["today", "week", "month"].includes(req.query?.range) ? req.query.range : "today";
  const store = req.query?.store;
  const since = rangeStart(range);

  const out = { range, since: since.toISOString(), store: store || "all" };

  // Sales — always available even without Supabase configured (reads site_kv).
  try {
    const sales = await recentSales(since);
    out.sales = { ...sales, source: "recorded" };
  } catch (e) {
    out.sales = { total: 0, count: 0, source: "unavailable", error: String(e.message || e) };
  }

  if (!boConfigured()) {
    out.inventory = { source: "unavailable", note: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" };
    out.purchaseOrders = { source: "unavailable" };
    out.kitchenTickets = { source: "unavailable" };
    return res.status(200).json(out);
  }

  try {
    const storeFilter = store && store !== "all" ? `&store_id=eq.${enc(store)}` : "";

    const openPOs = await boSelect("bo_purchase_orders", `status=in.(ordered,receiving)${storeFilter}&select=id,po_number,status,store_id`);
    out.purchaseOrders = { open: (openPOs || []).length, rows: openPOs || [], source: "recorded" };

    const pendingTickets = await boSelect("bo_kitchen_tickets", `status=in.(new,preparing,ready)${storeFilter}&select=id,status,store_id`);
    out.kitchenTickets = { pending: (pendingTickets || []).length, source: "recorded" };

    const recentLedger = await boSelect("bo_inventory_ledger", `order=created_at.desc&limit=10${storeFilter}&select=*`);
    out.recentStockAdjustments = { rows: recentLedger || [], source: "recorded" };

    // Low-stock: compare each tracked product's latest ledger balance to its threshold.
    // Best-effort — this is O(settings) and fine at DANK's catalogue size (a few
    // hundred SKUs); a materialized view is the fix if this ever gets slow.
    const thresholds = await boSelect("bo_product_stock_settings", `low_stock_threshold=not.is.null${storeFilter}&select=*`);
    let low = [];
    for (const t of (thresholds || []).slice(0, 300)) {
      const [latest] = await boSelect(
        "bo_inventory_ledger",
        `item_type=eq.product&item_key=eq.${enc(t.product_key)}&store_id=eq.${enc(t.store_id)}&order=created_at.desc&limit=1&select=balance_after`
      );
      const balance = latest ? Number(latest.balance_after) : 0;
      if (balance <= Number(t.low_stock_threshold)) low.push({ product_key: t.product_key, store_id: t.store_id, balance, threshold: t.low_stock_threshold });
    }
    out.lowStock = { count: low.length, rows: low, source: "derived" };
  } catch (e) {
    out.inventory = { source: "error", error: String(e.message || e) };
  }

  return res.status(200).json(out);
}
