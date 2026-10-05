/* Private, post-checkout tracking for explicitly approved ordinary retail SKUs.
   Separate records prevent GPS writes from overwriting payment/order records. */
import crypto from 'node:crypto';
import { getJSON, setJSON, setJSONIfNewer, storageBackend } from './_store.js';
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
export const PRODUCTS_CONFIG_KEY = 'delivery:products';
export const LIVE_MENU_SOURCES = new Set(['pos', 'feed', 'storehub']);
export function ordinaryProduct(p) {
  const restricted = /cannabis|weed|flower|exotic|topshelf|midgrade|edible|\bthc\b|\bcbd\b|vape|tobacco|alcohol|beer|wine|spirit|cocktail|joint|bong|grinder|rolling paper|kamagra|sildenafil|kratom|ketamine|opioid|\bpipe\b/i;
  const ordinaryCategory = /food|snack|meal|dessert|soft drink|coffee|tea|juice|water|merch|apparel|clothing|souvenir|accessor/i;
  return p && ordinaryCategory.test(String(p.category || '')) &&
    !restricted.test([p.name, p.category, p.type, p.description].join(' '));
}
export function catalogProducts(menu) {
  const rows = new Map();
  for (const p of menu || []) {
    if (!ordinaryProduct(p)) continue;
    const tiers = p.priceTiers?.length ? p.priceTiers : [{ shId: p.shId, price: p.price }];
    for (const t of tiers) {
      const id = String(t.shId || p.shId || '').trim();
      if (id && id.length <= 160) rows.set(id, { id, name: String(p.name || ''),
        category: String(p.category || ''), option: String(t.label || ''),
        price: Number.isFinite(Number(t.price ?? p.price)) ? Number(t.price ?? p.price) : null });
    }
  }
  return [...rows.values()].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function configuredProductIds(config, fallback = process.env.DELIVERY_ALLOWED_PRODUCT_IDS || '') {
  // A saved empty selection disables tracking, including the legacy env list.
  return config ? (Array.isArray(config.ids) ? config.ids.filter(id => typeof id === 'string') : [])
    : fallback.split(',').map(id => id.trim()).filter(Boolean);
}
export function eligible(order, menu, allow = process.env.DELIVERY_ALLOWED_PRODUCT_IDS || '') {
  const ids = new Set(Array.isArray(allow) ? allow : allow.split(',').map(s => s.trim()).filter(Boolean));
  const products = new Set(catalogProducts(menu).map(p => p.id));
  return order.fulfilment === 'delivery' && Array.isArray(order.items) && order.items.length > 0 &&
    order.items.every(i => ids.has(String(i.shId || '')) && products.has(String(i.shId || '')));
}
export function ready() { return Boolean(storageBackend()); }
export async function write(k, value, ttl = TTL) {
  if (!ready()) throw new Error('Delivery storage unavailable');
  await setJSON(k, value, ttl);
  if (!ready()) throw new Error('Delivery storage unavailable');
}
export async function writeLocation(k, value) { return setJSONIfNewer(k, value, 3600); }
export async function createDelivery(order) {
  if (!ready()) return null;
  const [menu, config] = await Promise.all([getMenu(), getJSON(PRODUCTS_CONFIG_KEY)]);
  if (!ready() || !LIVE_MENU_SOURCES.has(menu.source) || !eligible(order, menu.data, configuredProductIds(config))) return null;
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
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' },
      body: JSON.stringify({ origin: waypoint(location), destination: waypoint(destination),
        travelMode: process.env.DELIVERY_MODE === 'TWO_WHEELER' ? 'TWO_WHEELER' : 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE', computeAlternativeRoutes: false })
    });
    if (!r.ok) return null;
    const route = (await r.json()).routes?.[0];
    const seconds = /^\d+(?:\.\d+)?s$/.test(route?.duration || '') ? parseFloat(route.duration) : NaN;
    return route?.polyline?.encodedPolyline && Number.isFinite(seconds) && seconds >= 0
      ? { polyline: route.polyline.encodedPolyline, minutes: Math.max(1, Math.ceil(seconds / 60)),
          ...(Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0 ? {km: Math.round(route.distanceMeters / 100) / 10} : {}), at: Date.now() } : null;
  } catch { return null; }
}
