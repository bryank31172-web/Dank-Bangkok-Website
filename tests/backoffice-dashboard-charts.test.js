/* Covers api/backoffice/dashboard.js's StoreHub-parity additions: the
   hourly today-vs-yesterday trend, sales-by-fulfilment (DANK's honest
   equivalent to StoreHub's online/offline channel split — see the comment
   in dashboard.js for why it isn't labeled "channel"), the sales-by-store
   bar-chart data (reuses reports.js's salesByStore), a top-products list
   with a genuinely-counted daysSold, and the %-change-vs-prior-period KPI.

   Deliberately runs with no SUPABASE_URL set, so boConfigured() is false —
   proving these sales-derived sections work without Supabase (same
   "always available" guarantee the pre-existing sales total had), while
   the inventory-gated sections degrade to "unavailable" rather than
   throwing. Orders are seeded directly into the real _store.js, matching
   the pattern in tests/backoffice-reports-attribution.test.js. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.STAFF_KEY = 'test-staff-key-dashboard';

const dashboardHandler = (await import('../api/backoffice/dashboard.js')).default;
const { setJSON, indexAdd } = await import('../api/_store.js');
test.beforeEach(async context=>{
  context.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T18:00:00+07:00').getTime()});
  await setJSON('orders:index',[]);await setJSON('orders:index:archive',[]);
});

function call(query) {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { this.data = j; return this; }, end() { return this; } };
  const req = { method: 'GET', headers: { authorization: 'Bearer test-staff-key-dashboard' }, query };
  return dashboardHandler(req, res).then(() => res);
}

let oid = 0;
async function seedOrder(atDate, extra) {
  const id = 'dash-test-' + Date.now() + '-' + (++oid);
  const order = { orderId: id, at: atDate.getTime(), status: 'new', items: [], total: 0, subtotal: 0, fulfilment: 'delivery', ...extra };
  await setJSON('order:' + id, order);
  await indexAdd(id, 'orders:index');
  return id;
}

function todayAt(hour) { const d = new Date(); d.setHours(hour, 0, 0, 0); return d; }
function yesterdayAt(hour) { const d = todayAt(hour); d.setDate(d.getDate() - 1); return d; }
/* dashboard.js's "prior period" for range:"today" is [todayMidnight - elapsed,
   todayMidnight) — its start depends on what time the suite happens to run,
   but its end is always exactly todayMidnight. A fixed clock hour (like
   yesterdayAt(9)) would only land inside that window after 3pm local time;
   this timestamp is pinned to just before the window's one fixed edge, so
   it's in range no matter when the test runs. */
function justBeforeTodayMidnight() { return new Date(todayAt(0).getTime() - 1000); }

test('boConfigured() is false in this file (no SUPABASE_URL set) — sanity check for the rest of this suite', async () => {
  const { boConfigured } = await import('../api/_bo-db.js');
  assert.equal(boConfigured(), false);
});

test('KPIs: total, count, avgOrderValue, avgItemsPerOrder and %-change vs prior period, with inventory sections degrading to unavailable', async () => {
  await seedOrder(todayAt(9), { total: 300, items: [{ name: 'A', qty: 2 }] });
  await seedOrder(todayAt(10), { total: 500, items: [{ name: 'B', qty: 1 }] });
  await seedOrder(todayAt(11), { total: 999, status: 'cancelled', items: [{ name: 'C', qty: 5 }] }); // excluded

  const res = await call({ range: 'today' });
  assert.equal(res.code, 200, JSON.stringify(res.data));
  assert.equal(res.data.sales.total, 800);
  assert.equal(res.data.sales.count, 2);
  assert.equal(res.data.sales.avgOrderValue, 400);
  assert.equal(res.data.sales.avgItemsPerOrder, 1.5);
  assert.equal(res.data.sales.source, 'recorded');

  assert.equal(res.data.inventory.source, 'unavailable');
  assert.equal(res.data.purchaseOrders.source, 'unavailable');
  assert.equal(res.data.kitchenTickets.source, 'unavailable');
});

test('%-change vs the prior period compares today against an equal-length slice of yesterday, not a guess', async () => {
  // Scoped to a storeId no other test in this file uses, so the current vs.
  // prior comparison is exact regardless of what else is seeded elsewhere.
  const store = 'change-pct-test-store';
  await seedOrder(todayAt(9), { total: 300, storeId: store });
  await seedOrder(yesterdayAt(9), { total: 200, storeId: store });

  const res = await call({ range: 'today', store });
  assert.equal(res.code, 200, JSON.stringify(res.data));
  assert.equal(res.data.sales.total, 300);
  assert.equal(res.data.sales.changePct, 50, '300 vs a 200 prior period is +50%');
});

