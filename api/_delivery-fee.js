/* Delivery fee by road distance from the branch that ships the order.
     up to 3 km      → free
     4th km          → ฿60
     every km after  → +฿15   (5 km = ฿75, 6 km = ฿90, …)
   Distance is rounded to the nearest whole kilometre: .1–.4 rounds down,
   .5–.9 rounds up. So 3.4 km is free and 3.5 km is charged as 4.
   When no distance can be worked out (no route provider, typed address that
   Google cannot place) the order falls back to the old flat ฿100 and is
   flagged so staff can confirm the fee before dispatch.                     */

export const FREE_KM = 3;
export const FIRST_PAID_KM_FEE = 60;
export const PER_KM_FEE = 15;
export const FALLBACK_FEE = 100;

export function billedKmFor(kmValue) {
  if (kmValue == null || kmValue === "") return null;
  const km = Number(kmValue);
  if (!Number.isFinite(km) || km < 0) return null;
  // to one decimal first, so float noise like 3.4999999 cannot tip it over
  return Math.round(Math.round(km * 10) / 10);
}

export function deliveryFeeForKm(kmValue) {
  const billedKm = billedKmFor(kmValue);
  if (billedKm == null) return null;
  if (billedKm <= FREE_KM) return 0;
  return FIRST_PAID_KM_FEE + (billedKm - FREE_KM - 1) * PER_KM_FEE;
}

/* Turns a computeEta() result into the quote the checkout and the order use. */
export function deliveryQuote(eta) {
  const fee = eta?.ok ? deliveryFeeForKm(eta.km) : null;
  if (fee == null) return { ok: false, fee: FALLBACK_FEE, km: null, fallback: true };
  return { ok: true, fee, km: eta.km, billedKm: billedKmFor(eta.km), fallback: false, branch: eta.branch || null };
}
