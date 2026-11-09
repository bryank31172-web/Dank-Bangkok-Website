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

function salesByStore(orders) {
  // api/order.js tags o.storeId at write time (delivery: the real branch the
  // road-distance quote resolved; table/in-house: DANK's one dine-in
  // location — see the comment there for why). Orders placed before that
  // shipped, or a delivery whose route couldn't be resolved, carry no
  // storeId — counted separately as "untagged" rather than dropped silently
  // or guessed at.
  const stores = new Map();
  let untaggedOrders = 0, untaggedGross = 0;
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const gross = money(o.total ?? o.subtotal);
    if (!o.storeId) { untaggedOrders++; untaggedGross += gross; continue; }
    const rec = stores.get(o.storeId) || { store_id: o.storeId, orders: 0, gross: 0 };
    rec.orders++; rec.gross += gross;
    stores.set(o.storeId, rec);
  }
  const rows = [...stores.values()].sort((a, b) => b.gross - a.gross);
  return {
    rows,
    untagged: { orders: untaggedOrders, gross: untaggedGross },
    note: untaggedOrders
      ? `${untaggedOrders} order(s) in this window have no store recorded (placed before store attribution shipped, or a delivery whose branch couldn't be resolved by road distance) — their ฿${untaggedGross} isn't included in the rows above.`
      : undefined,
  };
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
  const bySku = salesByProduct(orders); // still name-keyed rows (qty/gross) — product_key is joined on top below
  // api/order.js now tags each line with productKey when it can resolve one
  // (see the comment there). Only orders written after that shipped carry
  // it, so this joins whatever's actually present rather than assuming
  // every line has one — a line with no productKey, or a productKey with no
  // cost_price on file, shows revenue only, never a guessed cost.
  const keyByName = new Map();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const i of o.items || []) {
      const n = String(i.name || "").trim();
      if (n && i.productKey && !keyByName.has(n)) keyByName.set(n, String(i.productKey));
    }
  }
  const keys = [...new Set(keyByName.values())];
  const costs = keys.length && boConfigured()
    ? await boSelect("bo_product_settings", `product_key=in.(${keys.map(enc).join(",")})&select=product_key,cost_price`)
    : [];
  const costByKey = new Map((costs || []).map((c) => [c.product_key, Number(c.cost_price) || 0]));

  let totalRevenue = 0, totalCost = 0, costedRows = 0;
  const rows = bySku.map((row) => {
    totalRevenue += row.gross;
    const key = keyByName.get(row.name) || null;
    const cost = key != null && costByKey.has(key) ? costByKey.get(key) : null;
    if (cost != null) { totalCost += cost * row.qty; costedRows++; }
    return {
      ...row, product_key: key, cost_price: cost,
      cost_total: cost != null ? Math.round(cost * row.qty) : null,
      margin: cost != null ? Math.round(row.gross - cost * row.qty) : null,
    };
  });

  return {
    note: costedRows
      ? `Cost joined for ${costedRows} of ${rows.length} product(s) via each line's resolved product_key and a cost price on file in Products settings. The rest show revenue only — either no line this window resolved a product_key, or no cost_price is set yet.`
      : "No product in this window has both a resolved product_key and a cost price on file yet — showing revenue only, not a guessed cost. Set cost prices in Products settings; new orders resolve product_key automatically.",
    totalRevenue: money(totalRevenue), totalCost: Math.round(totalCost), grossMargin: Math.round(totalRevenue - totalCost),
    costedRows, rows,
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
    if (type === "sales-by-store") {
      const r = salesByStore(await readLiveOrders(since));
      return res.status(200).json({ ...r, source: r.rows.length ? "recorded" : "unavailable" });
    }
    if (type === "discounts") return res.status(200).json({ ...discounts(await readLiveOrders(since)), source: "recorded" });
    if (type === "returns-corrections") return res.status(200).json({ ...returnsAndCorrections(await readLiveOrders(since)), source: "recorded" });

    if (type === "cogs") {
      const c = await cogs(await readLiveOrders(since));
      return res.status(200).json({ ...c, source: c.costedRows ? "derived" : "unavailable-partial" });
    }
    if (!boConfigured()) return res.status(503).json({ error: "not configured" });
    if (type === "stock-value") return res.status(200).json({ ...(await stockValue(store)), source: "derived" });
    if (type === "waste-costs") return res.status(200).json({ ...(await wasteCosts(since, store)), source: "recorded" });
    if (type === "staff-activity") return res.status(200).json({ rows: await staffActivity(since), source: "recorded", note: "Covers actions taken through BackOffice only (stock adjustments, kitchen tickets, purchase orders, expenses) — not POS or storefront activity." });

    return res.status(400).json({ error: "type must be one of: sales-by-product, sales-by-category, sales-by-store, discounts, returns-corrections, cogs, stock-value, waste-costs, staff-activity" });
  } catch (e) {
    return res.status(502).json({ error: "report error", detail: String(e.message || e) });
  }
}
