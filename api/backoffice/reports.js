/* /api/backoffice/reports?type=<name>&days=30&store=<id|all>
   Read-only aggregations. sales-* read the existing site_kv order records
   (same source /api/sales uses) — no second sales table. stock-value/cogs/
   waste-costs read the inventory ledger + product/ingredient cost fields.
   staff-activity reads BackOffice's own tables (the only place staff
   attribution actually exists today — see the note on that function).

   type=sales-by-product | sales-by-category | sales-by-store | discounts |
        returns-corrections | cogs | stock-value | waste-costs | staff-activity

   Every response says source: "recorded" (straight from a written record),
   "derived" (computed from recorded data) or "unavailable" (the data this
   report would need isn't tracked anywhere yet) — never silently guesses. */
import { requirePermission } from "../_auth.js";
import { boConfigured, boSelect, enc } from "../_bo-db.js";
import { getJSON, indexList } from "../_store.js";

const money = (n) => Math.round(Number(n) || 0);

/** One walk over the order index, newest-first, capped the same way /api/sales caps its sweep. */
async function readLiveOrders(since) {
  const ids = await indexList("orders:index");
  const out = [];
  for (const id of ids.slice(0, 500)) {
    const o = await getJSON("order:" + id);
    if (!o || !o.at || o.at < since) continue;
    out.push(o);
  }
  return out;
}

function salesByProduct(orders) {
  const items = new Map();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const i of o.items || []) {
      const n = String(i.name || "").trim();
      if (!n) continue;
      const rec = items.get(n) || { name: n, qty: 0, gross: 0 };
      rec.qty += Number(i.qty) || 1;
      rec.gross += money(i.lineTotal);
      items.set(n, rec);
    }
  }
  return [...items.values()].sort((a, b) => b.gross - a.gross);
}

function salesByCategory(orders) {
  const cats = new Map();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const i of o.items || []) {
      const c = String(i.category || "Uncategorized").trim() || "Uncategorized";
      const rec = cats.get(c) || { category: c, qty: 0, gross: 0 };
      rec.qty += Number(i.qty) || 1;
      rec.gross += money(i.lineTotal);
      cats.set(c, rec);
    }
  }
  return [...cats.values()].sort((a, b) => b.gross - a.gross);
}

function salesByStore() {
  // Orders in this repo don't currently carry a store_id (BRYAN POS pushes
  // one combined feed) — reported as a flagged unknown rather than guessed.
  return { note: "Orders aren't tagged by outlet in the current order record shape — per-outlet sales reporting needs that field added at the order-write step first (api/order.js).", rows: [] };
}

function discounts(orders) {
  const live = orders.filter((o) => o.status !== "cancelled");
  const withDiscount = live.filter((o) => Number(o.discount) > 0 || o.promo);
  const total = withDiscount.reduce((s, o) => s + money(o.discount), 0);
  return {
    total,
    orderCount: withDiscount.length,
    rows: withDiscount.slice(0, 200).map((o) => ({
      orderId: o.orderId, at: o.at, promo: o.promo || "", discount: money(o.discount), subtotal: money(o.subtotal),
    })),
  };
}

function returnsAndCorrections(orders) {
  // What this repo actually tracks: a fully cancelled order (treated here as
  // a "return" since nothing distinguishes a return from a cancellation —
  // api/orders.js only ever sets status to 'new'/'done'/'cancelled'), and a
  // price manually adjusted by staff after the fact (api/order.js sets
  // priceAdjusted:true — treated here as a "correction"). There is no
  // separate partial-return or refund record in this codebase; if DANK adds
  // one later, add a third bucket here rather than guessing at it now.
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const corrected = orders.filter((o) => o.priceAdjusted && o.status !== "cancelled");
  return {
    returns: { count: cancelled.length, total: cancelled.reduce((s, o) => s + money(o.total), 0), rows: cancelled.slice(0, 100).map((o) => ({ orderId: o.orderId, at: o.at, total: money(o.total) })) },
    corrections: { count: corrected.length, rows: corrected.slice(0, 100).map((o) => ({ orderId: o.orderId, at: o.at, total: money(o.total) })) },
  };
}

