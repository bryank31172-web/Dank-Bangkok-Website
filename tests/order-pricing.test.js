/* Server-side order pricing (api/_order-pricing.js) and the payment guards
   that depend on it. The bug this closes: api/order.js used to re-price only
   when EVERY line carried a StoreHub shId, which BRYAN POS menus never have,
   so the browser's own prices became the amount charged. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OMISE_SECRET_KEY = 'skey_test_dummy';
process.env.OMISE_PUBLIC_KEY = 'pkey_test_dummy';
process.env.GBP_SECRET_KEY = 'gbp_test_dummy';
process.env.TWOC2P_MERCHANT_ID = 'test_merchant';
process.env.TWOC2P_SECRET = 'test_2c2p_secret';

const { priceOrderItems, OrderInputError, gramsPerUnit } = await import('../api/_order-pricing.js');
const { getJSON, setJSON } = await import('../api/_store.js');
const { bustMenu } = await import('../api/_menu.js');
const orderHandler = (await import('../api/order.js')).default;
const payHandler = (await import('../api/pay.js')).default;
const gbpHandler = (await import('../api/paygbp.js')).default;
const c2pHandler = (await import('../api/pay2c2p.js')).default;

const MENU = [
  { id: 'og', name: 'OG Kush', category: 'Exotics', priceTiers: [{ label: '1g', price: 300, member: 270 }, { label: '3.5g', price: 1000, member: 900 }] },
  { id: 'gelato', name: 'Gelato 41', category: 'Exotics', priceTiers: [{ label: '1g', price: 300, member: 270 }] },
  { id: 'sh-prod', name: 'StoreHub Thing', category: 'Vapes', priceTiers: [{ label: 'Pod', price: 800, member: 720, shId: 'SH-TIER-1' }] },
  { id: 'rice', name: 'Fried Rice', category: 'Food', price: 120, member: 108 },
  { id: 'ring1', name: 'Onion Ring', category: 'Food', price: 90 },
  { id: 'ring2', name: 'Onion Ring', category: 'Food', price: 140 },
];
const line = (extra) => ({ name: 'OG Kush', id: 'og', option: '1g', qty: 1, price: 300, category: 'Exotics', ...extra });

test('an honest cart is unchanged and fully verified', () => {
  const items = [line({ qty: 2 }), { name: 'Fried Rice', id: 'rice', option: '', qty: 1, price: 120 }];
  const r = priceOrderItems(items, MENU);
  assert.equal(r.subtotal, 720);
  assert.equal(r.adjusted, false);
  assert.deepEqual(r.unverified, []);
});

test('a tampered low price is raised to the menu price, per line', () => {
  const items = [line({ price: 1, lineTotal: 1 }), { name: 'Mystery', option: '', qty: 1, price: 50 }];
  const r = priceOrderItems(items, MENU);
  assert.equal(items[0].unitPrice, 300);
  assert.equal(items[0].lineTotal, 300);
  assert.equal(r.adjusted, true);
  assert.equal(r.subtotal, 350, 'the known line is fixed even though another line is unknown');
  assert.equal(r.unverified.length, 1);
});

test('client unitPrice and lineTotal are ignored', () => {
  const items = [line({ price: 300, unitPrice: 1, lineTotal: 1 })];
  priceOrderItems(items, MENU);
  assert.equal(items[0].unitPrice, 300);
  assert.equal(items[0].lineTotal, 300);
});

test('a price above the menu is kept, so an honest order never drops', () => {
  const items = [line({ price: 320 })];
  assert.equal(priceOrderItems(items, MENU).subtotal, 320);
});

test('member price only when the order says member', () => {
  assert.equal(priceOrderItems([line({ price: 270 })], MENU, { member: true }).subtotal, 270);
  const r = priceOrderItems([line({ price: 270 })], MENU, { member: false });
  assert.equal(r.subtotal, 300);
  assert.equal(r.adjusted, true);
});

test('lookup: StoreHub shId, product id, then a unique exact name — never a duplicate name', () => {
  const a = [{ name: 'x', shId: 'SH-TIER-1', option: 'Pod', qty: 1, price: 1 }];
  priceOrderItems(a, MENU);
  assert.equal(a[0].unitPrice, 800);
  const b = [{ name: '  gelato 41 ', option: '1g', qty: 1, price: 5 }];
  priceOrderItems(b, MENU);
  assert.equal(b[0].unitPrice, 300, 'name fallback for pages loaded before the id was sent');
  const c = [{ name: 'Onion Ring', option: '', qty: 1, price: 1 }];
  const r = priceOrderItems(c, MENU);
  assert.equal(c[0].priceUnverified, true);
  assert.equal(r.unverified[0].reason, 'product not on the menu');
});

test('an option the menu does not sell is unverified', () => {
  const items = [line({ option: '28g', price: 10 })];
  const r = priceOrderItems(items, MENU);
  assert.equal(r.unverified[0].reason, 'option not on the menu');
});

test('free bonus lines: buy 3 get 1 allowed, more is flagged', () => {
  const ok = [line({ qty: 3 }), { name: 'OG Kush', option: '1g · FREE', qty: 1, price: 0, bonus: true, category: 'Exotics' }];
  const r1 = priceOrderItems(ok, MENU);
  assert.deepEqual(r1.unverified, []);
  assert.equal(r1.subtotal, 900);
  const greedy = [line({ qty: 3 }), { name: 'OG Kush', option: '1g · FREE', qty: 5, price: 0, bonus: true, category: 'Exotics' }];
  const r2 = priceOrderItems(greedy, MENU);
  assert.equal(r2.unverified.length, 1);
  assert.match(r2.unverified[0].reason, /exceed the 1 earned/);
  const priced = [line({ qty: 1 }), { name: 'OG Kush', option: '1g', qty: 1, price: 999, bonus: true }];
  priceOrderItems(priced, MENU);
  assert.equal(priced[1].lineTotal, 0, 'a bonus line is never charged');
});

test('first-order free gram: one, only with at least 1g of flower and no ladder gram', () => {
  assert.deepEqual(priceOrderItems([line(), { name: 'Gelato 41', option: '1g · FIRST ORDER FREE', qty: 1, price: 0, bonus: true }], MENU).unverified, []);
  const noFlower = [{ name: 'Fried Rice', id: 'rice', qty: 1, price: 120 }, { name: 'Gelato 41', option: '1g', qty: 1, price: 0, bonus: true }];
  assert.equal(priceOrderItems(noFlower, MENU).unverified.length, 1);
});

test('bad quantities are rejected outright', () => {
  for (const qty of [0, -2, 1.5, 9999, 'abc']) assert.throws(() => priceOrderItems([line({ qty })], MENU), OrderInputError, String(qty));
  assert.throws(() => priceOrderItems([], MENU), OrderInputError);
});

test('grams parsing matches the storefront', () => {
  assert.equal(gramsPerUnit('Exotics', '3.5g'), 3.5);
  assert.equal(gramsPerUnit('Top Shelf', '½g'), 0.5);
  assert.equal(gramsPerUnit('Food', '3g'), 0);
});

/* ---------------- end to end through the real endpoints ---------------- */

