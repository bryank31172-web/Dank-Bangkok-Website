/* Covers the two additions made to api/_promotion.js for
   docs/dank-backoffice/BACKOFFICE_REQUIREMENTS.md's Module I gap:
   applicable-categories restriction (backward compatible — must never affect
   a caller that doesn't pass cartCategories) and redemption history. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePromotion, recordPromotionRedemption, listPromotionRedemptions } from '../api/_promotion.js';
import { setJSON } from '../api/_store.js';

async function seedPromo(code, promo) {
  await setJSON('admin:overrides', { promos: { [code]: { active: true, type: 'fixed', value: 50, min: 0, ...promo } } });
}

test('a promo with no categories set applies regardless of what cartCategories says', async () => {
  await seedPromo('NOCATS', {});
  const r = await validatePromotion('NOCATS', 500, 0, ['Beer']);
  assert.equal(r.ok, true);
});

test('a category-restricted promo is rejected when the cart has none of the allowed categories', async () => {
  await seedPromo('WEEDONLY', { categories: ['Weed', 'Vapes'] });
  const miss = await validatePromotion('WEEDONLY', 500, 0, ['Beer', 'Accessories']);
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'category');
  const hit = await validatePromotion('WEEDONLY', 500, 0, ['Beer', 'Weed']);
  assert.equal(hit.ok, true);
});

test('a category-restricted promo is NOT enforced when the caller omits cartCategories — backward compatible with the existing public endpoint', async () => {
  await seedPromo('WEEDONLY2', { categories: ['Weed'] });
  const r = await validatePromotion('WEEDONLY2', 500, 0); // 4th arg omitted, exactly like api/promotion.js's call today
  assert.equal(r.ok, true, 'omitting cartCategories must behave exactly as before this field existed');
});

test('promotion redemptions are recorded and filterable by code', async () => {
  const code = 'HIST' + Date.now();
  await recordPromotionRedemption({ code, orderId: 'order-a', discount: 50, phone: '0812345678', at: Date.now() });
  await recordPromotionRedemption({ code, orderId: 'order-b', discount: 50, phone: '0899999999', at: Date.now() });
  await recordPromotionRedemption({ code: 'OTHER' + Date.now(), orderId: 'order-c', discount: 10 });

  const rows = await listPromotionRedemptions({ code });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.code === code));
  assert.deepEqual(rows.map((r) => r.orderId).sort(), ['order-a', 'order-b']);
});
