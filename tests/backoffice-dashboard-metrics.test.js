import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/backoffice/dashboard.js';
import { makeBackofficeToken } from '../api/_auth.js';
import { setJSON } from '../api/_store.js';

async function dashboard(range = 'today') {
  const request = {
    method: 'GET',
    url: '/api/backoffice/dashboard',
    query: { range, store: 'all' },
    headers: { authorization: `Bearer ${makeBackofficeToken()}` },
  };
  const response = {
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(request, response);
  assert.equal(response.code, 200);
  return response.body;
}

test('dashboard compares the same elapsed period and counts recorded gram weights', async context => {
  process.env.BACKOFFICE_PASSWORD = 'dashboard-test-password';
  process.env.ADMIN_SECRET = 'dashboard-test-signing-secret';
  context.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 12, 12).getTime() });
  const at = (day, hour) => new Date(2026, 10, day, hour).getTime();
  const orders = {
    first: { at: at(12, 9), total: 100.25, items: [
      { name: 'MAC1', qty: 2, totalGrams: 10, lineTotal: 90.25 },
      { name: 'Water', qty: 1, lineTotal: 10 },
    ] },
    second: { at: at(12, 10), total: 299.75, items: [
      { name: 'MAC1', qty: 1, option: '2.5g', lineTotal: 299.75 },
    ] },
    prior: { at: at(11, 9), total: 100, items: [{ name: 'MAC1', qty: 1, grams: 5 }] },
    laterYesterday: { at: at(11, 15), total: 900, items: [] },
    cancelled: { at: at(12, 11), total: 20000, status: 'cancelled', items: [{ name: 'MAC1', qty: 99, grams: 100 }] },
  };
  await setJSON('orders:index', Object.keys(orders));
  for (const [id, order] of Object.entries(orders)) await setJSON(`order:${id}`, order);

  const data = await dashboard();
  assert.equal(data.sales.total, 400);
  assert.deepEqual(data.storeSales,{source:'recorded',rows:[{storeId:'',total:400}]});
  assert.equal(data.reportingPeriod.start, new Date(2026, 10, 12).toISOString());
  assert.equal(data.reportingPeriod.end, new Date(2026, 10, 12, 12).toISOString());
  assert.equal(data.comparisonPeriod.start, new Date(2026, 10, 11).toISOString());
  assert.equal(data.comparisonPeriod.end, new Date(2026, 10, 11, 12).toISOString());
  assert.equal(data.chartComparisonPeriod.end, data.reportingPeriod.start);
  assert.equal(data.lastSyncedAt, data.reportingPeriod.end);
  assert.equal(data.sales.avgOrderValue, 200);
  assert.equal(data.sales.avgItemsPerOrder, 2);
  assert.equal(data.sales.changePct, 300);
  assert.equal(data.sales.avgOrderValueChangePct, 100);
  assert.equal(data.sales.avgItemsPerOrderChangePct, 100);
  assert.equal(data.sales.totalChange, 300);
  assert.equal(data.sales.avgOrderValueChange, 100);
  assert.equal(data.sales.avgItemsPerOrderChange, 1);
  assert.deepEqual(data.topProductsByGrams.rows.map(row => [row.name, row.gramsSold]), [['MAC1', 12.5]]);
  assert.equal(data.trend.today[9], 100.25);
  assert.equal(data.trend.today[23], 400);
  assert.equal(data.trend.yesterday[23], 1000);

  await setJSON('orders:index', ['first']);
  const withoutPrior = await dashboard();
  assert.equal(withoutPrior.sales.changePct, null);
  assert.equal(withoutPrior.sales.avgOrderValueChangePct, null);
  assert.equal(withoutPrior.sales.avgItemsPerOrderChangePct, null);
  assert.equal(withoutPrior.sales.totalChange, 100.25);
});