await setJSON('pos:feed', { at: Date.now(), products: [
  { id: 'og', name: 'OG Kush', category: 'Exotics', stock: 50, priceTiers: [{ label: '1g', price: 300, member: 270 }, { label: '3.5g', price: 1000, member: 900 }] },
  { id: 'rice', name: 'Fried Rice', category: 'Food', price: 120, member: 108, stock: 50 },
] });
await bustMenu();

let ip = 0;
function invoke(handler, body, method = 'POST') {
  return new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { this.data = d; resolve(this); return this; }, end() { resolve(this); return this; } };
    Promise.resolve(handler({ method, url: '/api/x', headers: { 'x-forwarded-for': 'pricing-' + (++ip), host: 'localhost' }, query: {}, body }, res)).then(() => resolve(res));
  });
}
const order = (extra = {}) => ({ items: [line({ price: 1, lineTotal: 1 })], subtotal: 1, total: 1, customer: { name: 'T', phone: '0812345678' },
  fulfilment: 'pickup', payment: 'Cash', ...extra });

test('order endpoint: a ฿1 tampered cart is stored at the real price, and server-owned fields are stripped', async () => {
  const r = await invoke(orderHandler, order({ payStatus: 'paid', paidAt: 1, storeId: 'somewhere', priceUnverified: false, walletReserved: true }));
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const saved = await getJSON('order:' + r.data.orderId);
  assert.equal(saved.total, 300);
  assert.equal(saved.items[0].unitPrice, 300);
  assert.equal(saved.priceAdjusted, true);
  assert.equal(saved.priceUnverified, false);
  assert.equal(saved.payStatus, undefined, 'a browser cannot mark its own order paid');
  assert.equal(saved.paidAt, undefined);
  assert.equal(saved.walletReserved, undefined);
  assert.equal(saved.storeId, 'pattanakarn', 'set by the server for pickup, not taken from the body');
});

test('order endpoint: invalid quantity is a 400', async () => {
  assert.equal((await invoke(orderHandler, order({ items: [line({ qty: -3 })] }))).code, 400);
});

test('an unverifiable order is taken for cash but refused by every online payment path', async () => {
  const r = await invoke(orderHandler, order({ items: [{ name: 'Not On Menu', option: '', qty: 1, price: 5 }] }));
  assert.equal(r.code, 200);
  const saved = await getJSON('order:' + r.data.orderId);
  assert.equal(saved.priceUnverified, true);
  assert.equal(saved.priceIssues[0].name, 'Not On Menu');
  for (const [name, h, body] of [
    ['omise card', payHandler, { orderId: r.data.orderId, method: 'card', token: 'tokn_test' }],
    ['omise promptpay', payHandler, { orderId: r.data.orderId, method: 'promptpay' }],
    ['gb prime pay', gbpHandler, { orderId: r.data.orderId, action: 'qr' }],
    ['2c2p', c2pHandler, { orderId: r.data.orderId }],
  ]) {
    const p = await invoke(h, body);
    assert.equal(p.code, 409, `${name}: ${JSON.stringify(p.data)}`);
    assert.equal(p.data.error, 'price_unverified');
  }
  const wallet = await invoke(orderHandler, order({ payment: 'Wallet', items: [{ name: 'Not On Menu', option: '', qty: 1, price: 5 }] }));
  assert.equal(wallet.code, 409);
});
