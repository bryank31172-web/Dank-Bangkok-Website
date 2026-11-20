import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://stock-test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stock-test-service-key';
process.env.BACKOFFICE_PASSWORD = 'stock-test-password';
process.env.ADMIN_SECRET = 'stock-test-signing-secret';
const { default: handler } = await import('../api/backoffice/dashboard.js');
const { makeBackofficeToken } = await import('../api/_auth.js');

test('low-stock alerts include only recorded gram balances strictly below 50', async context => {
  const products = [
    { id: 'low', name: 'MAC1', unit: 'g' },
    { id: 'boundary', name: 'At threshold', unit: 'g' },
    { id: 'high', name: 'Above threshold', unit: 'grams' },
    { id: 'missing', name: 'Unrecorded stock', unit: 'g' },
    { id: 'pieces', name: 'Water', unit: 'each' },
    { id: 'zero', name: 'Out of stock', unit: 'กรัม' },
  ];
  const balances = { low: 49.9, boundary: 50, high: 75, pieces: 2, zero: 0 };
  let stockSettingsQuery;
  const reply = body => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
  context.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    const table = url.pathname.split('/').at(-1);
    if (table === 'site_kv') {
      if (url.searchParams.get('key') === 'eq.menu:cache') {
        return reply([{ value: { at: Date.now(), data: products } }]);
      }
      return reply([]);
    }
    if (table === 'bo_product_stock_settings') {
      stockSettingsQuery = url.searchParams;
      return reply(products.map(product => ({ product_key: product.id, store_id: 'shop', low_stock_threshold: 1 })));
    }
    if (table === 'bo_inventory_ledger' && url.searchParams.has('item_key')) {
      const key = url.searchParams.get('item_key').slice(3);
      return reply(Object.hasOwn(balances, key) ? [{ balance_after: balances[key] }] : []);
    }
    return reply([]);
  });
  const res = {
    setHeader() {}, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({
    method: 'GET', url: '/api/backoffice/dashboard', query: {},
    headers: { authorization: `Bearer ${makeBackofficeToken()}` },
  }, res);
  assert.equal(res.code, 200);
  assert.equal(stockSettingsQuery.has('low_stock_threshold'), false);
  assert.deepEqual(res.body.lowStock.rows.map(row => [row.name, row.balance, row.threshold, row.unit]), [
    ['MAC1', 49.9, 50, 'g'], ['Out of stock', 0, 50, 'g'],
  ]);
});