async function cogs(orders) {
  const bySku = salesByProduct(orders); // name-keyed, not SKU-keyed — see the limitation note below
  // Order items in this repo are recorded by display name, not the BackOffice
  // product_key — there is no reliable join from an order line back to
  // bo_product_settings.cost_price without that key being written at order
  // time. Rather than fuzzy-matching on name (which would silently
  // mis-price COGS whenever two products share wording), this returns the
  // revenue side only and says plainly that cost can't be joined in yet.
  return {
    note: "Order lines are recorded by product name, not the BackOffice product_key, so cost can't be reliably joined per line yet — this shows revenue only. Fixing it means writing product_key onto each order line at checkout time (api/order.js), outside BackOffice's own surface.",
    rows: bySku,
  };
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

async function wasteCosts(since, store) {
  const storeFilter = store && store !== "all" ? `&store_id=eq.${enc(store)}` : "";
  const sinceIso = new Date(since).toISOString();
  const rows = await boSelect(
    "bo_inventory_ledger",
    `reason=in.(waste,damage)&created_at=gte.${enc(sinceIso)}${storeFilter}&select=*&order=created_at.desc&limit=500`
  );
  const productCosts = new Map((await boSelect("bo_product_settings", "select=product_key,cost_price") || []).map((s) => [s.product_key, Number(s.cost_price) || 0]));
  const ingredientCosts = new Map((await boSelect("bo_ingredients", "select=id,cost_per_unit") || []).map((i) => [i.id, Number(i.cost_per_unit) || 0]));
  let total = 0;
  const valued = (rows || []).map((r) => {
    const unitCost = r.item_type === "product" ? (productCosts.get(r.item_key) || 0) : (ingredientCosts.get(r.item_key) || 0);
    const cost = Math.abs(Number(r.qty_delta)) * unitCost;
    total += cost;
    return { ...r, unitCost, cost };
  });
  return { total, rows: valued };
}

async function staffActivity(since) {
  // There is no general staff-action audit log in this repo (DANK's
  // existing system doesn't keep one) — this counts what BackOffice itself
  // now records, which is real, attributed activity, not a guess, but it
  // only covers actions taken through BackOffice, not the POS or storefront.
  const sinceIso = new Date(since).toISOString();
  const [ledger, tickets, pos, expenses] = await Promise.all([
    boSelect("bo_inventory_ledger", `created_at=gte.${enc(sinceIso)}&select=staff_id&limit=1000`),
    boSelect("bo_kitchen_tickets", `created_at=gte.${enc(sinceIso)}&select=created_by&limit=500`),
    boSelect("bo_purchase_orders", `created_at=gte.${enc(sinceIso)}&select=created_by&limit=500`),
    boSelect("bo_expenses", `created_at=gte.${enc(sinceIso)}&select=created_by&limit=500`),
  ]);
  const counts = new Map();
  const bump = (id, field) => {
    if (!id) return;
    const rec = counts.get(id) || { staff_id: id, inventoryAdjustments: 0, kitchenTickets: 0, purchaseOrders: 0, expenses: 0 };
    rec[field]++;
    counts.set(id, rec);
  };
  for (const r of ledger || []) bump(r.staff_id, "inventoryAdjustments");
  for (const r of tickets || []) bump(r.created_by, "kitchenTickets");
  for (const r of pos || []) bump(r.created_by, "purchaseOrders");
  for (const r of expenses || []) bump(r.created_by, "expenses");
  return [...counts.values()].sort((a, b) => (b.inventoryAdjustments + b.kitchenTickets + b.purchaseOrders + b.expenses) - (a.inventoryAdjustments + a.kitchenTickets + a.purchaseOrders + a.expenses));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!requirePermission(req, res, "dashboard")) return;

  const type = req.query?.type;
  const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30));
  const since = Date.now() - days * 86400000;
  const store = req.query?.store;

  try {
    if (type === "sales-by-product") return res.status(200).json({ rows: salesByProduct(await readLiveOrders(since)), source: "recorded" });
    if (type === "sales-by-category") return res.status(200).json({ rows: salesByCategory(await readLiveOrders(since)), source: "recorded" });
    if (type === "sales-by-store") return res.status(200).json({ ...salesByStore(), source: "unavailable" });
    if (type === "discounts") return res.status(200).json({ ...discounts(await readLiveOrders(since)), source: "recorded" });
    if (type === "returns-corrections") return res.status(200).json({ ...returnsAndCorrections(await readLiveOrders(since)), source: "recorded" });

    if (type === "cogs") return res.status(200).json({ ...(await cogs(await readLiveOrders(since))), source: "unavailable-partial" });
    if (!boConfigured()) return res.status(503).json({ error: "not configured" });
    if (type === "stock-value") return res.status(200).json({ ...(await stockValue(store)), source: "derived" });
    if (type === "waste-costs") return res.status(200).json({ ...(await wasteCosts(since, store)), source: "recorded" });
    if (type === "staff-activity") return res.status(200).json({ rows: await staffActivity(since), source: "recorded", note: "Covers actions taken through BackOffice only (stock adjustments, kitchen tickets, purchase orders, expenses) — not POS or storefront activity." });

    return res.status(400).json({ error: "type must be one of: sales-by-product, sales-by-category, sales-by-store, discounts, returns-corrections, cogs, stock-value, waste-costs, staff-activity" });
  } catch (e) {
    return res.status(502).json({ error: "report error", detail: String(e.message || e) });
  }
}
