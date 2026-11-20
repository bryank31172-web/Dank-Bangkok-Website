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
import { readSalesRecords } from "../_bo-sales.js";
import { presetWindow, previousWindow, dayStart as bangkokDayStart, bucketWindow, normalizeOrder, dateKey } from "../../assets/backoffice-sales.js";
import { getMenu } from "../_menu.js";
import { salesByProduct, salesByStore } from "./reports.js";

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const signedSale=o=>['return','refund'].includes(o.type||o.kind)?-Math.abs(money(o.total??o.subtotal)):money(o.total??o.subtotal);
const percentageChange = (value, previous) => previous > 0
  ? Math.round(((value - previous) / previous) * 1000) / 10
  : null;

function rangeStart(range) {
  const d = dayStart(new Date());
  if (range === "week") d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  else if (range === "month") d.setDate(1);
  else if (range === "year") d.setMonth(0, 1);
  return d;
}

/* Compare the elapsed part of the selected calendar period. Weeks start Monday. */
function priorWindow(start, end, range) {
  if (range === "today") {
    const prevStart = new Date(start);
    const prevEnd = new Date(end);
    prevStart.setDate(prevStart.getDate() - 1);
    prevEnd.setDate(prevEnd.getDate() - 1);
    return { prevStart, prevEnd };
  }
  const prevStart = new Date(start);
  const prevEnd = new Date(end);
  if (range === "week") {
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd.setDate(prevEnd.getDate() - 7);
  } else if (range === "year") {
    prevStart.setFullYear(prevStart.getFullYear() - 1);
    const daysInPriorMonth = new Date(end.getFullYear() - 1, end.getMonth() + 1, 0).getDate();
    prevEnd.setDate(1);
    prevEnd.setFullYear(prevEnd.getFullYear() - 1);
    prevEnd.setDate(Math.min(end.getDate(), daysInPriorMonth));
  } else {
    prevStart.setMonth(prevStart.getMonth() - 1);
    const daysInPriorMonth = new Date(start.getFullYear(), start.getMonth(), 0).getDate();
    if (end.getDate() > daysInPriorMonth) return { prevStart, prevEnd: new Date(start) };
    prevEnd.setDate(1);
    prevEnd.setMonth(prevEnd.getMonth() - 1);
    prevEnd.setDate(end.getDate());
  }
  return { prevStart, prevEnd };
}

function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** One walk over the order index, newest-first, capped the same way /api/sales
    and reports.js cap their sweep — honest about the cap, never silently
    pretending to cover more history than was actually read. */
async function readOrders(since) {
  const records=await readSalesRecords();
  return {...records,orders:records.orders.filter(o=>o.at>=since)};
}

/* Cumulative sales through each hour of a calendar day — "today vs
   yesterday, hourly", matching StoreHub's dashboard trend chart. Cumulative
   (not per-hour) so the line reads as "how much has come in so far today",
   the thing an owner glancing at this mid-afternoon actually wants to know. */
function hourlyCumulative(orders, dayStartMs, dayEndMs) {
  const hourly = new Array(24).fill(0);
  for (const o of orders) {
    if (o.status === "cancelled"||o.cancelledAt) continue;
    if (o.at < dayStartMs || o.at >= dayEndMs) continue;
    hourly[new Date(Number(o.at)+7*3600000).getUTCHours()] += signedSale(o);
  }
  const cumulative = [];
  let running = 0;
  for (const h of hourly) { running = money(running+h); cumulative.push(running); }
  return cumulative;
}

function calendarCumulative(orders, start, end, monthly = false) {
  const values = [];
  let running = 0;
  for (let day = new Date(start); day < end;) {
    const next = new Date(bucketWindow(+day,monthly?'month':'day').end);
    const cutoff = Math.min(next.getTime(), end.getTime());
    for (const order of orders) {
      if (order.status !== "cancelled" && !order.cancelledAt && order.at >= day.getTime() && order.at < cutoff) {
        running += signedSale(order);
      }
    }
    values.push(money(running));
    day = next;
  }
  return values;
}

