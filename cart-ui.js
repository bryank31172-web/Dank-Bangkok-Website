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
    const amount = Number(value) || 0;
    return '฿' + Math.round(amount).toLocaleString('en-US');
  }

  function memberCodeStacks(promo, options) {
    const memberActive = Boolean(options?.membership?.active);
    const memberCode = String(options?.memberCode || '').trim().toUpperCase();
    return Boolean(memberActive && memberCode && promo &&
      String(promo.code || '').trim().toUpperCase() === memberCode);
  }

  function resolvePromo(options, baseSubtotal) {
    const promo = options?.promo || null;
    if (!promo || memberCodeStacks(promo, options)) return { code: '', discount: 0, gift: null, freeDelivery: false };
    if (promo.min && baseSubtotal < Number(promo.min)) return { code: '', discount: 0, gift: null, freeDelivery: false };

    let discount = 0;
    if (promo.type === 'pct') discount = Math.round(baseSubtotal * (Number(promo.value) || 0) / 100);
    if (promo.type === 'fixed') discount = Math.min(baseSubtotal, Number(promo.value) || 0);

    return {
      code: String(promo.code || '').toUpperCase(),
      discount: Math.max(0, discount),
      gift: promo.type === 'gift' ? (promo.gift || 'Free gift') : null,
      freeDelivery: promo.type === 'freedelivery'
    };
  }

  function calculate(options) {
    const Cart = requireCart();
    const membership = options?.membership || null;
    const fulfilment = options?.fulfilment || 'delivery';
    const minimumOrder = Math.max(0, Number(options?.minimumOrder) || 0);

    const base = Cart.calculate({
      items: options?.items || Cart.getItems(),
      meta: { membership, fulfilment, minimumOrder, discount: 0, deliveryFee: 0, promo: '' }
    });

    const promoResult = resolvePromo(options, base.subtotal);
    let deliveryFee = 0;
    if (fulfilment === 'delivery' && !promoResult.freeDelivery && base.subtotal > 0) {
      const freeOver = Math.max(0, Number(options?.freeDeliveryOver) || 0);
      deliveryFee = base.subtotal - promoResult.discount >= freeOver
        ? 0
        : Math.max(0, Number(options?.deliveryFee) || 0);
    }

    Cart.setMeta({
      membership,
      fulfilment,
      minimumOrder,
      promo: promoResult.code,
      discount: promoResult.discount,
      deliveryFee,
      source: options?.source || 'cart-ui'
    }, false);

    const summary = Cart.calculate({ items: base.items });
    return { ...summary, gift: promoResult.gift, promoDefinition: options?.promo || null };
  }

  function setPromo(code, options) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return { ok: true, promo: null, summary: calculate({ ...options, promo: null }) };

    const definition = options?.promos?.[normalized];
    if (!definition) return { ok: false, reason: 'invalid', promo: null };

    const promo = { code: normalized, ...definition, manual: true };
    if (memberCodeStacks(promo, options)) return { ok: false, reason: 'member-stack', promo: null };

    const base = calculate({ ...options, promo: null });
    if (promo.min && base.subtotal < Number(promo.min)) {
      return { ok: false, reason: 'minimum', minimum: Number(promo.min), promo: null };
    }
    return { ok: true, promo, summary: calculate({ ...options, promo }) };
  }

  function changeQty(identifier, delta) {
    return requireCart().updateQty(identifier, delta, { mode: 'delta', minimum: 1, removeBelowMinimum: true });
  }

  function remove(identifier) {
    return requireCart().remove(identifier);
  }

  function lineHtml(item, index, options) {
    const image = typeof options?.imageHtml === 'function'
      ? options.imageHtml(item)
      : item.image ? '<img src="' + esc(item.image) + '" alt="">' : '<div class="ph">🌿</div>';
    const unit = Number(item.appliedPrice ?? item.price) || 0;

    if (item.bonus) {
      return '<div class="cart-line bonus"><div class="ci-thumb">' + image + '</div>' +
        '<div class="ci-main"><h4>' + esc(item.name) + ' <span class="gift-badge">FREE</span></h4>' +
        '<div class="ci-opt">Volume deal · ' + esc(item.tierLabel) + '</div>' +
        '<div class="ci-row"><span style="font-size:12px;color:var(--green2)">🌿 On the house</span>' +
        '<div class="ci-price">฿0</div></div></div></div>';
    }

    return '<div class="cart-line" data-cart-index="' + index + '"><div class="ci-thumb">' + image + '</div>' +
      '<div class="ci-main"><h4>' + esc(item.name) + '</h4><div class="ci-opt">' + esc(item.tierLabel) + ' · ' + (options?.money || money)(unit) + '</div>' +
      '<div class="ci-row"><div class="qty"><button type="button" data-cart-action="decrease" data-cart-index="' + index + '">−</button>' +
      '<span>' + (Number(item.qty) || 1) + '</span><button type="button" data-cart-action="increase" data-cart-index="' + index + '">+</button></div>' +
      '<div style="text-align:right"><div class="ci-price">' + (options?.money || money)(unit * (Number(item.qty) || 1)) + '</div>' +
      '<button type="button" class="ci-remove" data-cart-action="remove" data-cart-index="' + index + '">Remove</button></div></div></div></div>';
  }

  function bindDrawerActions(body, options) {
    if (!body || body.dataset.cartUiBound === '1') return;
    body.dataset.cartUiBound = '1';
    body.addEventListener('click', function (event) {
      const button = event.target.closest('[data-cart-action]');
      if (!button) return;
      const index = Number(button.dataset.cartIndex);
      const item = requireCart().getItems()[index];
      if (!item) return;
      const action = button.dataset.cartAction;
      if (action === 'increase') changeQty(item.key, 1);
      if (action === 'decrease') changeQty(item.key, -1);
      if (action === 'remove') remove(item.key);
      if (typeof options?.onChange === 'function') options.onChange(requireCart().getItems());
    });
  }

  function renderDrawer(options) {
    const summary = calculate(options);
    const body = typeof options.body === 'string' ? document.querySelector(options.body) : options.body;
    const foot = typeof options.foot === 'string' ? document.querySelector(options.foot) : options.foot;
    if (!body || !foot) return summary;

    bindDrawerActions(body, options);

    if (!summary.items.length) {
      body.innerHTML = options.emptyHtml || '<div class="empty">Your cart is empty.</div>';
      foot.innerHTML = '';
      return summary;
    }

    body.innerHTML = summary.items.map(function (item, index) {
      return lineHtml(item, index, options);
    }).join('') + (typeof options.extraBodyHtml === 'function' ? options.extraBodyHtml(summary) : '');

    const m = options.money || money;
    const promo = options.promo || null;
    const promoControls = options.showPromo === false ? '' :
      '<div class="promo-row"><input id="' + esc(options.promoInputId || 'promoInput') + '" placeholder="Promo code" value="' + esc(promo?.code || '') + '">' +
      '<button type="button" class="promo-btn" data-cart-promo-action="' + (promo ? 'remove' : 'apply') + '">' + (promo ? 'Remove' : 'Apply') + '</button></div>';

    foot.innerHTML = promoControls +
      '<div class="cart-total-row"><span>Subtotal' + (options?.membership?.active ? ' (member ⭐)' : '') + '</span><span>' + m(summary.subtotal) + '</span></div>' +
      (summary.discount > 0 ? '<div class="cart-total-row" style="color:var(--gold)"><span>Discount (' + esc(summary.promo) + ')</span><span>−' + m(summary.discount) + '</span></div>' : '') +
      (summary.gift ? '<div class="cart-total-row" style="color:var(--gold)"><span>🚬 ' + esc(summary.gift) + '</span><span>FREE</span></div>' : '') +
      '<div class="cart-total-row"><span>Delivery</span><span>' + (summary.fulfilment === 'pickup' ? 'Pickup' : summary.deliveryFee === 0 ? 'Free' : m(summary.deliveryFee)) + '</span></div>' +
      '<div class="cart-total-row grand"><span>Total</span><span>' + m(summary.total) + '</span></div>' +
      (summary.shortfall > 0 ? '<div class="minorder">Minimum order ' + m(summary.minimumOrder) + ' — add ' + m(summary.shortfall) + ' more</div>' : '') +
      (typeof options.extraFooterHtml === 'function' ? options.extraFooterHtml(summary) : '') +
      '<button type="button" class="btn btn-primary btn-block" data-cart-checkout style="margin-top:12px' + (summary.shortfall > 0 ? ';opacity:.5;pointer-events:none' : '') + '">Checkout · ' + m(summary.total) + '</button>';

    if (options.showPromo !== false && foot.dataset.cartUiPromoBound !== '1') {
      foot.dataset.cartUiPromoBound = '1';
      foot.addEventListener('click', function (event) {
        const promoButton = event.target.closest('[data-cart-promo-action]');
        if (promoButton) {
          const action = promoButton.dataset.cartPromoAction;
          if (action === 'remove') {
            if (typeof options.onPromoRemove === 'function') options.onPromoRemove();
          } else if (typeof options.onPromoApply === 'function') {
            const input = foot.querySelector('#' + CSS.escape(options.promoInputId || 'promoInput'));
            options.onPromoApply(input ? input.value : '');
          }
          return;
        }
        const checkout = event.target.closest('[data-cart-checkout]');
        if (checkout && typeof options.onCheckout === 'function') options.onCheckout(summary);
      });
    }
    return summary;
  }

  function renderCheckout(options) {
    const summary = calculate(options);
    const root = options?.root || document;
    const itemsEl = root.querySelector(options?.itemsSelector || '#cartItems');
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

    if (itemsEl && typeof options?.itemHtml === 'function') {
      itemsEl.innerHTML = summary.items.length ? summary.items.map(options.itemHtml).join('') : (options.emptyHtml || '<div class="cart-empty">Your cart is empty.</div>');
    }
    return summary;
  }

  global.CartUI = Object.freeze({
    version: 1,
    calculate,
    setPromo,
    memberCodeStacks,
    changeQty,
    remove,
    renderDrawer,
    renderCheckout,
    money,
    escape: esc
  });
})(window);
