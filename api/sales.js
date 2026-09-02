/* /api/sales — the takings, bill by bill, and who still owes for one.

   Everything here is read back out of the order records the shop already
   writes; nothing new is recorded at sale time. That matters for two reasons:
   the numbers cover every order ever taken rather than only the ones placed
   after this file shipped, and there is no second ledger that can drift out of
   step with the first one.

     GET  ?days=7                 → totals, day by day, and the bills behind them
     GET  ?month=2026-07          → one calendar month: takings, average bill,
                                    average selling price per product, and who
                                    spent the most
     GET  ?bill=DK1A2B3C          → one bill in full: lines, discount, gifts, pay
     GET  ?owed=1                 → everyone who owes, newest debt first
     GET  ?owed=1&phone=08…       → the same for one customer (the CRM card)

     POST {action:"mark-paid", orderId, how}   → the money arrived, close it
     POST {action:"mark-unpaid", orderId}      → undo the above
     POST {action:"tab", phone, name, amount, note}   → open a manual tab
     POST {action:"tab-settle", phone, id}     → they paid the tab off
     POST {action:"tab-delete", phone, id}     → the tab was a mistake

   Staff key on everything, GET included: one reply here carries names, phone
   numbers and what each person spent, which is the same reason /api/customer
   is locked.

   WHAT COUNTS AS OWING
   --------------------
   Three things, and deliberately only three:

     wallet    an order paid "Wallet". api/order.js reserves the amount rather
               than spending it — an unauthenticated request may not move a
               customer's money — so until staff press Settle the shop has
               handed over goods against a balance nobody has touched.
     online    an order whose payment method was supposed to arrive before
               collection (PromptPay, card, transfer, crypto) and whose
               payStatus is still not "paid".
     tab       a line staff opened by hand, for the case no order record
               covers: someone walked out with two grams and said Friday.

   Cash orders are NOT counted. A cash order is paid at the counter and nothing
   in the record distinguishes "paid in cash" from "not yet paid", so counting
   them would mark every cash sale the shop has ever made as a debt. When a
   customer really does leave owing cash, staff open a tab — which is the whole
   reason the tab exists.                                                     */
import { getJSON, setJSON, indexList } from "./_store.js";
import { requirePermission } from "./_auth.js";
import { normPhone } from "./_phone.js";

const DAY = 86400000;
const YEAR = 60 * 60 * 24 * 365;

/* How far back a request may reach, and how many order records one request may
   read. Each id is a separate store read, so an unbounded "show me everything"
   is a slow request and a large bill from Upstash. 1200 is comfortably more
   than a busy month. */
const MAX_DAYS = 400;
const SWEEP_MAX = 1200;

/* Methods the customer was meant to have paid with before they collect. Cash
   and Wallet are handled separately — see the note at the top. */
const PREPAID = new Set(["PromptPay", "PromptPayQR", "Card", "2C2P", "GBPrimePay", "Transfer", "Crypto"]);

const money = (o) => {
  const v = Number(o?.total ?? o?.subtotal ?? 0);
  return Number.isFinite(v) ? Math.round(v) : 0;
};
const tabKey = (phone) => "tab:" + normPhone(phone);
/* Every phone that has ever had a tab opened on it. Without this list the
   whole-shop view could only find tabs belonging to people who had also
   ordered or joined the CRM — so a tab opened for a walk-in nobody had a
   record of simply never appeared, which is the one case a tab is for. Kept
   as one small array rather than a keyspace scan, because the store has no
   scan and every read costs a round trip. */
const TAB_INDEX = "tabs:phones";
const TAB_INDEX_MAX = 4000;
async function tabIndexAdd(phone) {
  const list = (await getJSON(TAB_INDEX)) || [];
  if (list.includes(phone)) return;
  list.unshift(phone);
  await setJSON(TAB_INDEX, list.slice(0, TAB_INDEX_MAX), YEAR);
}
async function tabIndexDrop(phone) {
  const list = (await getJSON(TAB_INDEX)) || [];
  const next = list.filter((p) => p !== phone);
  if (next.length !== list.length) await setJSON(TAB_INDEX, next, YEAR);
}

