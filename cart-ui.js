(function (global) {
  'use strict';

  function requireCart() {
    if (!global.Cart) throw new Error('Cart service is required before cart-ui.js');
    return global.Cart;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (ch) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
    });
  }

  function money(value) {
    return '฿' + Math.round(Number(value) || 0).toLocaleString('en-US');
  }

  function resolveOptions(options) {
    const Cart = requireCart();
    const meta = Cart.getMeta();
    const config = { ...(meta.pricingConfig || {}), ...((options && options.pricingConfig) || {}) };
    return {
      items: options?.items || Cart.getItems(),
      membership: options && Object.prototype.hasOwnProperty.call(options, 'membership') ? options.membership : meta.membership,
      fulfilment: options?.fulfilment || meta.fulfilment || 'delivery',
      minimumOrder: Number(options?.minimumOrder ?? config.minimumOrder ?? meta.minimumOrder ?? 0) || 0,
      deliveryFee: Number(options?.deliveryFee ?? config.deliveryFee ?? meta.deliveryFee ?? 0) || 0,
      freeDeliveryOver: Number(options?.freeDeliveryOver ?? config.freeDeliveryOver ?? 0) || 0,
      promo: options && Object.prototype.hasOwnProperty.call(options, 'promo') ? options.promo : meta.promoDefinition,
      memberCode: options?.memberCode ?? config.memberCode ?? '',
      source: options?.source || meta.source || 'cart-ui',
      pricingConfig: config
    };
  }

  function memberCodeStacks(promo, options) {
    const memberActive = Boolean(options?.membership?.active);
    const memberCode = String(options?.memberCode || '').trim().toUpperCase();
    return Boolean(memberActive && memberCode && promo && String(promo.code || '').trim().toUpperCase() === memberCode);
  }

  function resolvePromo(options, baseSubtotal) {
    const promo = options?.promo || null;
    if (!promo || memberCodeStacks(promo, options)) {
      return { code: '', discount: 0, gift: null, freeDelivery: false, definition: null };
    }
    if (promo.min && baseSubtotal < Number(promo.min)) {
      return { code: '', discount: 0, gift: null, freeDelivery: false, definition: null };
    }

    let discount = 0;
    if (promo.type === 'pct') discount = Math.round(baseSubtotal * (Number(promo.value) || 0) / 100);
    else if (promo.type === 'fixed') discount = Math.min(baseSubtotal, Number(promo.value) || 0);

    return {
      code: String(promo.code || '').toUpperCase(),
      discount: Math.max(0, discount),
      gift: promo.type === 'gift' ? (promo.gift || 'Free gift') : null,
      freeDelivery: promo.type === 'freedelivery',
      definition: promo
    };
  }

  function calculate(options) {
    const Cart = requireCart();
    const resolved = resolveOptions(options || {});
    const base = Cart.calculate({
      items: resolved.items,
      meta: {
        membership: resolved.membership,
        fulfilment: resolved.fulfilment,
        minimumOrder: resolved.minimumOrder,
        discount: 0,
        deliveryFee: 0,
        promo: ''
      }
    });

    const promoResult = resolvePromo(resolved, base.subtotal);
    let deliveryFee = 0;
    if (resolved.fulfilment === 'delivery' && !promoResult.freeDelivery && base.subtotal > 0) {
      deliveryFee = resolved.freeDeliveryOver > 0 && base.subtotal - promoResult.discount >= resolved.freeDeliveryOver
        ? 0
        : Math.max(0, resolved.deliveryFee);
    }

    const pricingConfig = {
      ...resolved.pricingConfig,
      deliveryFee: resolved.deliveryFee,
      freeDeliveryOver: resolved.freeDeliveryOver,
      minimumOrder: resolved.minimumOrder,
      memberCode: resolved.memberCode
    };

    Cart.setMeta({
      membership: resolved.membership,
      fulfilment: resolved.fulfilment,
      minimumOrder: resolved.minimumOrder,
      promo: promoResult.code,
      promoDefinition: promoResult.definition,
      discount: promoResult.discount,
      deliveryFee,
      pricingConfig,
      source: resolved.source,
      pricingSnapshot: {
        subtotal: base.subtotal,
        discount: promoResult.discount,
        deliveryFee,
        total: Math.max(0, base.subtotal - promoResult.discount + deliveryFee),
        calculatedAt: Date.now()
      }
    }, false);

    const summary = Cart.calculate({ items: base.items });
    return { ...summary, gift: promoResult.gift, promoDefinition: promoResult.definition };
  }

  function setPromo(code, options) {
    const normalized = String(code || '').trim().toUpperCase();
    const resolved = resolveOptions(options || {});
    if (!normalized) {
      return { ok: true, promo: null, summary: calculate({ ...resolved, promo: null }) };
    }

    const definition = options?.promos?.[normalized];
    if (!definition) return { ok: false, reason: 'invalid', promo: null };

    const promo = { code: normalized, ...definition, manual: true };
    if (memberCodeStacks(promo, resolved)) return { ok: false, reason: 'member-stack', promo: null };

    const base = calculate({ ...resolved, promo: null });
    if (promo.min && base.subtotal < Number(promo.min)) {
      return { ok: false, reason: 'minimum', minimum: Number(promo.min), promo: null };
    }
    return { ok: true, promo, summary: calculate({ ...resolved, promo }) };
  }

  function changeQty(identifier, delta) {
    const Cart = requireCart();
    Cart.updateQty(identifier, delta, { mode: 'delta', minimum: 1, removeBelowMinimum: true });
    return calculate();
  }

  function remove(identifier) {
    const Cart = requireCart();
    Cart.remove(identifier);
    return calculate();
  }

  function renderCheckout(options) {
    const summary = calculate(options || {});
    const root = options?.root || document;
    const countEl = root.querySelector(options?.countSelector || '#itemCount');
    const subtotalEl = root.querySelector(options?.subtotalSelector || '#subtotal');
    const discountRow = root.querySelector(options?.discountRowSelector || '#discountRow');
    const discountEl = root.querySelector(options?.discountSelector || '#discount');
    const deliveryEl = root.querySelector(options?.deliverySelector || '#deliveryFee');
    const totalEl = root.querySelector(options?.totalSelector || '#total');
    const placeButton = root.querySelector(options?.placeButtonSelector || '#placeBtn');

    if (countEl) countEl.textContent = requireCart().count(summary.items) + ' items';
    if (subtotalEl) subtotalEl.textContent = (options?.money || money)(summary.subtotal);
    if (discountRow) discountRow.style.display = summary.discount ? 'flex' : 'none';
    if (discountEl) discountEl.textContent = '−' + (options?.money || money)(summary.discount);
    if (deliveryEl) {
      deliveryEl.textContent = summary.deliveryFee === 0 ? 'FREE' : (options?.money || money)(summary.deliveryFee);
      deliveryEl.classList.toggle('cart-free', summary.deliveryFee === 0);
    }
    if (totalEl) totalEl.textContent = (options?.money || money)(summary.total);
    if (placeButton) placeButton.textContent = 'Place order · ' + (options?.money || money)(summary.total);
    return summary;
  }

  global.CartUI = Object.freeze({
    version: 2,
    calculate,
    setPromo,
    memberCodeStacks,
    changeQty,
    remove,
    renderCheckout,
    money,
    escape: esc
  });
})(window);
