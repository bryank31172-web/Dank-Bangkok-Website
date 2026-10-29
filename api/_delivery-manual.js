/* Delivery orders typed into the LINE "delivery" form (customer ordered by LINE,
   WhatsApp or phone, not on the website), and the riders staff save from it.

   Hand-typed orders live in their own index, never `orders:index`: that index is
   what /api/sales, /api/stats, best sellers and the POS order pull read, and the
   POS already records these sales at the till. The staff portal's Orders tab asks
   for them explicitly (/api/orders?include=line). */
import crypto from 'node:crypto';

export const MANUAL_INDEX = 'orders:line';
export const SAVED_RIDERS_KEY = 'delivery:saved-riders:v1';
export const SAVED_RIDERS_TTL = 365 * 86400;
const MAX_SAVED = 100, MAX_ITEMS = 30;

export const cleanPhone = value => {
  const phone = String(value || '').trim().replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(phone) ? phone : '';
};
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const money = value => Math.round(Number(value) * 100) / 100;

// Returns {customer, items, total} or {error}. Price per line is optional; the
// total defaults to the sum of the priced lines but staff may overwrite it.
export function parseManualOrder(input) {
  const raw = Array.isArray(input?.items) ? input.items : [];
  if (!raw.length || raw.length > MAX_ITEMS) return {error: `Add between 1 and ${MAX_ITEMS} products`};
  const items = [];
  for (const row of raw) {
    const name = text(row?.name, 120), qty = Number(row?.qty);
    const hasPrice = row?.price !== '' && row?.price != null;
    const price = hasPrice ? money(row.price) : null;
    if (!name) return {error: 'Every product line needs a name'};
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return {error: `Check the quantity for ${name}`};
    if (hasPrice && !(Number.isFinite(price) && price >= 0 && price <= 1e6)) return {error: `Check the price for ${name}`};
    items.push({name, qty, ...(price == null ? {} : {price})});
  }
  const sum = money(items.reduce((s, i) => s + (i.price || 0) * i.qty, 0));
  const given = input?.total === '' || input?.total == null ? null : money(input.total);
  if (given != null && !(Number.isFinite(given) && given >= 0 && given <= 1e7)) return {error: 'Check the total'};
  const name = text(input?.customer?.name, 80), rawPhone = text(input?.customer?.phone, 30);
  const phone = cleanPhone(rawPhone);
  if (rawPhone && !phone) return {error: 'Check the customer phone number'};
  return {customer: {name, phone}, items, total: given ?? sum};
}

// LN-1029-4821: LINE order, Bangkok month+day, four random digits.
export async function manualOrderId(get) {
  const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(5, 10).replace('-', '');
  for (let i = 0; i < 8; i++) {
    const id = `LN-${day}-${crypto.randomInt(1000, 10000)}`;
    if (!(await get('order:' + id))) return id;
  }
  throw new Error('Could not allocate an order reference');
}

export function manualOrderRecord(id, parsed, place, coordinates) {
  return {orderId: id, at: Date.now(), status: 'new', source: 'line', fulfilment: 'delivery',
    customer: parsed.customer, items: parsed.items, subtotal: parsed.total, total: parsed.total,
    delivery: {address: place, coordinates}};
}

// Saved riders are people, not staff accounts: name and phone only, no login.
export function parseRider(input) {
  const name = text(input?.name, 80), phone = cleanPhone(input?.phone);
  if (!name || !phone) return {error: 'Add the rider name and a valid phone number'};
  return {id: /^r_[a-f0-9]{12}$/.test(input?.id || '') ? input.id : '', name, phone, save: input?.save !== false};
}
// Picking a saved rider and changing their details updates the saved row; a new
// rider is added when "save" is ticked, matched by phone so nobody is saved twice.
export function saveRider(rows, rider) {
  const list = (Array.isArray(rows) ? rows : []).filter(r => r && /^r_[a-f0-9]{12}$/.test(r.id));
  const match = list.find(r => rider.id && r.id === rider.id) || list.find(r => r.phone === rider.phone);
  if (!match && !rider.save) return {rows: null, id: ''};
  const row = {id: match?.id || 'r_' + crypto.randomBytes(6).toString('hex'), name: rider.name, phone: rider.phone, usedAt: Date.now()};
  return {rows: [row, ...list.filter(r => r.id !== row.id)].slice(0, MAX_SAVED), id: row.id};
}
export const savedRiderList = rows => (Array.isArray(rows) ? rows : [])
  .filter(r => r && /^r_[a-f0-9]{12}$/.test(r.id) && r.name && r.phone)
  .map(({id, name, phone}) => ({id, name, phone}));