/* A local (Bangkok) calendar day for a timestamp, as YYYY-MM-DD. Vercel runs
   in UTC, and a shop that closes at 1am would otherwise have its last two
   hours of takings land on tomorrow's total. TZ_OFFSET_MIN lets a deployment
   somewhere else move it without touching this file. */
const TZ_MIN = Number(process.env.TZ_OFFSET_MIN ?? 420); // +07:00 = Bangkok
function dayKey(at) {
  const d = new Date(Number(at || 0) + TZ_MIN * 60000);
  return d.toISOString().slice(0, 10);
}

/* Why an order is outstanding, or null when it is not. Kept in one place so
   the list, the per-customer view and the totals can never disagree. */
export function debtOn(o) {
  if (!o || o.status === "cancelled" || o.voided) return null;
  if (o.payment === "Wallet" && o.walletReserved && !o.walletSettled) {
    return { kind: "wallet", amount: Math.round(Number(o.walletAmount ?? money(o))) || money(o) };
  }
  if (PREPAID.has(String(o.payment || "")) && o.payStatus !== "paid") {
    return { kind: "online", amount: money(o) };
  }
  return null;
}

/* Walk the order index newest-first, reading records until we run out of ids,
   fall off the end of the window, or hit the read cap. Returns what it read
   plus whether it stopped early, because a total that quietly omits older
   orders is worse than one that says it is partial. */
async function readOrders({ since = 0, cap = SWEEP_MAX, archive = true } = {}) {
  const ids = await indexList("orders:index", { includeArchive: archive });
  const out = [];
  let truncated = false;
  for (const id of ids) {
    if (out.length >= cap) { truncated = true; break; }
    const o = await getJSON("order:" + id);
    if (!o) continue;
    const at = Number(o.at || 0);
    /* The index is newest-first, but a record with no timestamp (very early
       orders) must not end the walk — skip it rather than break. */
    if (since && at && at < since) break;
    if (since && !at) continue;
    out.push(o);
  }
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { orders: out, truncated, indexSize: ids.length };
}

/* The bill as staff need to read it aloud: what was bought, what came off,
   what was paid and what is still outstanding. */
function billOf(o, { full = false } = {}) {
  const d = debtOn(o);
  const b = {
    orderId: o.orderId || "",
    at: o.at || null,
    day: o.at ? dayKey(o.at) : "",
    status: o.status || "new",
    payment: o.payment || "",
    payStatus: o.payStatus || (o.payment === "Cash" ? "" : ""),
    paidAt: o.paidAt || o.walletSettledAt || null,
    paidBy: o.paidBy || "",
    fulfilment: o.fulfilment || o.mode || "",
    table: o.table || "",
    member: Boolean(o.member),
    promo: o.promo || "",
    subtotal: Math.round(Number(o.subtotal) || 0),
    discount: Math.round(Number(o.discount) || 0),
    deliveryFee: Math.round(Number(o.deliveryFee) || 0),
    total: money(o),
    itemCount: (o.items || []).reduce((s, i) => s + (Number(i.qty) || 1), 0),
    lines: (o.items || []).length,
    customer: { name: o.customer?.name || "", phone: o.customer?.phone || "" },
    owes: d ? d.amount : 0,
    owesKind: d ? d.kind : "",
    slip: Boolean(o.slipUploaded),
  };
  if (!full) return b;
  b.items = (o.items || []).map((i) => ({
    name: i.name || "", option: i.option || "",
    qty: Number(i.qty) || 1,
    unit: Number(i.price ?? (Number(i.lineTotal) || 0) / (Number(i.qty) || 1)) || 0,
    lineTotal: Math.round(Number(i.lineTotal) || 0),
    bonus: Boolean(i.bonus1st || i.free || i.gift),
  }));
  b.box = o.box || null;
  b.notes = o.notes || "";
  b.delivery = o.delivery || null;
  b.pickup = o.pickup || null;
  b.wallet = o.payment === "Wallet"
    ? { reserved: Boolean(o.walletReserved), settled: Boolean(o.walletSettled), amount: Math.round(Number(o.walletAmount) || 0), balanceAfter: o.walletBalanceAfter ?? null }
    : null;
  b.priceAdjusted = Boolean(o.priceAdjusted);
  return b;
}

