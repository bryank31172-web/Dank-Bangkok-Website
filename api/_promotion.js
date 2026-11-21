import { getJSON, setJSON, indexAdd, indexList } from "./_store.js";

export const normalizePromotionCode = (value) =>
  String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30);

/* Redemption history — docs/dank-backoffice/BACKOFFICE_REQUIREMENTS.md's
   Module I gap ("redemption history" wasn't tracked, only a bare use-count).
   Reuses _store.js's existing indexAdd/getJSON pattern rather than a new
   table, same shape as every other list in this codebase (orders:index,
   tabs:phones, …). Called from api/order.js right after an order with a
   promo code saves; never called from here, since this file only validates. */
const REDEMPTIONS_INDEX = "promotion:redemptions:index";
const YEAR = 60 * 60 * 24 * 365;
export async function recordPromotionRedemption({ code, orderId, discount, phone, at }) {
  const id = String(orderId || Date.now());
  await setJSON("promotion:redemption:" + id, {
    code: normalizePromotionCode(code), orderId: id, discount: Math.round(Number(discount) || 0),
    phone: String(phone || ""), at: Number(at) || Date.now(),
  }, YEAR * 10);
  await indexAdd(id, REDEMPTIONS_INDEX);
}
export async function listPromotionRedemptions({ code, limit = 200 } = {}) {
  const ids = await indexList(REDEMPTIONS_INDEX);
  const out = [];
  for (const id of ids) {
    if (out.length >= (code ? 2000 : limit)) break; // read deeper when filtering to one code
    const r = await getJSON("promotion:redemption:" + id);
    if (!r) continue;
    if (code && r.code !== normalizePromotionCode(code)) continue;
    out.push(r);
    if (!code && out.length >= limit) break;
  }
  return code ? out.slice(0, limit) : out;
}

/* `cartCategories` is optional and backward compatible: omit it (as the
   public /api/promotion endpoint still does) and category restriction simply
   never applies, exactly like before this field existed. A category list is
   only enforced when a caller explicitly passes one — e.g. a future
   checkout-side check — so nothing already relying on this function changes
   behavior by default. */
export async function validatePromotion(codeValue, subtotalValue, deliveryFeeValue = 0, cartCategories = null) {
  const code = normalizePromotionCode(codeValue);
  const subtotal = Math.max(0, Number(subtotalValue) || 0);
  const deliveryFee = Math.max(0, Number(deliveryFeeValue) || 0);
  if (!code) return { ok: false, reason: "empty", code, subtotal, discount: 0, deliveryFee };

  const overrides = (await getJSON("admin:overrides")) || {};
  const savedCoupon = await getJSON("coupon:" + code);
  const stored = (overrides.promos && typeof overrides.promos === "object" ? overrides.promos[code] : null) || savedCoupon;
  if (!stored || stored.active === false) return { ok: false, reason: "invalid", code };

  const now = Date.now();
  if (stored.startsAt && now < Number(stored.startsAt)) return { ok: false, reason: "not-started", code };
  if (stored.expiresAt && now > Number(stored.expiresAt)) return { ok: false, reason: "expired", code };

  const quantity = Math.max(0, Math.floor(Number(stored.quantity) || 0));
  const used = Math.max(0, Number(await getJSON("promotion:uses:" + code)) || 0);
  if (quantity > 0 && used >= quantity) {
    return { ok: false, reason: "quantity-exhausted", code, quantity, used };
  }

  const minimum = Math.max(0, Number(stored.min) || 0);
  if (subtotal < minimum) return { ok: false, reason: "minimum", code, minimum };

  /* Applicable categories — only enforced when BOTH the promo defines a
     restriction AND the caller passed what's actually in the cart. A promo
     with no `categories` set still applies to everything, same as today. */
  const categories = Array.isArray(stored.categories) ? stored.categories.map(String) : [];
  if (categories.length && Array.isArray(cartCategories)) {
    const matches = cartCategories.some((c) => categories.includes(String(c)));
    if (!matches) return { ok: false, reason: "category", code, categories };
  }

  const type = ["pct", "fixed", "freedelivery", "gift"].includes(stored.type) ? stored.type : "pct";
  const value = Math.max(0, Number(stored.value) || 0);
  const discount = type === "pct"
    ? Math.min(subtotal, Math.round(subtotal * Math.min(100, value) / 100))
    : type === "fixed" ? Math.min(subtotal, value) : 0;
  const finalDeliveryFee = type === "freedelivery" ? 0 : deliveryFee;
  const promotion = { code, type, value, min: minimum, quantity, used, categories, desc: String(stored.desc || "").slice(0, 160), gift: String(stored.gift || "").slice(0, 120) };

  return {
    ok: true,
    code,
    promotion,
    subtotal,
    discount,
    deliveryFee: finalDeliveryFee,
    total: Math.max(0, subtotal - discount + finalDeliveryFee),
  };
}
