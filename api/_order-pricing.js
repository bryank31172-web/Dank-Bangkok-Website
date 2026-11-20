/* Server-side pricing for POST /api/order.

   The browser sends a cart with prices in it. Those prices are a suggestion,
   never the truth: this module re-prices every line from the live menu
   (getMenu()) before anything is stored or charged.

   Rules, per line:
   - A line the menu knows (by tier shId, product shId, or product id) costs
     the HIGHER of the browser's unit price and the menu's. An honest order
     therefore never changes; a tampered low price is raised to the real one.
     (Higher, not "the menu's", because the storefront does not show the
     product discount the old guard applied — switching to the discounted
     menu price would silently charge customers less than their cart said.)
   - Member prices are honoured when the order says member: membership is an
     open self-signup on the storefront, so it is a public discount, not a
     secret the server could check.
   - Free bonus lines (buy 3 get 1, first-order gram) cost 0 only up to the
     allowance this module works out itself from the paid lines.
   - A line the menu does not know keeps the browser's price but is marked
     priceUnverified. The order is still taken (cash orders must not fail
     because a feed is stale) but no online payment path will charge it —
     see assertPriceVerified() — and staff are told to check it.
   - Quantities must be whole numbers 1..500. Anything else is a bad request. */

export class OrderInputError extends Error {}

const PROMO_CATS = new Set(["midgrade", "premium", "topshelf", "exotics", "joints", "edibles", "vapes"]);
// Same pattern as the storefront's FLOWER_RE (index.html), so both sides agree on what is flower.
const FLOWER_RE = /^(exotics?|top[\s-]?shelf|premium|mid[\s-]?grade|weed|flowers?|bud|cannabis)\b/i;
const MAX_QTY = 500;

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

/** Grams in one unit of a flower line, from its option label ("3.5g", "½g", "joint"). */
export function gramsPerUnit(category, option) {
  if (!FLOWER_RE.test(String(category || ""))) return 0;
  const label = String(option || "").toLowerCase().replace(/½/g, "0.5");
  const m = label.match(/([\d.]+)\s*g/);
  return m ? parseFloat(m[1]) || 0 : label.includes("joint") ? 1 : 0;
}

/** Buy-3-get-1 units for one line (0 when the line is not in a promo category). */
function promoUnits(category, option, qty) {
  if (!PROMO_CATS.has(String(category || "").trim().toLowerCase())) return 0;
  if (FLOWER_RE.test(String(category || ""))) return gramsPerUnit(category, option) * qty;
  return qty;
}

const nameKey = (v) => String(v || "").trim().toLowerCase();

/* Lookup order: tier/product shId (StoreHub menus) → product id (BRYAN POS
   menus; the storefront sends it) → exact product name, but only when that
   name is unique. Duplicate names (the POS has several "onion ring"s) are
   never guessed between — those lines stay unverified. */
function menuIndex(menu) {
  const byShId = new Map(), byId = new Map(), byName = new Map(), dupNames = new Set();
  for (const p of menu || []) {
    if (p?.id != null) byId.set(String(p.id), p);
    if (p?.shId) byShId.set(String(p.shId), { product: p, tier: null });
    for (const t of p?.priceTiers || []) if (t?.shId) byShId.set(String(t.shId), { product: p, tier: t });
    const k = nameKey(p?.name);
    if (k) { if (byName.has(k)) dupNames.add(k); else byName.set(k, p); }
  }
  for (const k of dupNames) byName.delete(k);
  return { byShId, byId, byName };
}
function resolve(index, it) {
  if (it.shId && index.byShId.has(String(it.shId))) return index.byShId.get(String(it.shId));
  if (it.id != null && it.id !== "" && index.byId.has(String(it.id))) return { product: index.byId.get(String(it.id)), tier: null };
  const byName = index.byName.get(nameKey(it.name));
  return byName ? { product: byName, tier: null } : null;
}

function serverUnitPrice(product, tier, option, member) {
  let t = tier;
  if (!t && Array.isArray(product.priceTiers) && product.priceTiers.length) {
    t = product.priceTiers.find((x) => String(x.label ?? "") === String(option ?? ""));
    if (!t) return null; // an option the menu does not sell
  }
  const base = t ? num(t.price) : num(product.price);
  const mem = t ? num(t.member) : num(product.member);
  let price = member && mem > 0 ? mem : base;
  if (!Number.isFinite(price) || price < 0) return null;
  if (product.discountEnabled === true) {
    const value = Math.max(0, Number(product.discountValue) || 0);
    price = product.discountType === "fixed" ? price - value : price * (1 - Math.min(100, value) / 100);
  }
  return Math.max(0, price);
}

