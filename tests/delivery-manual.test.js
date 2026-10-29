import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/delivery.js';
import { key } from '../api/_delivery.js';
import { parseManualOrder, saveRider, MANUAL_INDEX, SAVED_RIDERS_KEY } from '../api/_delivery-manual.js';

const GROUP = 'C' + 'g'.repeat(32), DEST = {lat: 13.7463, lng: 100.5346};
function fixture(overrides = {}) {
  const db = new Map(), sent = [], index = [];
  const get = async k => structuredClone(db.get(k) ?? null), write = async (k, v) => {db.set(k, structuredClone(v))};
  let n = 0;
  const handler = createHandler({get, write, ready: () => true, rate: async () => true, group: () => GROUP,
    send: async (to, msgs) => {sent.push([to, msgs]); return {ok: true}},
    permission: (req, res) => {if (req.headers.authorization === 'staff') return true; res.status(401).json({error: 'bad key'}); return false},
    accounts: async () => [{id: 'a1', name: 'Staff Rider', phone: '0812345678', role: 'parttime', active: true}],
    indexAdd: async (id, k) => {index.push([k, id])}, token: () => String(++n % 10).repeat(64),
    manualOrderId: async () => 'LN-1029-' + (4000 + ++n),
    createDelivery: async o => {db.set(key(o.orderId), {orderId: o.orderId, customerToken: null, expiresAt: Date.now() + 86400000, destination: o.delivery?.coordinates || null, departurePhotoRequired: true, driver: null}); return true},
    ...overrides});
  async function call(body, method = 'POST') {
    const req = {method, headers: {authorization: 'staff'}, query: method === 'GET' ? body : {}, body: method === 'POST' ? body : {}};
    const res = {code: 200, setHeader() {}, status(c) {this.code = c; return this}, json(j) {this.data = j; return this}};
    await handler(req, res); return res;
  }
  return {db, sent, index, call};
}
const typedOrder = (extra = {}) => ({role: 'staff', action: 'create', destination: DEST, place: 'Siam Paragon',
  manual: {customer: {name: 'Nok', phone: '089-123-4567'}, items: [{name: 'Gelato 41 (1g)', qty: 2, price: 350}, {name: 'Lighter', qty: 1, price: ''}], total: ''},
  rider: {name: 'Somchai', phone: '081 111 2222', save: true}, ...extra});