/* ---------------------------------------------------------------- handler */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Staff-Key, Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  const permission=req.method==="GET"?(String(req.query?.dashboard||"")==="1"?"dashboard":"sales"):"owner_tools";
  if (!requirePermission(req, res, permission)) return;

  try {
    if (req.method === "GET") return await onGet(req, res);
    if (req.method === "POST") return await onPost(req, res);
    return res.status(405).json({ error: "method" });
  } catch (e) {
    console.error("sales error:", e.message);
    return res.status(500).json({ error: "server" });
  }
}

async function onGet(req, res) {
  const q = req.query || {};

  /* ---- one bill, in full ---------------------------------------------- */
  if (q.bill) {
    const o = await getJSON("order:" + String(q.bill));
    if (!o) return res.status(404).json({ error: "no such bill" });
    return res.status(200).json({ ok: true, bill: billOf(o, { full: true }) });
  }

  /* ---- who owes -------------------------------------------------------- */
  if (q.owed) {
    const one = q.phone ? normPhone(q.phone) : "";
    const { orders, truncated } = await readOrders({ cap: SWEEP_MAX });
    const by = new Map();
    const add = (phone, name, entry) => {
      const k = phone || "unknown";
      if (!by.has(k)) by.set(k, { phone: k, name: name || "", total: 0, oldest: null, newest: null, bills: [], tabs: [] });
      const rec = by.get(k);
      if (!rec.name && name) rec.name = name;
      rec.total += entry.amount;
      if (entry.at) {
        if (!rec.oldest || entry.at < rec.oldest) rec.oldest = entry.at;
        if (!rec.newest || entry.at > rec.newest) rec.newest = entry.at;
      }
      return rec;
    };

    for (const o of orders) {
      const d = debtOn(o);
      if (!d) continue;
      const phone = normPhone(o.customer?.phone);
      if (one && phone !== one) continue;
      const rec = add(phone, o.customer?.name, { amount: d.amount, at: o.at });
      rec.bills.push(billOf(o));
    }

    /* Manual tabs. A whole-shop view reads the phones on the tab index — the
       only list that is guaranteed to hold someone who has never ordered and
       is not in the CRM, which is exactly who a tab gets opened for. The CRM
       lists are still folded in so tabs written before the index existed are
       not orphaned. A single-customer view reads exactly one key. */
    const phones = new Set(one ? [one] : []);
    if (!one) {
      for (const p of (await getJSON(TAB_INDEX)) || []) { if (String(p).length >= 6) phones.add(String(p)); }
      for (const o of orders) { const p = normPhone(o.customer?.phone); if (p.length >= 6) phones.add(p); }
      const members = (await getJSON("crm:members")) || [];
      for (const m of members) { const p = normPhone(m.phone); if (p.length >= 6) phones.add(p); }
      const crm = await getJSON("pos:customers");
      for (const c of (crm?.list || [])) { if (String(c.d || "").length >= 6) phones.add(String(c.d)); }
    }
    for (const p of phones) {
      const t = await getJSON(tabKey(p));
      const open = (t?.entries || []).filter((e) => !e.settled);
      if (!open.length) continue;
      for (const e of open) {
        const rec = add(p, t.name, { amount: Math.round(Number(e.amount) || 0), at: e.at });
        rec.tabs.push({ id: e.id, amount: Math.round(Number(e.amount) || 0), note: e.note || "", at: e.at || null, by: e.by || "" });
      }
    }

    const customers = [...by.values()]
      .map((c) => ({ ...c, total: Math.round(c.total), bills: c.bills.sort((a, b) => (b.at || 0) - (a.at || 0)) }))
      .filter((c) => c.total > 0 || c.bills.length || c.tabs.length)
      .sort((a, b) => b.total - a.total);

    return res.status(200).json({
      ok: true,
      owed: {
        total: customers.reduce((s, c) => s + c.total, 0),
        customers: customers.length,
        bills: customers.reduce((s, c) => s + c.bills.length, 0),
        tabs: customers.reduce((s, c) => s + c.tabs.length, 0),
      },
      customers,
      truncated,
      /* Said out loud rather than left for someone to work out from a total
         that looks low. */
      note: "Cash orders are not counted as owing — a cash sale is paid at the counter. Use “Open a tab” when someone really does leave without paying.",
    });
  }

  /* ---- one calendar month, the way an accountant wants it --------------- */
  /* ?month=2026-07 — the shop's own month, not a rolling 30 days, so the
     figure can be checked against a bank statement. Everything is still read
     out of the order records the app already holds; nothing is copied into a
     separate monthly table that could later disagree with them. */
  if (q.month) {
    const m = String(q.month).match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return res.status(400).json({ error: "month", detail: "Use month=YYYY-MM, e.g. month=2026-07" });
    const y = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12) return res.status(400).json({ error: "month", detail: "Month must be 01-12" });
    /* Bangkok midnight on the 1st, to Bangkok midnight on the 1st of the next
       month. Written in UTC and shifted, so a sale at 00:30 on the 1st lands
       in the right month rather than the previous one. */
    const from = Date.UTC(y, mo - 1, 1) - TZ_MIN * 60000;
    const to = Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1) - TZ_MIN * 60000;

    const { orders, truncated, indexSize } = await readOrders({ since: from, cap: SWEEP_MAX });
    const inMonth = orders.filter((o) => Number(o.at || 0) >= from && Number(o.at || 0) < to);
    const live = inMonth.filter((o) => o.status !== "cancelled" && !o.voided);

    const byDay = new Map(), byPay = new Map(), items = new Map(), cust = new Map();
    let gross = 0, discount = 0, delivery = 0, owedTotal = 0, owedCount = 0, memberOrders = 0, boxes = 0, units = 0;

    for (const o of live) {
      const t = money(o);
      gross += t;
      discount += Math.round(Number(o.discount) || 0);
      delivery += Math.round(Number(o.deliveryFee) || 0);
      if (o.member) memberOrders++;
      boxes += Number(o.box?.boxes) || 0;

      const dk = o.at ? dayKey(o.at) : "—";
      const dd = byDay.get(dk) || { day: dk, orders: 0, gross: 0, owed: 0 };
      dd.orders++; dd.gross += t;

      const pk = String(o.payment || "—");
      const pp = byPay.get(pk) || { payment: pk, orders: 0, gross: 0, owed: 0 };
      pp.orders++; pp.gross += t;

      const owe = debtOn(o);
      if (owe) { owedTotal += owe.amount; owedCount++; dd.owed += owe.amount; pp.owed += owe.amount; }
      byDay.set(dk, dd); byPay.set(pk, pp);

      /* Who spends. Keyed on the phone because two walk-ins can share a first
         name; a bill with no phone at all is grouped under one "counter" row
         rather than being dropped, so the customer totals still add up to the
         month's takings. */
      const ph = normPhone(o.customer?.phone);
      const ck = ph || "counter";
      const c = cust.get(ck) || { phone: ph, name: o.customer?.name || "", bills: 0, spent: 0, owed: 0, first: null, last: null, member: false, items: 0 };
      c.bills++; c.spent += t;
      if (!c.name && o.customer?.name) c.name = o.customer.name;
      if (o.member) c.member = true;
      if (owe) c.owed += owe.amount;
      const at = Number(o.at || 0);
      if (at) { if (!c.first || at < c.first) c.first = at; if (!c.last || at > c.last) c.last = at; }

      /* Average selling price is taken from the bill lines, not the price
         list: it is what the shop actually got per unit after member pricing,
         staff adjustments and promo codes. Lines that came free (the box
         gifts, the 1g-for-members bonus) add to the quantity that left the
         shelf but not to the money, which is why they are counted apart —
         folding them into the average would quietly halve it. */
      for (const i of o.items || []) {
        const n = String(i.name || "").trim();
        if (!n) continue;
        const qty = Number(i.qty) || 1;
        const lt = Math.round(Number(i.lineTotal) || 0);
        const free = Boolean(i.bonus1st || i.free || i.gift) || lt <= 0;
        const rec = items.get(n) || { name: n, option: String(i.option || ""), qty: 0, freeQty: 0, gross: 0, bills: 0 };
        if (free) rec.freeQty += qty; else { rec.qty += qty; rec.gross += lt; }
        rec.bills++;
        items.set(n, rec);
        units += qty;
        c.items += qty;
      }
      cust.set(ck, c);
    }

    const customers = [...cust.values()]
      .map((c) => ({ ...c, spent: Math.round(c.spent), avgBill: c.bills ? Math.round(c.spent / c.bills) : 0 }))
      .sort((a, b) => b.spent - a.spent);

    const products = [...items.values()]
      .map((r) => ({ ...r, gross: Math.round(r.gross), avgPrice: r.qty ? Math.round(r.gross / r.qty) : 0 }))
      .sort((a, b) => b.gross - a.gross);

    const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
    const best = days.reduce((b, d) => (!b || d.gross > b.gross ? d : b), null);

    return res.status(200).json({
      ok: true,
      month: `${y}-${String(mo).padStart(2, "0")}`,
      range: { from, to, tzOffsetMin: TZ_MIN },
      summary: {
        orders: live.length,
        gross: Math.round(gross),
        discount: Math.round(discount),
        delivery: Math.round(delivery),
        /* The average bill — what a customer spends in one visit. */
        average: live.length ? Math.round(gross / live.length) : 0,
        units,
        customers: customers.length,
        newestCustomers: customers.filter((c) => c.bills === 1).length,
        repeatCustomers: customers.filter((c) => c.bills > 1).length,
        memberOrders,
        boxes,
        owed: Math.round(owedTotal),
        owedBills: owedCount,
        collected: Math.round(gross - owedTotal),
        cancelled: inMonth.length - live.length,
        tradingDays: days.length,
        bestDay: best ? { day: best.day, gross: Math.round(best.gross), orders: best.orders } : null,
      },
      byDay: days,
      byPayment: [...byPay.values()].sort((a, b) => b.gross - a.gross),
      products,
      customers: customers.slice(0, Number(q.top) || 50),
      bills: live.slice(0, Math.min(Number(q.limit) || 200, 400)).map((o) => billOf(o)),
      truncated,
      indexSize,
      note: "Every figure is read from the orders held in the app. Average selling price is money taken ÷ units sold, with free gift units counted separately.",
    });
  }

  /* ---- the takings ----------------------------------------------------- */
  const days = Math.min(Math.max(Number(q.days) || 7, 1), MAX_DAYS);
  const since = Date.now() - days * DAY;
  const { orders, truncated, indexSize } = await readOrders({ since, cap: SWEEP_MAX });

  const live = orders.filter((o) => o.status !== "cancelled" && !o.voided);
  const byDay = new Map();
  const byPay = new Map();
  const items = new Map();
  let gross = 0, discount = 0, delivery = 0, owedTotal = 0, owedCount = 0, memberOrders = 0, boxes = 0;

  for (const o of live) {
    const t = money(o);
    gross += t;
    discount += Math.round(Number(o.discount) || 0);
    delivery += Math.round(Number(o.deliveryFee) || 0);
    if (o.member) memberOrders++;
    boxes += Number(o.box?.boxes) || 0;

    const k = o.at ? dayKey(o.at) : "—";
    const d = byDay.get(k) || { day: k, orders: 0, gross: 0, owed: 0 };
    d.orders++; d.gross += t;

    const p = String(o.payment || "—");
    const pm = byPay.get(p) || { payment: p, orders: 0, gross: 0, owed: 0 };
    pm.orders++; pm.gross += t;

    const owe = debtOn(o);
    if (owe) { owedTotal += owe.amount; owedCount++; d.owed += owe.amount; pm.owed += owe.amount; }

    byDay.set(k, d);
    byPay.set(p, pm);

    for (const i of o.items || []) {
      const n = String(i.name || "").trim();
      if (!n) continue;
      const rec = items.get(n) || { name: n, qty: 0, gross: 0 };
      rec.qty += Number(i.qty) || 1;
      rec.gross += Math.round(Number(i.lineTotal) || 0);
      items.set(n, rec);
    }
  }

  const bills = live.slice(0, Math.min(Number(q.limit) || 120, 400)).map((o) => billOf(o));

  return res.status(200).json({
    ok: true,
    range: { days, since, until: Date.now(), tzOffsetMin: TZ_MIN },
    summary: {
      orders: live.length,
      gross: Math.round(gross),
      discount: Math.round(discount),
      delivery: Math.round(delivery),
      average: live.length ? Math.round(gross / live.length) : 0,
      owed: Math.round(owedTotal),
      owedBills: owedCount,
      collected: Math.round(gross - owedTotal),
      memberOrders,
      boxes,
      cancelled: orders.length - live.length,
    },
    byDay: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    byPayment: [...byPay.values()].sort((a, b) => b.gross - a.gross),
    topItems: [...items.values()].sort((a, b) => b.gross - a.gross).slice(0, 12),
    bills,
    truncated,
    indexSize,
  });
}