function periodTrend(orders, range, start, end, prevStart, today, yesterday) {
  if (range === "today") {
    return {
      current: today.slice(0, new Date(+end+7*3600000).getUTCHours() + 1), previous: yesterday,
      labels: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`),
      currentLabel: "วันนี้", previousLabel: "เมื่อวาน",
    };
  }
  const current = calendarCumulative(orders, start, end, range === "year");
  const previous = calendarCumulative(orders, prevStart, start, range === "year");
  if (range === "year") {
    return {
      current, previous,
      labels: Array.from({ length: 12 }, (_, month) => new Date(2000, month, 1).toLocaleDateString("th-TH", { month: "short" })),
      currentLabel: "ปีนี้", previousLabel: "ปีที่แล้ว",
    };
  }
  const calendarStart=new Date(+start+7*3600000);
  const daysInMonth = new Date(Date.UTC(calendarStart.getUTCFullYear(), calendarStart.getUTCMonth() + 1, 0)).getUTCDate();
  const length = range === "week" ? 7 : Math.max(daysInMonth, previous.length);
  const labels = range === "week"
    ? ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."]
    : Array.from({ length }, (_, day) => String(day + 1));
  return {
    current, previous, labels,
    currentLabel: range === "week" ? "สัปดาห์นี้" : "เดือนนี้",
    previousLabel: range === "week" ? "สัปดาห์ที่แล้ว" : "เดือนที่แล้ว",
  };
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
  const gramsByName = new Map();
  for (const o of orders) {
    if (o.status === "cancelled" || !o.at) continue;
    const day = dateKey(o.at);
    for (const i of o.items || []) {
      const n = String(i.name || "").trim();
      if (!n) continue;
      const set = daysByName.get(n) || new Set();
      set.add(day);
      daysByName.set(n, set);
      const qty = Number(i.qty ?? 1);
      const option = String(i.option || "").match(/(\d+(?:\.\d+)?)\s*g\b/i);
      let grams = null;
      if (i.totalGrams != null) grams = Number(i.totalGrams);
      else if (i.grams != null) grams = Number(i.grams) * qty;
      else if (option) grams = Number(option[1]) * qty;
      else if (["g", "gram", "grams"].includes(String(i.unit || "").toLowerCase())) grams = qty;
      if (grams != null && Number.isFinite(grams) && grams >= 0) {
        gramsByName.set(n, (gramsByName.get(n) || 0) + grams);
      }
    }
  }
  return rows.slice(0, limit).map((r) => ({
    ...r,
    daysSold: daysByName.get(r.name)?.size || 0,
    gramsSold: gramsByName.has(r.name) ? money(gramsByName.get(r.name)) : null,
  }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!requirePermission(req, res, "dashboard")) return;

  const range = ["today", "week", "month", "year"].includes(req.query?.range) ? req.query.range : "today";
  const store = req.query?.store;
  const window=presetWindow(range);
  const previous=previousWindow(window,range);
  const start = new Date(window.start),end=new Date(window.end);
  const prevStart=new Date(previous.start),prevEnd=new Date(previous.end);
  const todayStart = bangkokDayStart(end);
  const yesterdayStart = bangkokDayStart(new Date(todayStart.getTime() - 86400000));

  const out = {
    range, since: start.toISOString(), store: store || "all",
    reportingPeriod: { start: start.toISOString(), end: end.toISOString() },
    comparisonPeriod: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
    chartComparisonPeriod: { start: prevStart.toISOString(), end: start.toISOString() },
    lastSyncedAt: null,
  };

  // Sales, trend, channel/store/product breakdowns — all read from the same
  // site_kv order sweep, always available even without Supabase configured.
  try {
    const sweepSince = Math.min(prevStart.getTime(), yesterdayStart.getTime());
    const records = await readOrders(sweepSince);
    out.coverage={indexed:records.indexed,missing:records.missing,complete:records.missing===0};
    const all=records.orders.map(raw=>{
      const sale=normalizeOrder(raw);
      return {...raw,...sale,items:sale.items.map(item=>({...item,qty:item.quantity,lineTotal:item.subtotal??item.lineTotal}))};
    });
    const scoped = store && store !== "all" ? all.filter((o) => o.storeId === store) : all;

    const inRange = (o, from, to) => o.at >= from.getTime() && (!to || o.at < to.getTime());
    const current = scoped.filter((o) => inRange(o, start, end));
    const prior = scoped.filter((o) => inRange(o, prevStart, prevEnd));
    const liveCurrent = current.filter((o) => o.status !== "cancelled"&&!o.cancelledAt);
    const livePrior = prior.filter((o) => o.status !== "cancelled"&&!o.cancelledAt);

    const total = money(liveCurrent.reduce((s, o) => s + signedSale(o), 0));
    const count = liveCurrent.filter(o=>!['return','refund'].includes(o.type||o.kind)).length;
    const prevTotal = money(livePrior.reduce((s, o) => s + signedSale(o), 0));
    const totalItems = liveCurrent.filter(o=>!['return','refund'].includes(o.type||o.kind)).reduce((s, o) => s + (o.items || []).reduce((si, i) => si + Number(i.qty??i.quantity??1), 0), 0);
    const previousItems = livePrior.filter(o=>!['return','refund'].includes(o.type||o.kind)).reduce((sum, order) => sum + (order.items || []).reduce((items, item) => items + Number(item.qty??item.quantity??1), 0), 0);
    const averageValue = count ? total / count : 0;
    const priorCount=livePrior.filter(o=>!['return','refund'].includes(o.type||o.kind)).length;
    const previousAverageValue = priorCount ? prevTotal / priorCount : 0;
    const averageItems = count ? totalItems / count : 0;
    const previousAverageItems = priorCount ? previousItems / priorCount : 0;

    out.sales = {
      total, count,
      avgOrderValue: money(averageValue),
      avgItemsPerOrder: Math.round(averageItems * 100) / 100,
      changePct: percentageChange(total, prevTotal),
      avgOrderValueChangePct: percentageChange(averageValue, previousAverageValue),
      avgItemsPerOrderChangePct: percentageChange(averageItems, previousAverageItems),
      totalChange: money(total - prevTotal),
      avgOrderValueChange: money(averageValue - previousAverageValue),
      avgItemsPerOrderChange: Math.round((averageItems - previousAverageItems) * 100) / 100,
      source: "recorded",
    };
    out.trend = {
      today: hourlyCumulative(scoped, todayStart.getTime(), todayStart.getTime() + 86400000),
      yesterday: hourlyCumulative(scoped, yesterdayStart.getTime(), todayStart.getTime()),
      source: "recorded",
    };
    Object.assign(out.trend, periodTrend(scoped, range, start, end, prevStart, out.trend.today, out.trend.yesterday));
    out.salesByFulfilment = {
      rows: salesByFulfilment(current),
      source: "recorded",
      note: "DANK has no in-store/offline sales data to compare against (BRYAN POS counter sales are never written back here) — this breaks down website orders by how they were fulfilled (delivery / table / pickup), not an online-vs-offline split.",
    };
    out.salesByStoreBreakdown = { ...salesByStore(current), source: "recorded" };
    const productRows = topProducts(current, Infinity);
    out.topProducts = { rows: productRows.slice(0, 8), source: "recorded" };
    out.topProductsByGrams = {
      rows: productRows.filter((row) => row.gramsSold > 0).sort((a, b) => b.gramsSold - a.gramsSold).slice(0, 10),
      source: "recorded",
    };
    // This is a successful dashboard sales refresh, not a POS import timestamp.
    out.lastSyncedAt = new Date().toISOString();
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

    // The dashboard and bell use a fixed threshold for products measured in grams.
    const stockSettings = await boSelect("bo_product_stock_settings", `select=*${storeFilter}`);
    const menu = await getMenu();
    const gramProducts = new Map();
    for (const product of menu.data || []) {
      if (!["g", "gram", "grams", "กรัม"].includes(String(product.unit || "").trim().toLowerCase())) continue;
      for (const key of [product.id, product.sku, product.shId]) {
        if (key) gramProducts.set(String(key), product);
      }
    }
    const low = [];
    for (const t of (stockSettings || []).slice(0, 300)) {
      const product = gramProducts.get(String(t.product_key));
      if (!product) continue;
      const [latest] = await boSelect(
        "bo_inventory_ledger",
        `item_type=eq.product&item_key=eq.${enc(t.product_key)}&store_id=eq.${enc(t.store_id)}&order=created_at.desc&limit=1&select=balance_after`
      );
      if (!latest || latest.balance_after == null) continue;
      const balance = Number(latest.balance_after);
      if (Number.isFinite(balance) && balance < 50) {
        low.push({ product_key: t.product_key, name: product.name, store_id: t.store_id, balance, threshold: 50, unit: "g" });
      }
    }
    out.lowStock = { count: low.length, rows: low, source: "derived" };
  } catch (e) {
    out.inventory = { source: "error", error: String(e.message || e) };
  }

  return res.status(200).json(out);
}