/** Re-price items in place. Returns { subtotal, adjusted, unverified:[{name, reason}] }.
    Throws OrderInputError for malformed input. */
export function priceOrderItems(items, menu, { member = false } = {}) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new OrderInputError("invalid items");
  const index = menuIndex(menu);
  const unverified = [];
  let adjusted = false;

  for (const it of items) {
    if (!it || typeof it !== "object") throw new OrderInputError("invalid item");
    const qty = num(it.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new OrderInputError("invalid quantity");
    it.qty = qty;
    it.name = String(it.name ?? "").slice(0, 160);
    it.option = String(it.option ?? "").slice(0, 80);
    // Prices are never taken from these client fields directly.
    const clientUnit = Number.isFinite(num(it.price)) ? Math.max(0, num(it.price))
      : Number.isFinite(num(it.lineTotal)) ? Math.max(0, num(it.lineTotal)) / qty : 0;
    delete it.unitPrice;
    delete it.priceUnverified;
    it.bonus = it.bonus === true;
    if (it.bonus) continue; // priced after the allowance is known

    const hit = resolve(index, it);
    const product = hit?.product;
    const server = product ? serverUnitPrice(product, hit.tier, it.option, member) : null;
    if (product) {
      // Enrichment the staff console and reports rely on (was inline in order.js).
      it.effects = Array.isArray(product.effects) ? product.effects.slice(0, 6).map((e) => String(e).trim()).filter(Boolean) : [];
      it.strainType = String(product.type || "").trim();
      it.category = String(product.category || it.category || "").trim();
      const grams = String(it.option || "").match(/(\d+(?:\.\d+)?)\s*g\b/i);
      if (grams) { it.grams = Number(grams[1]); it.totalGrams = it.grams * qty; }
    } else {
      it.category = String(it.category || "").slice(0, 60);
    }
    if (server == null) {
      it.priceUnverified = true;
      unverified.push({ name: it.name, reason: product ? "option not on the menu" : "product not on the menu" });
      it.unitPrice = round2(clientUnit);
    } else {
      if (server > clientUnit + 0.5) adjusted = true;
      it.unitPrice = round2(Math.max(clientUnit, server));
    }
    it.price = it.unitPrice;
    it.lineTotal = Math.round(it.unitPrice * qty);
  }

  // Free-unit allowance, worked out from the paid lines the same way the storefront does.
  const groups = new Map();
  let flowerGrams = 0;
  for (const it of items) {
    if (it.bonus) continue;
    flowerGrams += gramsPerUnit(it.category, it.option) * it.qty;
    const units = promoUnits(it.category, it.option, it.qty);
    const perOne = promoUnits(it.category, it.option, 1);
    if (units <= 0 || perOne <= 0 || it.unitPrice <= 0) continue;
    const key = `${String(it.category).trim().toLowerCase()}|${round2(it.unitPrice / perOne)}`;
    groups.set(key, (groups.get(key) || 0) + units);
  }
  let ladder = 0;
  for (const units of groups.values()) ladder += Math.floor(units / 3 + 1e-9);
  const allowance = ladder + (ladder === 0 && flowerGrams >= 1 ? 1 : 0);
  const bonusQty = items.filter((it) => it.bonus).reduce((t, it) => t + it.qty, 0);
  for (const it of items) {
    if (!it.bonus) continue;
    it.unitPrice = 0; it.price = 0; it.lineTotal = 0;
    if (bonusQty > allowance) {
      it.priceUnverified = true;
      unverified.push({ name: it.name, reason: `free items exceed the ${allowance} earned` });
    }
  }

  const subtotal = Math.round(items.reduce((t, it) => t + it.lineTotal, 0));
  return { subtotal, adjusted, unverified };
}

/** Guard for every path that takes money automatically (card, PromptPay,
    2C2P, GB Prime Pay, wallet). Returns true when the order may be charged;
    otherwise writes a 409 and returns false. */
export function assertPriceVerified(order, res) {
  if (!order?.priceUnverified) return true;
  res.status(409).json({
    error: "price_unverified",
    message: "Some items in this order could not be priced automatically. Staff will confirm the total — please pay on pickup or delivery.",
  });
  return false;
}
