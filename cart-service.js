(function (global) {
  'use strict';

  const STORAGE_KEY = 'dank_cart';
  const HANDOFF_KEY = 'dank_checkout_cart';
  const META_KEY = 'dank_cart_meta';
  const EVENT_NAME = 'dank:cart-changed';
  const VERSION = 2;

  const ruleHandlers = new Map();

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); }
    catch (error) { console.warn('Cart data could not be parsed', error); return fallback; }
  }

  function normalizeItem(item, index) {
    const source = item && typeof item === 'object' ? item : {};
    const qty = Math.max(1, Number(source.qty ?? source.quantity ?? source.count ?? 1) || 1);
    const price = Number(source.price ?? source.unitPrice ?? source.salePrice ?? source.selectedPrice ?? 0) || 0;
    const name = source.name ?? source.title ?? source.productName ?? source.label ?? 'Product';
    const tierLabel = source.tierLabel ?? source.option ?? source.variant ?? source.size ?? source.unit ?? '';
    const image = source.image ?? source.img ?? source.photo ?? source.imageUrl ?? source.thumbnail ?? '';
    const id = source.id ?? source.productId ?? source.shId ?? source.sku ?? String(index);
    const key = source.key || [id, tierLabel].filter(Boolean).join('|') || String(index);
    return {
      ...source,
      key: String(key), id,
      shId: source.shId ?? source.sku ?? '',
      name: String(name), tierLabel: String(tierLabel || ''),
      price, qty, image,
      category: source.category ?? '', type: source.type ?? '',
      bonus: Boolean(source.bonus)
    };
  }

  function normalize(items) {
    return (Array.isArray(items) ? items : []).map(normalizeItem);
  }

  function readItems(storage, key) {
    try {
      const value = safeParse(storage.getItem(key), []);
      if (Array.isArray(value)) return normalize(value);
      if (value && Array.isArray(value.items)) return normalize(value.items);
      if (value && Array.isArray(value.cart)) return normalize(value.cart);
    } catch (error) {}
    return [];
  }

  function getItems() {
    const handoff = readItems(global.sessionStorage, HANDOFF_KEY);
    return handoff.length ? handoff : readItems(global.localStorage, STORAGE_KEY);
  }

  function defaultMeta() {
    return { version: VERSION, promo: '', discount: 0, deliveryFee: 100, membership: null, loyaltyPoints: 0 };
  }

  function getMeta() {
    try { return { ...defaultMeta(), ...safeParse(global.localStorage.getItem(META_KEY), {}) }; }
    catch (error) { return defaultMeta(); }
  }

  function emit(items, meta) {
    try { global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { items, meta } })); }
    catch (error) {}
  }

  function save(items, metaPatch) {
    const normalized = normalize(items);
    const meta = setMeta(metaPatch || {}, false);
    const payload = JSON.stringify(normalized);
    try { global.localStorage.setItem(STORAGE_KEY, payload); } catch (error) {}
    try { global.sessionStorage.setItem(HANDOFF_KEY, payload); } catch (error) {}
    emit(normalized, meta);
    return normalized;
  }

  function setMeta(patch, shouldEmit = true) {
    const meta = { ...getMeta(), ...(patch || {}), version: VERSION };
    try { global.localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (error) {}
    if (shouldEmit) emit(getItems(), meta);
    return meta;
  }

  function findIndex(items, identifier) {
    if (Number.isInteger(identifier)) return identifier;
    return items.findIndex(item => item.key === identifier || item.id === identifier || item.shId === identifier);
  }

  function add(item, quantity) {
    const items = getItems();
    const incoming = normalizeItem({ ...item, qty: quantity ?? item?.qty ?? 1 }, items.length);
    const index = findIndex(items, incoming.key);
    if (index >= 0) items[index].qty = Math.max(1, Number(items[index].qty || 1) + Number(incoming.qty || 1));
    else items.push(incoming);
    return save(items);
  }

  function remove(identifier) {
    const items = getItems();
    const index = findIndex(items, identifier);
    if (index >= 0) items.splice(index, 1);
    return save(items);
  }

  function updateQty(identifier, value, options) {
    const settings = options || {};
    const items = getItems();
    const index = findIndex(items, identifier);
    if (index < 0) return items;
    const current = Number(items[index].qty) || 1;
    const next = settings.mode === 'delta' ? current + Number(value || 0) : Number(value);
    const minimum = Number.isFinite(settings.minimum) ? settings.minimum : 1;
    if (!Number.isFinite(next) || next < minimum) {
      if (settings.removeBelowMinimum) items.splice(index, 1);
      else items[index].qty = minimum;
    } else items[index].qty = next;
    return save(items);
  }

  function clear(options) {
    const keepMeta = options && options.keepMeta;
    try { global.localStorage.removeItem(STORAGE_KEY); } catch (error) {}
    try { global.sessionStorage.removeItem(HANDOFF_KEY); } catch (error) {}
    if (!keepMeta) try { global.localStorage.removeItem(META_KEY); } catch (error) {}
    emit([], keepMeta ? getMeta() : defaultMeta());
    return [];
  }

  function count(items) {
    return normalize(items ?? getItems()).reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
  }

  function subtotal(items) {
    return normalize(items ?? getItems()).reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);
  }

  function registerRule(name, handler) {
    if (typeof handler !== 'function') throw new TypeError('Cart rule must be a function');
    ruleHandlers.set(name, handler);
    return () => ruleHandlers.delete(name);
  }

  function calculate(options) {
    const items = normalize(options?.items ?? getItems());
    const meta = { ...getMeta(), ...(options?.meta || {}) };
    let summary = {
      items, subtotal: subtotal(items),
      discount: Math.max(0, Number(meta.discount) || 0),
      deliveryFee: Math.max(0, Number(meta.deliveryFee) || 0),
      promo: meta.promo || '', membership: meta.membership || null,
      loyaltyPoints: Math.max(0, Number(meta.loyaltyPoints) || 0),
      adjustments: []
    };
    ruleHandlers.forEach((handler, name) => {
      try {
        const result = handler({ ...summary, meta, options: options || {} });
        if (result && typeof result === 'object') summary = { ...summary, ...result };
      } catch (error) { console.error('Cart rule failed:', name, error); }
    });
    summary.discount = Math.max(0, Number(summary.discount) || 0);
    summary.deliveryFee = Math.max(0, Number(summary.deliveryFee) || 0);
    summary.total = Math.max(0, summary.subtotal - summary.discount + summary.deliveryFee);
    return summary;
  }

  function applyPromo(code, resolver) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const base = calculate();
    let discount = 0;
    if (typeof resolver === 'function') discount = Number(resolver(normalizedCode, base)) || 0;
    else if (normalizedCode === 'DANK10') discount = Math.round(base.subtotal * 0.10);
    setMeta({ promo: normalizedCode, discount: Math.max(0, discount) });
    return calculate();
  }

  function applyMembership(membership) {
    setMeta({ membership: membership || null });
    return calculate();
  }

  function applyBonusGrams(handler) {
    if (typeof handler !== 'function') return getItems();
    const result = handler(getItems(), calculate());
    return Array.isArray(result) ? save(result) : getItems();
  }

  function calculateDelivery(resolver) {
    const summary = calculate();
    const fee = typeof resolver === 'function' ? Number(resolver(summary)) : Number(resolver);
    setMeta({ deliveryFee: Number.isFinite(fee) ? Math.max(0, fee) : summary.deliveryFee });
    return calculate();
  }

  function handoff() {
    const items = getItems();
    try { global.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(items)); } catch (error) {}
    return items;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    const handler = event => listener(event.detail.items, event.detail.meta);
    global.addEventListener(EVENT_NAME, handler);
    const storageHandler = event => {
      if ([STORAGE_KEY, META_KEY].includes(event.key)) listener(getItems(), getMeta());
    };
    global.addEventListener('storage', storageHandler);
    return function unsubscribe() {
      global.removeEventListener(EVENT_NAME, handler);
      global.removeEventListener('storage', storageHandler);
    };
  }

  global.Cart = Object.freeze({
    version: VERSION, storageKey: STORAGE_KEY, handoffKey: HANDOFF_KEY, metaKey: META_KEY,
    normalize, getItems, getMeta, setMeta, save, add, remove, updateQty, clear,
    count, subtotal, calculate, applyPromo, applyMembership, applyBonusGrams,
    calculateDelivery, registerRule, handoff, subscribe
  });
})(window);