test('weekly and monthly graphs use calendar days and stop the current series at today', async context => {
  process.env.BACKOFFICE_PASSWORD = 'dashboard-test-password';
  process.env.ADMIN_SECRET = 'dashboard-test-signing-secret';
  context.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 12, 12).getTime() });
  const orders = {
    monday: { at: new Date(2026, 10, 9, 9).getTime(), total: 100 },
    thursday: { at: new Date(2026, 10, 12, 9).getTime(), total: 200 },
    lastWeek: { at: new Date(2026, 10, 3, 9).getTime(), total: 50 },
    lastMonth: { at: new Date(2026, 9, 2, 9).getTime(), total: 75 },
    future: { at: new Date(2026, 10, 13, 9).getTime(), total: 999 },
  };
  await setJSON('orders:index', Object.keys(orders));
  for (const [id, order] of Object.entries(orders)) await setJSON(`order:${id}`, order);

  const week = await dashboard('week');
  assert.equal(week.reportingPeriod.start, new Date(2026, 10, 9).toISOString());
  assert.equal(week.comparisonPeriod.start, new Date(2026, 10, 2).toISOString());
  assert.equal(week.comparisonPeriod.end, new Date(2026, 10, 5, 12).toISOString());
  assert.equal(week.trend.currentLabel, 'สัปดาห์นี้');
  assert.equal(week.trend.previousLabel, 'สัปดาห์ที่แล้ว');
  assert.equal(week.trend.labels.length, 7);
  assert.deepEqual(week.trend.current, [100, 100, 100, 300]);
  assert.equal(week.trend.previous.length, 7);
  assert.equal(week.trend.previous.at(-1), 50);
  assert.equal(week.sales.total, week.trend.current.at(-1));

  const month = await dashboard('month');
  assert.equal(month.reportingPeriod.start, new Date(2026, 10, 1).toISOString());
  assert.equal(month.comparisonPeriod.start, new Date(2026, 9, 1).toISOString());
  assert.equal(month.comparisonPeriod.end, new Date(2026, 9, 12, 12).toISOString());
  assert.equal(month.trend.currentLabel, 'เดือนนี้');
  assert.equal(month.trend.previousLabel, 'เดือนที่แล้ว');
  assert.equal(month.trend.labels.length, 31);
  assert.equal(month.trend.current.length, 12);
  assert.equal(month.trend.previous.length, 31);
  assert.equal(month.trend.previous.at(-1), 75);
  assert.equal(month.sales.total, 350);
  assert.equal(month.sales.total, month.trend.current.at(-1));
});

test('month comparison handles a shorter previous month', async context => {
  process.env.BACKOFFICE_PASSWORD = 'dashboard-test-password';
  process.env.ADMIN_SECRET = 'dashboard-test-signing-secret';
  context.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 2, 31, 12).getTime() });
  await setJSON('orders:index', ['march', 'february']);
  await setJSON('order:march', { at: new Date(2026, 2, 30, 9).getTime(), total: 200 });
  await setJSON('order:february', { at: new Date(2026, 1, 28, 18).getTime(), total: 100 });
  const data = await dashboard('month');
  assert.equal(data.comparisonPeriod.end, new Date(2026, 2, 1).toISOString());
  assert.equal(data.trend.current.length, 31);
  assert.equal(data.trend.previous.length, 28);
  assert.equal(data.trend.labels.length, 31);
  assert.equal(data.sales.changePct, 100);
});

test('yearly graph compares monthly totals with the previous calendar year', async context => {
  process.env.BACKOFFICE_PASSWORD = 'dashboard-test-password';
  process.env.ADMIN_SECRET = 'dashboard-test-signing-secret';
  context.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 12, 12).getTime() });
  const orders = {
    january: { at: new Date(2026, 0, 20, 9).getTime(), total: 100 },
    november: { at: new Date(2026, 10, 10, 9).getTime(), total: 200 },
    lastJanuary: { at: new Date(2025, 0, 20, 9).getTime(), total: 50 },
    lastNovember: { at: new Date(2025, 10, 10, 9).getTime(), total: 100 },
    lastDecember: { at: new Date(2025, 11, 10, 9).getTime(), total: 900 },
    future: { at: new Date(2026, 11, 10, 9).getTime(), total: 999 },
  };
  await setJSON('orders:index', Object.keys(orders));
  for (const [id, order] of Object.entries(orders)) await setJSON(`order:${id}`, order);
  const data = await dashboard('year');
  assert.equal(data.reportingPeriod.start, new Date(2026, 0, 1).toISOString());
  assert.equal(data.comparisonPeriod.start, new Date(2025, 0, 1).toISOString());
  assert.equal(data.comparisonPeriod.end, new Date(2025, 10, 12, 12).toISOString());
  assert.equal(data.range, 'year');
  assert.equal(data.trend.currentLabel, 'ปีนี้');
  assert.equal(data.trend.previousLabel, 'ปีที่แล้ว');
  assert.equal(data.trend.labels.length, 12);
  assert.equal(data.trend.current.length, 11);
  assert.equal(data.trend.previous.length, 12);
  assert.equal(data.trend.current[0], 100);
  assert.equal(data.trend.current.at(-1), 300);
  assert.equal(data.trend.previous[10], 150);
  assert.equal(data.trend.previous[11], 1050);
  assert.equal(data.sales.total, 300);
  assert.equal(data.sales.changePct, 100);
  assert.equal(data.sales.totalChange, 150);
});
