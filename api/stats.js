/* /api/stats — how busy the website is, and what people did on it.

     POST {e:["views","visits"], pg:"home"}   the browser saying "this
       happened". Public, because the visitors are the public. It writes
       nothing but integers — see api/_analytics.js for what that means and
       why it is not a tracking cookie.

     GET  ?days=7   the dashboard behind analytics.html. Staff key required:
       the traffic numbers are harmless, but the same reply carries takings,
       basket sizes and how many people are on the books, which are the shop's
       business and nobody else's.

   Two sources, deliberately not merged into one:

     Counters   what happened on the site — views, visits, baskets started,
                checkouts opened, chats, spins. Only exists from the day this
                shipped, because nobody was counting before it.
     Orders     read back out of the order records, the same way /api/sales
                does. Complete from the shop's first ever order, because the
                orders were always being written down.

   So the sales half of the dashboard has history and the traffic half starts
   at zero. That is worth saying out loud on the page rather than letting an
   empty chart look like a broken one. */

import { getJSON, setJSON, indexList } from "./_store.js";
import { requireStaff } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";
import { record, readRange, bkkDay, lastDays } from "./_analytics.js";

/* Each order id is its own read, so a request cannot be allowed to ask for
   the whole book at once. Thirty days of a busy shop is nowhere near this. */
const SWEEP_MAX = 1200;
const MAX_DAYS = 90;
/* The assembled answer is cached briefly. Opening the dashboard twice, or
   leaving it on a wall screen that refreshes, should not re-read every order
   record each time. */
const CACHE_KEY = (d) => `an:cache:${d}`;
const CACHE_TTL = 60;

const money = (o) => {
  const v = Number(o?.total ?? o?.subtotal ?? 0);
  return Number.isFinite(v) ? Math.round(v) : 0;
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  /* ---- the browser reporting in ---------------------------------------- */
  if (req.method === "POST") {
    /* A page view is a handful of bytes and a browsing session is maybe thirty
       of them. This is high enough that no real visitor meets it and low
       enough that a script cannot inflate the shop's own numbers all day. */
    if (!(await requireRate(req, res, "stats", 120, 300))) return;
    const b = req.body || {};
    const events = Array.isArray(b.e) ? b.e.slice(0, 6).map(String) : [];
    const page = typeof b.pg === "string" ? b.pg : "";
    /* Answer first, count second: the beacon fires during page load and the
       visitor should never wait on it. Errors are swallowed inside record(). */
    res.status(204).end();
    try { await record(events, page); } catch (e) { console.error("stats record:", e.message); }
    return;
  }

  if (req.method !== "GET") return res.status(405).json({ error: "GET or POST" });
  if (!requireStaff(req, res)) return;

  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(req.query?.days) || 7)));

  const cached = await getJSON(CACHE_KEY(days)).catch(() => null);
  if (cached && !req.query?.fresh) return res.status(200).json({ ...cached, cached: true });

  const [traffic, sales] = await Promise.all([
    readRange(days).catch((e) => { console.error("stats counters:", e.message); return null; }),
    orderStats(days).catch((e) => { console.error("stats orders:", e.message); return null; }),
  ]);

  const out = {
    days,
    from: lastDays(days)[0],
    to: bkkDay(),
    traffic: traffic || { days: lastDays(days), series: {}, totals: {}, pages: {} },
    sales: sales || null,
    /* The traffic half only knows about days after it shipped, so the page
       says so rather than letting a flat run of zeros read as "no visitors".
       Derived from the numbers themselves — the first day in range that
       counted anything — so there is no separate record to go stale. */
    countingSince: firstDayWithData(traffic),
    at: Date.now(),
  };
  /* Best effort: a dashboard that cannot cache is a slower dashboard, not a
     broken one. */
  try { await setJSON(CACHE_KEY(days), out, CACHE_TTL); } catch (e) { /* fine */ }
  return res.status(200).json(out);
}

function firstDayWithData(traffic) {
  if (!traffic) return null;
  const views = traffic.series?.views || [];
  const i = views.findIndex((v) => v > 0);
  return i < 0 ? null : traffic.days[i];
}

/* Everything the order book can answer on its own. No new bookkeeping: these
   are the same records the Orders tab and /api/sales read. */
async function orderStats(days) {
  const list = lastDays(days);
  const inRange = new Set(list);
  const ids = await indexList("orders:index", { includeArchive: days > 30 });
  const slice = ids.slice(0, SWEEP_MAX);

  const byDay = Object.fromEntries(list.map((d) => [d, { orders: 0, revenue: 0 }]));
  const byProduct = new Map();
  const byPay = new Map();
  const byFulfil = new Map();
  const phones = new Set();
  let orders = 0, revenue = 0, items = 0, member = 0;

  for (const id of slice) {
    const o = await getJSON("order:" + id);
    if (!o) continue;
    const day = bkkDay(Number(o.at) || 0);
    if (!inRange.has(day)) continue;
    const amount = money(o);
    orders++; revenue += amount;
    byDay[day].orders++; byDay[day].revenue += amount;
    if (o.member) member++;
    if (o.customer?.phone) phones.add(String(o.customer.phone));
    byPay.set(o.payment || "-", (byPay.get(o.payment || "-") || 0) + 1);
    byFulfil.set(o.fulfilment || "-", (byFulfil.get(o.fulfilment || "-") || 0) + 1);
    for (const i of o.items || []) {
      const qty = Number(i.qty) || 1;
      items += qty;
      const name = String(i.name || "").trim() || "-";
      const cur = byProduct.get(name) || { qty: 0, revenue: 0 };
      cur.qty += qty;
      cur.revenue += Number(i.lineTotal) || 0;
      byProduct.set(name, cur);
    }
  }

  const top = [...byProduct.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenue: Math.round(v.revenue) }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const members = ((await getJSON("crm:members").catch(() => null)) || []).length;

  return {
    orders, revenue, items, member,
    customers: phones.size,
    average: orders ? Math.round(revenue / orders) : 0,
    perDay: list.map((d) => byDay[d]),
    top,
    payments: [...byPay.entries()].map(([k, v]) => ({ name: k, n: v })).sort((a, b) => b.n - a.n),
    fulfilment: [...byFulfil.entries()].map(([k, v]) => ({ name: k, n: v })).sort((a, b) => b.n - a.n),
    members,
    /* True when the sweep hit its ceiling, so the page can say the numbers are
       a floor rather than quietly under-reporting a very busy month. */
    truncated: ids.length > SWEEP_MAX,
  };
}
