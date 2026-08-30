(function (global) {
  'use strict';

  const STORAGE_KEY = 'dank_cart';
  const HANDOFF_KEY = 'dank_checkout_cart';
  const EVENT_NAME = 'dank:cart-changed';

  function safeParse(raw) {
    if (!raw) return [];
    try {
      const value = JSON.parse(raw);
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.items)) return value.items;
      if (value && Array.isArray(value.cart)) return value.cart;
    } catch (error) {
      console.warn('Cart data could not be parsed', error);
    }
    return [];
  }

  function normalizeItem(item, index) {
    const source = item && typeof item === 'object' ? item : {};
    const qty = Math.max(1, Number(source.qty ?? source.quantity ?? source.count ?? 1) || 1);
    const price = Number(source.price ?? source.unitPrice ?? source.salePrice ?? source.selectedPrice ?? 0) || 0;
    const name = source.name ?? source.title ?? source.productName ?? source.label ?? 'Product';
    const tierLabel = source.tierLabel ?? source.option ?? source.variant ?? source.size ?? source.unit ?? '';
    const image = source.image ?? source.img ?? source.photo ?? source.imageUrl ?? source.thumbnail ?? '';
    const id = source.id ?? source.productId ?? source.shId ?? source.sku ?? String(index);
    const key = source.key ?? [id, tierLabel].filter(Boolean).join('|') ?? String(index);

    return {
      ...source,
      key: String(key || index),
      id,
      shId: source.shId ?? source.sku ?? '',
      name: String(name),
      tierLabel: String(tierLabel || ''),
      price,
      qty,
      image,
      bonus: Boolean(source.bonus)
    };
  }

  function normalize(items) {
    return (Array.isArray(items) ? items : []).map(normalizeItem);
  }

  function readStorage(storage, key) {
    try {
      return safeParse(storage.getItem(key));
    } catch (error) {
      return [];
    }
  }

  function getItems() {
    const handoff = readStorage(global.sessionStorage, HANDOFF_KEY);
    const stored = readStorage(global.localStorage, STORAGE_KEY);
    const items = handoff.length ? handoff : stored;
    return normalize(items);
  }

  function emit(items) {
    try {
      global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { items } }));
    } catch (error) {}
  }

  function save(items) {
    const normalized = normalize(items);
    const payload = JSON.stringify(normalized);
    try { global.localStorage.setItem(STORAGE_KEY, payload); } catch (error) {}
    try { global.sessionStorage.setItem(HANDOFF_KEY, payload); } catch (error) {}
    emit(normalized);
    return normalized;
  }

  function findIndex(items, identifier) {
    if (Number.isInteger(identifier)) return identifier;
    return items.findIndex(item =>
      item.key === identifier ||
      item.id === identifier ||
      item.shId === identifier
    );
  }

  function add(item, quantity) {
    const items = getItems();
    const incoming = normalizeItem({ ...item, qty: quantity ?? item?.qty ?? 1 }, items.length);
    const index = findIndex(items, incoming.key);
    if (index >= 0) {
      items[index].qty = Math.max(1, Number(items[index].qty || 1) + Number(incoming.qty || 1));
    } else {
      items.push(incoming);
    }
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
    } else {
      items[index].qty = next;
    }
    return save(items);
  }

  function clear() {
    try { global.localStorage.removeItem(STORAGE_KEY); } catch (error) {}
    try { global.sessionStorage.removeItem(HANDOFF_KEY); } catch (error) {}
    emit([]);
    return [];
  }

  function count(items) {
    return normalize(items ?? getItems()).reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
  }

  function subtotal(items) {
    return normalize(items ?? getItems()).reduce(
      (sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1),
      0
    );
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    const handler = event => listener(event.detail.items);
    global.addEventListener(EVENT_NAME, handler);
    return function unsubscribe() {
      global.removeEventListener(EVENT_NAME, handler);
    };
  }

  global.Cart = Object.freeze({
    storageKey: STORAGE_KEY,
    handoffKey: HANDOFF_KEY,
    normalize,
    getItems,
    save,
    add,
    remove,
    updateQty,
    clear,
    count,
    subtotal,
    subscribe
  });
})(window);
