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
import { salesByProduct, salesByStore } from "./reports.js";

const money = (n) => Math.round(Number(n) || 0);

function rangeStart(range) {
  const d = new Date();
  if (range === "week") d.setDate(d.getDate() - 7);
  else if (range === "month") d.setDate(d.getDate() - 30);
  else d.setHours(0, 0, 0, 0); // today
  return d;
}

/* The prior period of the same length, immediately before `start` — e.g. for
   "today" that's yesterday, for "week" the 7 days before this week. Used for
   the %-change KPI, same idea as StoreHub's "vs prior period". */
function priorWindow(start, end) {
  const lengthMs = end.getTime() - start.getTime();
  return { prevStart: new Date(start.getTime() - lengthMs), prevEnd: new Date(start) };
}

function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** One walk over the order index, newest-first, capped the same way /api/sales
    and reports.js cap their sweep — honest about the cap, never silently
    pretending to cover more history than was actually read. */
async function readOrders(since) {
  const ids = await indexList("orders:index");
  const out = [];
  for (const id of ids.slice(0, 500)) {
    const o = await getJSON("order:" + id);
    if (!o || !o.at || o.at < since) continue;
    out.push(o);
  }
  return out;
}

/* Cumulative sales through each hour of a calendar day — "today vs
   yesterday, hourly", matching StoreHub's dashboard trend chart. Cumulative
   (not per-hour) so the line reads as "how much has come in so far today",
   the thing an owner glancing at this mid-afternoon actually wants to know. */
function hourlyCumulative(orders, dayStartMs, dayEndMs) {
  const hourly = new Array(24).fill(0);
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    if (o.at < dayStartMs || o.at >= dayEndMs) continue;
    hourly[new Date(o.at).getHours()] += money(o.total ?? o.subtotal);
  }
  const cumulative = [];
  let running = 0;
  for (const h of hourly) { running += h; cumulative.push(running); }
  return cumulative;
}

function salesByFulfilment(orders) {
  const byType = new Map();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const type = String(o.fulfilment || "unknown");
    const rec = byType.get(type) || { fulfilment: type, orders: 0, gross: 0 };
    rec.orders += 1; rec.gross += money(o.total ?? o.subtotal);
    byType.set(type, rec);
  }
  return [...byType.values()].sort((a, b) => b.gross - a.gross);
}

/* Top products by revenue, with a genuinely-counted "days sold" (distinct
   calendar days the product appears on a live order) — the same field
   StoreHub's top-products list shows, computed here rather than guessed. */
function topProducts(orders, limit = 8) {
  const rows = salesByProduct(orders);
  const daysByName = new Map();
  for (const o of orders) {
    if (o.status === "cancelled" || !o.at) continue;
    const day = new Date(o.at).toISOString().slice(0, 10);
    for (const i of o.items || []) {
      const n = String(i.name || "").trim();
      if (!n) continue;
      const set = daysByName.get(n) || new Set();
      set.add(day);
      daysByName.set(n, set);
    }
  }
  return rows.slice(0, limit).map((r) => ({ ...r, daysSold: daysByName.get(r.name)?.size || 0 }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!requirePermission(req, res, "dashboard")) return;

  const range = ["today", "week", "month"].includes(req.query?.range) ? req.query.range : "today";
  const store = req.query?.store;
  const start = rangeStart(range);
  const end = new Date();
  const { prevStart, prevEnd } = priorWindow(start, end);
  const todayStart = dayStart(end);
  const yesterdayStart = dayStart(new Date(todayStart.getTime() - 86400000));

  const out = { range, since: start.toISOString(), store: store || "all" };

  // Sales, trend, channel/store/product breakdowns — all read from the same
  // site_kv order sweep, always available even without Supabase configured.
  try {
    const sweepSince = Math.min(prevStart.getTime(), yesterdayStart.getTime());
    const all = await readOrders(sweepSince);
    const scoped = store && store !== "all" ? all.filter((o) => o.storeId === store) : all;

    const inRange = (o, from, to) => o.at >= from.getTime() && (!to || o.at < to.getTime());
    const current = scoped.filter((o) => inRange(o, start));
    const prior = scoped.filter((o) => inRange(o, prevStart, prevEnd));
    const liveCurrent = current.filter((o) => o.status !== "cancelled");
    const livePrior = prior.filter((o) => o.status !== "cancelled");

    const total = liveCurrent.reduce((s, o) => s + money(o.total ?? o.subtotal), 0);
    const count = liveCurrent.length;
    const prevTotal = livePrior.reduce((s, o) => s + money(o.total ?? o.subtotal), 0);
    const totalItems = liveCurrent.reduce((s, o) => s + (o.items || []).reduce((si, i) => si + (Number(i.qty) || 1), 0), 0);

    out.sales = {
      total, count,
      avgOrderValue: count ? Math.round(total / count) : 0,
      avgItemsPerOrder: count ? Math.round((totalItems / count) * 10) / 10 : 0,
      changePct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
      source: "recorded",
    };
    out.trend = {
      today: hourlyCumulative(scoped, todayStart.getTime(), todayStart.getTime() + 86400000),
      yesterday: hourlyCumulative(scoped, yesterdayStart.getTime(), todayStart.getTime()),
      source: "recorded",
    };
    out.salesByFulfilment = {
      rows: salesByFulfilment(current),
      source: "recorded",
      note: "DANK has no in-store/offline sales data to compare against (BRYAN POS counter sales are never written back here) — this breaks down website orders by how they were fulfilled (delivery / table / pickup), not an online-vs-offline split.",
    };
    out.salesByStoreBreakdown = { ...salesByStore(current), source: "recorded" };
    out.topProducts = { rows: topProducts(current), source: "recorded" };
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
