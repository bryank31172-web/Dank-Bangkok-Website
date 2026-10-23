/* Private, post-checkout tracking for explicitly approved ordinary retail SKUs.
   Separate records prevent GPS writes from overwriting payment/order records. */
import crypto from 'node:crypto';
import { getJSON, setJSON, setJSONIfNewer, storageBackend } from './_store.js';
export const TTL = 7 * 86400;
export const token = () => crypto.randomBytes(32).toString('hex');
export const key = id => 'delivery:' + id;
export const terminalKey = id => 'delivery-ended:' + id;
export const locationKey = (id, generation) => `delivery-location:${id}:${generation}`;
export const departureKey = (id, generation) => `delivery-departure:${id}:${generation}`;
export const pausedKey = (id, generation) => `delivery-paused:${id}:${generation}`;
export const startedKey = (id, generation) => `delivery-started:${id}:${generation}`;
export function point(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
    ? { lat: p.lat, lng: p.lng } : null;
}
export const PRODUCTS_CONFIG_KEY = 'delivery:products';
export const LIVE_MENU_SOURCES = new Set(['pos', 'feed', 'storehub']);
// Every live POS product can be chosen for delivery tracking. (Until Oct 2026 only
// food and merchandise could; the shop owner chose to allow every product.)
export function catalogProducts(menu) {
  const rows = new Map();
  for (const p of menu || []) {
    if (!p || p._hidden) continue;
    const tiers = p.priceTiers?.length ? p.priceTiers : [{ shId: p.shId, price: p.price }];
    for (const t of tiers) {
      const id = String(t.shId || p.shId || '').trim();
      if (id && id.length <= 160) rows.set(id, { id, name: String(p.name || ''),
        category: String(p.category || ''), option: String(t.label || ''),
        price: Number.isFinite(Number(t.price ?? p.price)) ? Number(t.price ?? p.price) : null });
    }
  }
  return [...rows.values()].sort((a,b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function configuredProductIds(config, fallback = process.env.DELIVERY_ALLOWED_PRODUCT_IDS || '') {
  // A saved empty selection disables tracking, including the legacy env list.
  return config ? (Array.isArray(config.ids) ? config.ids.filter(id => typeof id === 'string') : [])
    : fallback.split(',').map(id => id.trim()).filter(Boolean);
}
// "Track every product" switch: every delivery order gets tracking at checkout,
// including products added to the POS later.
export const tracksEverything = config => config?.all === true;
export function eligible(order, menu, allow = process.env.DELIVERY_ALLOWED_PRODUCT_IDS || '', all = false) {
  if (order.fulfilment !== 'delivery' || !Array.isArray(order.items) || !order.items.length) return false;
  if (all) return true;
  const ids = new Set(Array.isArray(allow) ? allow : allow.split(',').map(s => s.trim()).filter(Boolean));
  const products = new Set(catalogProducts(menu).map(p => p.id));
  return order.items.every(i => ids.has(String(i.shId || '')) && products.has(String(i.shId || '')));
}
export function ready() { return Boolean(storageBackend()); }
export async function write(k, value, ttl = TTL) {
  if (!ready()) throw new Error('Delivery storage unavailable');
  await setJSON(k, value, ttl);
  if (!ready()) throw new Error('Delivery storage unavailable');
}
export async function writeLocation(k, value) { return setJSONIfNewer(k, value, 3600); }
// Every website delivery order gets a tracking record the moment it is placed
// (Oct 2026: the owner chose this over the Delivery products setting, which no
// longer gates checkout). The record starts with NO links: the rider link is
// made when staff choose a rider, and the customer link straight after it —
// see issueCustomerLink(). Returns true when the record was written.
export async function createDelivery(order) {
  if (!ready() || order.fulfilment !== 'delivery') return false;
  const record = { orderId: order.orderId, customerToken: null, createdAt: Date.now(),
    expiresAt: Date.now() + TTL * 1000, destination: point(order.delivery?.coordinates), departurePhotoRequired: true, driver: null };
  await write(key(order.orderId), record);
  return true;
}
export const customerPath = (id, customerToken) =>
  customerToken ? '/delivery.html#' + new URLSearchParams({ id, token: customerToken }) : '';
// Makes the customer's tracking link once a rider is assigned; later calls
// return the same link. Returns '' when there is no rider yet.
export async function issueCustomerLink(id, deps = {}) {
  const d = { get: getJSON, write, token, ...deps };
  const record = await d.get(key(id));
  if (!record || record.expiresAt <= Date.now() || !record.driver) return '';
  if (!record.customerToken) {
    record.customerToken = d.token();
    await d.write(key(id), record);
  }
  const latest = await d.get(key(id));
  return customerPath(id, latest?.customerToken || record.customerToken);
}
export async function endDelivery(id, status = 'completed') {
  const d = await getJSON(key(id));
  if (!d || d.expiresAt <= Date.now()) return;
  await write(terminalKey(id), { status, at: Date.now() }, 14 * 86400);
  if (d.driver) {await write(locationKey(id, d.driver.token), null, 1);await write(departureKey(id, d.driver.token), null, 1);}
}
export async function routeFor(location, destination) {
  if (!location || !destination || !process.env.GOOGLE_MAPS_API_KEY) return null;
  const waypoint = p => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  try {
    const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals' },
      body: JSON.stringify({ origin: waypoint(location), destination: waypoint(destination),
        travelMode: 'TWO_WHEELER',
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL', extraComputations: ['TRAFFIC_ON_POLYLINE'], computeAlternativeRoutes: false })
    });
    if (!r.ok) return null;
    const route = (await r.json()).routes?.[0];
    const seconds = /^\d+(?:\.\d+)?s$/.test(route?.duration || '') ? parseFloat(route.duration) : NaN;
    return route?.polyline?.encodedPolyline && Number.isFinite(seconds) && seconds >= 0
      ? { mode: 'TWO_WHEELER', polyline: route.polyline.encodedPolyline, traffic: Array.isArray(route.travelAdvisory?.speedReadingIntervals) ? route.travelAdvisory.speedReadingIntervals.filter(i => Number.isInteger(i.startPolylinePointIndex ?? 0) && (i.startPolylinePointIndex ?? 0) >= 0 && Number.isInteger(i.endPolylinePointIndex) && i.endPolylinePointIndex > (i.startPolylinePointIndex ?? 0) && ['NORMAL','SLOW','TRAFFIC_JAM'].includes(i.speed)).map(i => ({start: i.startPolylinePointIndex ?? 0, end: i.endPolylinePointIndex, speed: i.speed})) : [], minutes: Math.max(1, Math.ceil(seconds / 60)),
          ...(Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0 ? {km: Math.round(route.distanceMeters / 100) / 10} : {}), at: Date.now() } : null;
  } catch { return null; }
}

