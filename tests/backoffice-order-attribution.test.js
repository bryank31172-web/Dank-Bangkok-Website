/* Covers api/order.js's store + product attribution additions (Phase 8,
   docs/dank-backoffice/DEPLOYMENT.md's "known gaps" #2 / IMPLEMENTATION_PLAN.md
   item 19): o.storeId and each line's productKey, both written just before
   the order is saved. See the comments in api/order.js for the reasoning —
   these tests prove the behavior described there: a delivery order gets the
   real branch the road-distance quote resolved (never guessed), table/
   dine-in orders get DANK's one confirmed physical location, a line that
   already carries its own catalogue id uses it as-is, a line that doesn't is
   resolved by name against the live menu, and anything that can't be
   resolved is left untagged rather than fabricated.

   Follows the existing pattern in tests/delivery-fee.test.js: node:test, a
   fake fetch installed on globalThis for the Google Routes call, and a
   call(body) helper that mocks Vercel's (req,res). The menu itself is seeded
   directly into pos:feed (what api/_menu.js's fetchUpstream() reads first)
   so getMenu() never needs a real network call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import orderHandler from '../api/order.js';
import { getJSON, setJSON } from '../api/_store.js';
import { bustMenu } from '../api/_menu.js';

process.env.GOOGLE_MAPS_API_KEY = 'test-key';
process.env.SHOP_BRANCHES = JSON.stringify([
  { id: 'pattanakarn', name: 'DANK Pattanakarn (Main)', origin: '13.70,100.65' },
]);

await setJSON('pos:feed', {
  at: Date.now(),
  products: [{ id: 'sku-attribution-test', name: 'Test Resolve Product', price: 300, member: 270, stock: 10 }],
});
await bustMenu();

const routeOf = (meters) => async (url) => {
  assert.match(String(url), /routes\.googleapis\.com/);
  return { ok: true, json: async () => ({ routes: [{ duration: '600s', distanceMeters: meters }] }) };
};
const routeFails = async (url) => {
  assert.match(String(url), /routes\.googleapis\.com/);
  return { ok: false };
};
async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

let ip = 0;
async function call(body) {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { this.data = j; return this; }, end() { return this; } };
  await orderHandler({ method: 'POST', headers: { 'x-forwarded-for': 'attribution-tests-' + (++ip) }, body }, res);
  return res;
}
const baseOrder = (extra = {}) => ({
  items: [{ name: 'Test Cannabis Item', option: '1g', qty: 1, price: 300, lineTotal: 300 }],
  customer: { name: 'Test', phone: '+66 81-234-5678' },
  payment: 'Cash',
  ...extra,
});

test('a delivery order is tagged with the real branch the road-distance quote resolved', async () => {
  const res = await withFetch(routeOf(7000), () => call(baseOrder({
    fulfilment: 'delivery', deliveryFee: 0,
    delivery: { coordinates: { lat: 13.75, lng: 100.55 }, zone: 'Somewhere', address: 'Lobby' },
  })));
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const saved = await getJSON('order:' + res.data.orderId);
  assert.equal(saved.storeId, 'pattanakarn');
});

test('a delivery order whose route could not be resolved is left untagged, not guessed', async () => {
  const res = await withFetch(routeFails, () => call(baseOrder({
    fulfilment: 'delivery', deliveryFee: 0,
    delivery: { coordinates: { lat: 13.75, lng: 100.55 }, zone: 'Somewhere', address: 'Lobby' },
  })));
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const saved = await getJSON('order:' + res.data.orderId);
  assert.equal(saved.storeId, undefined);
  assert.equal(saved.delivery.feeFallback, true);
});

test('a table order is tagged with the one physical dine-in location', async () => {
  const res = await call(baseOrder({ fulfilment: 'table', table: 'T1' }));
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const saved = await getJSON('order:' + res.data.orderId);
  assert.equal(saved.storeId, 'pattanakarn');
});

test("food.html's non-table pickup is also tagged dine-in, its only other fulfilment, and an item's own catalogue id is used as-is", async () => {
  const res = await call({
    items: [{ id: 'food-9', name: 'Fried Rice', option: '', qty: 1, price: 120, lineTotal: 120, kind: 'food' }],
    customer: { name: 'Walk-in', phone: '0899999999' },
    payment: 'Cash', fulfilment: 'pickup', pickup: {},
  });
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const saved = await getJSON('order:' + res.data.orderId);
  assert.equal(saved.storeId, 'pattanakarn');
  assert.equal(saved.items[0].productKey, 'food-9');
});

test('a cannabis line with no id is resolved to its catalogue product_key by matching name against the live menu', async () => {
  const res = await call(baseOrder({
    fulfilment: 'table', table: 'T2',
    items: [{ name: 'Test Resolve Product', option: '', qty: 2, price: 300, lineTotal: 600 }],
  }));
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const saved = await getJSON('order:' + res.data.orderId);
  assert.equal(saved.items[0].productKey, 'sku-attribution-test');
});

test('a line whose name matches nothing in the live menu is left untagged, never guessed', async () => {
  const res = await call(baseOrder({
    fulfilment: 'table', table: 'T3',
    items: [{ name: 'Totally Unknown Product XYZ', option: '', qty: 1, price: 50, lineTotal: 50 }],
  }));
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const saved = await getJSON('order:' + res.data.orderId);
  assert.equal(saved.items[0].productKey, undefined);
});
