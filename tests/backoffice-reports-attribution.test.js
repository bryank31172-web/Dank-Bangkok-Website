/* Covers api/backoffice/reports.js's sales-by-store and cogs after Phase 8
   added storeId/productKey to orders (api/order.js) — see the comments
   there and docs/dank-backoffice/DEPLOYMENT.md's "known gaps" #2. Orders are
   seeded directly into the real _store.js (same source /api/sales and this
   report read), matching the existing tests/delivery-fee.test.js pattern of
   driving the real handler rather than re-implementing its logic. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.STAFF_KEY = 'test-staff-key-reports-attr';
process.env.SUPABASE_URL = 'https://test-reports-attr.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-reports-attr';

const reportsHandler = (await import('../api/backoffice/reports.js')).default;
const { setJSON, indexAdd } = await import('../api/_store.js');

function call(query) {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { this.data = j; return this; }, end() { return this; } };
  const req = { method: 'GET', headers: { authorization: 'Bearer test-staff-key-reports-attr' }, query };
  return reportsHandler(req, res).then(() => res);
}

let oid = 0;
async function seedOrder(extra) {
  const id = 'rep-attr-test-' + Date.now() + '-' + (++oid);
  const order = { orderId: id, at: Date.now(), status: 'new', items: [], total: 0, subtotal: 0, ...extra };
  await setJSON('order:' + id, order);
  await indexAdd(id, 'orders:index');
  return id;
}

async function withProductCosts(costs, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/bo_product_settings')) {
      const m = /product_key=in\.\(([^)]*)\)/.exec(u);
      const keys = m ? decodeURIComponent(m[1]).split(',') : [];
      const rows = keys.filter((k) => costs[k] != null).map((k) => ({ product_key: k, cost_price: costs[k] }));
      return { ok: true, text: async () => JSON.stringify(rows) };
    }
    throw new Error('unexpected fetch in cogs test: ' + u);
  };
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('sales-by-store groups tagged orders by storeId and reports untagged orders separately, never guessing', async () => {
  await seedOrder({ storeId: 'pattanakarn', total: 500 });
  await seedOrder({ storeId: 'pattanakarn', total: 300 });
  await seedOrder({ storeId: 'sathorn', total: 200 });
  await seedOrder({ total: 150 }); // no storeId — predates attribution, or an unresolved delivery route

  const res = await call({ type: 'sales-by-store', days: '365' });
  assert.equal(res.code, 200, JSON.stringify(res.data));
  assert.equal(res.data.source, 'recorded');
  const byStore = Object.fromEntries(res.data.rows.map((r) => [r.store_id, r]));
  assert.equal(byStore.pattanakarn.orders, 2);
  assert.equal(byStore.pattanakarn.gross, 800);
  assert.equal(byStore.sathorn.orders, 1);
  assert.equal(byStore.sathorn.gross, 200);
  assert.equal(res.data.untagged.orders, 1);
  assert.equal(res.data.untagged.gross, 150);
});

test('cogs joins cost_price by productKey where resolved, and shows revenue-only for the rest', async () => {
  await seedOrder({ items: [{ name: 'Costed Item', qty: 2, lineTotal: 1000, productKey: 'sku-costed' }], total: 1000 });
  await seedOrder({ items: [{ name: 'Uncosted Item', qty: 1, lineTotal: 200, productKey: 'sku-nocost' }], total: 200 });
  await seedOrder({ items: [{ name: 'Legacy Item', qty: 1, lineTotal: 90 }], total: 90 }); // predates productKey tagging

  const res = await withProductCosts({ 'sku-costed': 150 }, () => call({ type: 'cogs', days: '365' }));
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const byName = Object.fromEntries(res.data.rows.map((r) => [r.name, r]));

  assert.equal(byName['Costed Item'].product_key, 'sku-costed');
  assert.equal(byName['Costed Item'].cost_total, 300); // 150 * qty 2
  assert.equal(byName['Costed Item'].margin, 700); // 1000 - 300

  assert.equal(byName['Uncosted Item'].product_key, 'sku-nocost');
  assert.equal(byName['Uncosted Item'].cost_total, null, 'a resolved key with no cost on file shows revenue only, never a guessed cost');

  assert.equal(byName['Legacy Item'].product_key, null, 'a line that predates product_key tagging is left untagged, never guessed');
  assert.equal(byName['Legacy Item'].cost_total, null);

  assert.equal(res.data.costedRows, 1);
  assert.equal(res.data.totalRevenue, 1290);
  assert.equal(res.data.totalCost, 300);
  assert.equal(res.data.grossMargin, 990);
  assert.equal(res.data.source, 'derived');
});
