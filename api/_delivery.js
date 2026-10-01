/* Private, post-checkout tracking for explicitly approved ordinary retail SKUs.
   Separate records prevent GPS writes from overwriting payment/order records. */
import crypto from 'node:crypto';
import { getJSON, setJSON, storageBackend } from './_store.js';
import { getMenu } from './_menu.js';
export const TTL = 7 * 86400;
export const token = () => crypto.randomBytes(32).toString('hex');
export const key = id => 'delivery:' + id;
export const terminalKey = id => 'delivery-ended:' + id;
export const locationKey = (id, generation) => `delivery-location:${id}:${generation}`;
export const pausedKey = (id, generation) => `delivery-paused:${id}:${generation}`;
export const startedKey = (id, generation) => `delivery-started:${id}:${generation}`;
export function point(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
    ? { lat: p.lat, lng: p.lng } : null;
}
export function eligible(order, menu, allow = process.env.DELIVERY_ALLOWED_PRODUCT_IDS || '') {
  const ids = new Set(allow.split(',').map(s => s.trim()).filter(Boolean));
  const products = new Map();
  for (const p of menu || []) {
    if (p.shId) products.set(String(p.shId), p);
    for (const t of p.priceTiers || []) if (t.shId) products.set(String(t.shId), p);
  }
  // Never infer eligibility from customer-supplied names or categories.
  const restricted = /cannabis|weed|flower|exotic|topshelf|midgrade|premium|edible|\bthc\b|\bcbd\b|vape|tobacco|alcohol|beer|wine|spirit|cocktail|joint|bong|grinder|rolling paper/i;
  return order.fulfilment === 'delivery' && Array.isArray(order.items) && order.items.length > 0 &&
    order.items.every(i => {
      const id = String(i.shId || ''), p = products.get(id);
      return ids.has(id) && p && !restricted.test([p.name, p.category, p.type].join(' '));
    });
}
export function ready() { return Boolean(storageBackend()); }
export async function write(k, value, ttl = TTL) {
  if (!ready()) throw new Error('Delivery storage unavailable');
  await setJSON(k, value, ttl);
  if (!ready()) throw new Error('Delivery storage unavailable');
}
export async function createDelivery(order) {
  if (!ready() || !process.env.DELIVERY_ALLOWED_PRODUCT_IDS) return null;
  const { data } = await getMenu();
  if (!eligible(order, data)) return null;
  const record = { orderId: order.orderId, customerToken: token(), createdAt: Date.now(),
    expiresAt: Date.now() + TTL * 1000, destination: point(order.delivery?.coordinates), driver: null };
  await write(key(order.orderId), record);
  return '/delivery.html#' + new URLSearchParams({ id: order.orderId, token: record.customerToken });
}
export async function endDelivery(id, status = 'completed') {
  const d = await getJSON(key(id));
  if (!d || d.expiresAt <= Date.now()) return;
  await write(terminalKey(id), { status, at: Date.now() }, 14 * 86400);
  if (d.driver) await write(locationKey(id, d.driver.token), null, 1);
}
export async function routeFor(location, destination) {
  if (!location || !destination || !process.env.GOOGLE_MAPS_API_KEY) return null;
  const waypoint = p => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  try {
    const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.polyline.encodedPolyline' },
      body: JSON.stringify({ origin: waypoint(location), destination: waypoint(destination),
        travelMode: process.env.DELIVERY_MODE === 'TWO_WHEELER' ? 'TWO_WHEELER' : 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE', computeAlternativeRoutes: false })
    });
    if (!r.ok) return null;
    const route = (await r.json()).routes?.[0];
    const seconds = parseFloat(route?.duration);
    return route?.polyline?.encodedPolyline && Number.isFinite(seconds)
      ? { polyline: route.polyline.encodedPolyline, minutes: Math.max(1, Math.ceil(seconds / 60)), at: Date.now() } : null;
  } catch { return null; }
}