test('%-change is null, not a fabricated number, when the prior period has no sales to compare against', async () => {
  const store = 'change-pct-test-store-nodata';
  await seedOrder(todayAt(9), { total: 300, storeId: store });

  const res = await call({ range: 'today', store });
  assert.equal(res.code, 200, JSON.stringify(res.data));
  assert.equal(res.data.sales.changePct, null);
});

test('hourly cumulative trend buckets today and yesterday separately and runs a true running total', async () => {
  // Assertions use deltas between hours, not absolute cumulative values: this
  // file's other tests also seed "today"/"yesterday" orders (at hours 9-11,
  // for KPI/fulfilment coverage), and since the in-memory store persists
  // across tests in one file, an absolute today[13] would silently include
  // whatever those other tests posted at hours 9/10. A delta across a span
  // this test owns exclusively (8 and 14) is immune to that — it only ever
  // reflects what was added inside that span, regardless of execution order.
  await seedOrder(todayAt(8), { total: 100 });
  await seedOrder(todayAt(8), { total: 50 });
  await seedOrder(todayAt(14), { total: 200 });
  await seedOrder(yesterdayAt(8), { total: 1000 });

  const res = await call({ range: 'today' });
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const { today, yesterday } = res.data.trend;
  assert.equal(today.length, 24);
  assert.equal(yesterday.length, 24);
  assert.equal(today[8] - today[7], 150, '100+50 posted exactly at 8am, nothing at 7am');
  assert.equal(today[14] - today[13], 200, 'the 2pm order adds exactly 200 to the running total');
  assert.equal(today[23], today[14], 'cumulative total doesn\'t change after the last order of the day');
  assert.equal(yesterday[8] - yesterday[7], 1000, 'yesterday\'s order adds exactly 1000 at 8am');
  // Checked against hour 22, not 23: the %-change tests above deliberately
  // seed a "just before today's midnight" order (hour 23 of yesterday) to
  // stay robust to wall-clock time — see justBeforeTodayMidnight(). Hour 22
  // is still well clear of this test's own 8am order and avoids that one.
  assert.equal(yesterday[22], yesterday[8], 'cumulative total is unchanged between 8am and 10pm yesterday');
});

test('sales-by-fulfilment groups by how the order was fulfilled and excludes cancelled orders, never claims an online/offline split', async () => {
  // Unique, test-only fulfilment labels — every other test in this file
  // seeds orders with the default fulfilment 'delivery' (see seedOrder),
  // and since state persists across tests in one file, grouping by the
  // real 'delivery'/'table' values here would pick up their totals too.
  await seedOrder(todayAt(9), { total: 300, fulfilment: 'delivery-chan-test' });
  await seedOrder(todayAt(10), { total: 150, fulfilment: 'table-chan-test' });
  await seedOrder(todayAt(11), { total: 999, fulfilment: 'delivery-chan-test', status: 'cancelled' });

  const res = await call({ range: 'today' });
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const byType = Object.fromEntries(res.data.salesByFulfilment.rows.map((r) => [r.fulfilment, r]));
  assert.equal(byType['delivery-chan-test'].gross, 300, 'only the live order counts, the cancelled 999 is excluded');
  assert.equal(byType['table-chan-test'].gross, 150);
  assert.match(res.data.salesByFulfilment.note, /not an online-vs-offline split/);
});

test('top products ranks by revenue and counts genuinely distinct days sold, not a guess', async () => {
  await seedOrder(todayAt(9), { total: 600, items: [{ name: 'Popular Item', qty: 2, lineTotal: 600 }] });
  await seedOrder(todayAt(15), { total: 300, items: [{ name: 'Popular Item', qty: 1, lineTotal: 300 }] });
  await seedOrder(yesterdayAt(10), { total: 300, items: [{ name: 'Popular Item', qty: 1, lineTotal: 300 }] });

  const res = await call({ range: 'week' }); // wide enough to include yesterday's order too
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const top = res.data.topProducts.rows.find((r) => r.name === 'Popular Item');
  assert.ok(top, 'Popular Item should appear in the top-products list');
  assert.equal(top.qty, 4);
  assert.equal(top.gross, 1200);
  assert.equal(top.daysSold, 2, 'sold today and yesterday — two distinct calendar days, not three orders');
});

test('a store filter scopes sales, trend and the breakdowns to orders tagged with that storeId', async () => {
  await seedOrder(todayAt(9), { total: 400, storeId: 'pattanakarn' });
  await seedOrder(todayAt(10), { total: 250, storeId: 'sathorn' });

  const res = await call({ range: 'today', store: 'pattanakarn' });
  assert.equal(res.code, 200, JSON.stringify(res.data));
  assert.ok(res.data.sales.total >= 400, 'includes the pattanakarn order');
  const storeRows = res.data.salesByStoreBreakdown.rows.map((r) => r.store_id);
  assert.ok(!storeRows.includes('sathorn'), 'a store-scoped call never surfaces another store\'s rows');
});
