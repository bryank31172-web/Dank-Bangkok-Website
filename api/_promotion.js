import { getJSON } from "./_store.js";

export const normalizePromotionCode = (value) =>
  String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30);

export async function validatePromotion(codeValue, subtotalValue, deliveryFeeValue = 0) {
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

  const type = ["pct", "fixed", "freedelivery", "gift"].includes(stored.type) ? stored.type : "pct";
  const value = Math.max(0, Number(stored.value) || 0);
  const discount = type === "pct"
    ? Math.min(subtotal, Math.round(subtotal * Math.min(100, value) / 100))
    : type === "fixed" ? Math.min(subtotal, value) : 0;
  const finalDeliveryFee = type === "freedelivery" ? 0 : deliveryFee;
  const promotion = { code, type, value, min: minimum, quantity, used, desc: String(stored.desc || "").slice(0, 160), gift: String(stored.gift || "").slice(0, 120) };

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