async function onPost(req, res) {
  const b = req.body || {};
  const act = String(b.action || "");

  /* ---- the money arrived ---------------------------------------------- */
  if (act === "mark-paid" || act === "mark-unpaid") {
    const id = String(b.orderId || "");
    if (!id) return res.status(400).json({ error: "orderId required" });
    const o = await getJSON("order:" + id);
    if (!o) return res.status(404).json({ error: "no such bill" });
    /* A wallet order is settled through /api/wallet, where the balance is
       actually debited. Flipping payStatus here would make the bill look
       settled while the customer's credit sat untouched. */
    if (o.payment === "Wallet" && o.walletReserved && !o.walletSettled) {
      return res.status(400).json({ error: "wallet order", detail: "Settle this one from the customer's wallet so the balance is actually deducted." });
    }
    if (act === "mark-paid") {
      o.payStatus = "paid";
      o.paidAt = Date.now();
      o.paidBy = String(b.how || "staff").slice(0, 24);
    } else {
      o.payStatus = "";
      o.paidAt = null;
      o.paidBy = "";
    }
    await setJSON("order:" + id, o);
    return res.status(200).json({ ok: true, bill: billOf(o, { full: true }) });
  }

  /* ---- a tab opened by hand -------------------------------------------- */
  if (act === "tab") {
    const phone = normPhone(b.phone);
    if (phone.length < 6) return res.status(400).json({ error: "phone required" });
    const amount = Math.round(Number(b.amount));
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });
    if (amount > 500000) return res.status(400).json({ error: "amount looks wrong — over ฿500,000" });
    const rec = (await getJSON(tabKey(phone))) || { phone, name: "", entries: [] };
    if (b.name) rec.name = String(b.name).slice(0, 80);
    const entry = {
      id: "T" + Date.now().toString(36).toUpperCase(),
      amount,
      note: String(b.note || "").slice(0, 200),
      at: Date.now(),
      by: String(b.by || "staff").slice(0, 40),
      settled: false,
    };
    rec.entries.unshift(entry);
    rec.entries = rec.entries.slice(0, 200);
    await setJSON(tabKey(phone), rec, YEAR);
    await tabIndexAdd(phone);
    return res.status(200).json({ ok: true, entry, open: rec.entries.filter((e) => !e.settled).reduce((s, e) => s + e.amount, 0) });
  }

  if (act === "tab-settle" || act === "tab-delete") {
    const phone = normPhone(b.phone);
    const id = String(b.id || "");
    if (phone.length < 6 || !id) return res.status(400).json({ error: "phone and id required" });
    const rec = await getJSON(tabKey(phone));
    if (!rec) return res.status(404).json({ error: "no tab for that number" });
    const before = rec.entries.length;
    if (act === "tab-delete") {
      rec.entries = rec.entries.filter((e) => e.id !== id);
      if (rec.entries.length === before) return res.status(404).json({ error: "no such tab line" });
    } else {
      const e = rec.entries.find((x) => x.id === id);
      if (!e) return res.status(404).json({ error: "no such tab line" });
      /* Idempotent: pressing Settled twice on a flaky connection must not
         double-count anything, and there is nothing to undo by hand. */
      if (!e.settled) { e.settled = true; e.settledAt = Date.now(); }
    }
    await setJSON(tabKey(phone), rec, YEAR);
    const open = rec.entries.filter((e) => !e.settled).reduce((s, e) => s + e.amount, 0);
    /* Nothing left open on this number: drop it from the index so the sweep
       does not read a dead key for the rest of the year. */
    if (!rec.entries.some((e) => !e.settled)) await tabIndexDrop(phone);
    return res.status(200).json({ ok: true, open });
  }

  return res.status(400).json({ error: "unknown action" });
}