test('a typed order is created, tracked and posted to the group, in its own index and never orders:index', async () => {
  const f = fixture();
  const r = await f.call(typedOrder());
  assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.match(r.data.orderId, /^LN-1029-\d{4}$/);
  const order = f.db.get('order:' + r.data.orderId);
  assert.equal(order.source, 'line'); assert.equal(order.fulfilment, 'delivery'); assert.equal(order.total, 700);
  assert.deepEqual(order.items, [{name: 'Gelato 41 (1g)', qty: 2, price: 350}, {name: 'Lighter', qty: 1}]);
  assert.deepEqual(order.customer, {name: 'Nok', phone: '0891234567'});
  assert.deepEqual(order.delivery, {address: 'Siam Paragon', coordinates: DEST});
  assert.deepEqual(f.index, [[MANUAL_INDEX, r.data.orderId]]);
  const rec = f.db.get(key(r.data.orderId));
  assert.equal(rec.driver.name, 'Somchai'); assert.equal(rec.driver.phone, '0811112222'); assert.equal(rec.driver.accountId, undefined);
  assert.match(r.data.driverUrl, /^\/driver-delivery\.html#/); assert.match(r.data.customerUrl, /^\/delivery\.html#/);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0][0], GROUP); assert.match(f.sent[0][1][0].text, /Rider for LN-.*: Somchai/);
  const saved = f.db.get(SAVED_RIDERS_KEY);
  assert.equal(saved.length, 1); assert.equal(rec.driver.savedRiderId, saved[0].id); assert.equal(r.data.rider.savedId, saved[0].id);
});

test('a rejected form writes no order', async () => {
  const f = fixture();
  const bad = [
    typedOrder({manual: {items: []}}),
    typedOrder({manual: {items: [{name: '', qty: 1}]}}),
    typedOrder({manual: {items: [{name: 'X', qty: 0}]}}),
    typedOrder({manual: {items: [{name: 'X', qty: 1, price: -5}]}}),
    typedOrder({manual: {items: [{name: 'X', qty: 1}], customer: {phone: 'abc'}}}),
    typedOrder({rider: {name: 'Somchai', phone: '12'}}),
    typedOrder({rider: undefined}),
    typedOrder({destination: undefined}),
  ];
  for (const body of bad) assert.equal((await f.call(body)).code, 400, JSON.stringify(body));
  assert.deepEqual([...f.db.keys()], []); assert.deepEqual(f.index, []);
  assert.equal((await f.call({...typedOrder(), role: ''})).code, 403);
  const anon = await createHandler({ready: () => true, rate: async () => true, permission: (q, s) => {s.status(401).json({}); return false}});
  const res = {setHeader() {}, status(c) {this.code = c; return this}, json() {return this}};
  await anon({method: 'POST', headers: {}, body: typedOrder()}, res); assert.equal(res.code, 401);
});

test('saved riders: listed, reused and edited without duplicates, not saved when unticked, removable', async () => {
  const f = fixture();
  await f.call(typedOrder());
  let opts = await f.call({action: 'rider-options'}, 'GET');
  assert.equal(opts.code, 200); assert.deepEqual(opts.data.saved.map(r => [r.name, r.phone]), [['Somchai', '0811112222']]);
  assert.deepEqual(opts.data.riders.map(r => r.id), ['a1']);
  const id = opts.data.saved[0].id;
  await f.call(typedOrder({rider: {id, name: 'Somchai K.', phone: '0819998888', save: true}}));
  await f.call(typedOrder({rider: {name: 'One-off', phone: '0820000000', save: false}}));
  opts = await f.call({action: 'rider-options'}, 'GET');
  assert.deepEqual(opts.data.saved.map(r => [r.id, r.name, r.phone]), [[id, 'Somchai K.', '0819998888']]);
  const rm = await f.call({action: 'saved-rider-remove', riderId: id});
  assert.equal(rm.code, 200); assert.deepEqual(rm.data.saved, []);
  assert.deepEqual((await f.call({action: 'rider-options'}, 'GET')).data.saved, []);
  assert.equal((await f.call({action: 'saved-rider-remove', riderId: id}, 'GET')).code, 405);
});

test('a website order can take a typed rider; staff riders keep working', async () => {
  const f = fixture();
  f.db.set('order:W-1', {orderId: 'W-1', status: 'new', fulfilment: 'delivery', items: [{name: 'Sandwich', qty: 1}], delivery: {address: 'Lobby'}});
  const r = await f.call({role: 'staff', action: 'create', id: 'W-1', destination: DEST, rider: {name: 'Lek', phone: '0833333333', save: true}});
  assert.equal(r.code, 200); assert.equal(f.db.get(key('W-1')).driver.name, 'Lek'); assert.deepEqual(f.index, []);
  const s = await f.call({role: 'staff', action: 'create', id: 'W-1', destination: DEST, riderId: 'a1'});
  assert.equal(s.code, 200); assert.equal(f.db.get(key('W-1')).driver.accountId, 'a1');
});

test('parse helpers: total adds up priced lines unless typed; a saved rider is matched by phone', () => {
  assert.equal(parseManualOrder({items: [{name: 'A', qty: 3, price: 10.5}]}).total, 31.5);
  assert.equal(parseManualOrder({items: [{name: 'A', qty: 3, price: 10}], total: '25'}).total, 25);
  assert.equal(parseManualOrder({items: Array.from({length: 31}, () => ({name: 'A', qty: 1}))}).error, 'Add between 1 and 30 products');
  const first = saveRider([], {id: '', name: 'A', phone: '0811111111', save: true});
  const again = saveRider(first.rows, {id: '', name: 'A2', phone: '0811111111', save: true});
  assert.equal(again.rows.length, 1); assert.equal(again.id, first.id); assert.equal(again.rows[0].name, 'A2');
  assert.deepEqual(saveRider(first.rows, {id: '', name: 'B', phone: '0822222222', save: false}), {rows: null, id: ''});
});

test('/api/orders shows typed orders only when asked (staff portal), never to the POS pull', async () => {
  process.env.STAFF_KEY = 'test-staff-key';
  const {setJSON} = await import('../api/_store.js');
  const {default: orders} = await import('../api/orders.js');
  const now = Date.now();
  await setJSON('orders:index', ['W-2', 'W-1']);
  await setJSON('order:W-1', {orderId: 'W-1', at: now - 3000, status: 'new'});
  await setJSON('order:W-2', {orderId: 'W-2', at: now - 1000, status: 'new'});
  await setJSON(MANUAL_INDEX, ['LN-1']);
  await setJSON('order:LN-1', {orderId: 'LN-1', at: now - 2000, status: 'new', source: 'line'});
  const get = async query => {
    const res = {setHeader() {}, status(c) {this.code = c; return this}, json(j) {this.data = j; return this}};
    await orders({method: 'GET', headers: {'x-staff-key': 'test-staff-key'}, query}, res); return res;
  };
  const pos = await get({});
  assert.equal(pos.code, 200); assert.deepEqual(pos.data.orders.map(o => o.orderId), ['W-2', 'W-1']);
  assert.deepEqual((await get({include: 'line'})).data.orders.map(o => o.orderId), ['W-2', 'LN-1', 'W-1']);
  // Paged: LN-1 belongs on the page whose time range holds it, once.
  assert.deepEqual((await get({include: 'line', limit: 1})).data.orders.map(o => o.orderId), ['W-2']);
  assert.deepEqual((await get({include: 'line', limit: 1, offset: 1})).data.orders.map(o => o.orderId), ['LN-1', 'W-1']);
});
