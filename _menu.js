/* ============================================================
   Shared menu source — the single place every menu read goes through.
   Priority of data sources:
     1. MENU_FEED_URL   — any backend / BackStore web app that returns the
        product JSON array (set this to your BackOffice/BRYAN POS feed URL).
     2. StoreHub API     — via _storehub.js (STOREHUB_STORE + STOREHUB_TOKEN).
     3. products.json    — bundled fallback so the site always works.

   Results are cached in the shared store (Redis when configured) for
   MENU_TTL_SECONDS (default 30s) so many visitors + background pollers
   cause at most ~1 upstream fetch per interval. A content "rev" hash over
   id|stock|price lets the storefront cheaply detect changes and refresh —
   giving near-real-time stock/price without re-sending the whole menu.
   The webhook (api/storehub-webhook.js) deletes menu:cache to force an
   instant refresh on the next read.
   ============================================================ */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getJSON, setJSON } from "./_store.js";
import { shConfigured, fetchStoreHubProducts } from "./_storehub.js";

const TTL = Number(process.env.MENU_TTL_SECONDS || 30) * 1000;
const FEED = process.env.MENU_FEED_URL || "";

/* ---- BRYAN POS live feed (dank-medical-pos-app) --------------------------
   The storefront pulls its catalog from the POS app the moment the POS
   serves a product list as JSON at any of these paths. Configure with:
     POS_APP_URL     – base URL of the POS (default below)
     POS_FEED_PATHS  – comma-separated candidate JSON paths to try
   If the POS serves no JSON list yet, this quietly backs off and the next
   source (StoreHub / bundled / owner edits) takes over.                    */
const POS_BASE = (process.env.POS_APP_URL || "https://dank-medical-pos-app.vercel.app").replace(/\/+$/, "");
const POS_PATHS = (process.env.POS_FEED_PATHS ||
  "/api/products,/api/menu,/api/catalog,/api/inventory,/api/items,/api/public/products,/api/menu.json,/products.json,/menu.json,/data/products.json"
).split(",").map((s) => s.trim()).filter(Boolean);
let posNeg = 0; // skip POS probing until this timestamp after a total miss

function posNum(v) {
  if (v === undefined || v === null) return undefined;
  const cleaned = String(v).replace(/[^0-9.]/g, "");
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return isFinite(n) ? n : undefined;
}
function normItem(x, i) {
  if (!x || typeof x !== "object") return null;
  const name = x.name ?? x.title ?? x.productName ?? x.product_name ?? "";
  if (!name) return null;
  const id = String(x.id ?? x.sku ?? x._id ?? x.productId ?? x.code ?? "pos-" + i);
  let stock = x.stock ?? x.quantity ?? x.qty ?? x.inventory ?? x.available ?? x.onHand;
  if (typeof stock === "boolean") stock = stock ? 99 : 0;
  stock = posNum(stock); if (stock === undefined) stock = 99;
  const out = {
    id, name: String(name),
    category: String(x.category ?? x.categoryName ?? x.category_name ?? x.group ?? "Specials"),
    type: String(x.strainType ?? x.strain_type ?? x.type ?? x.variety ?? "Hybrid"),
    thc: posNum(x.thc) ?? 0,
    thcLabel: String(x.thcLabel ?? x.thc_label ?? (x.thc != null ? x.thc + "%" : "")),
    cbd: posNum(x.cbd) ?? 0,
    stock, unit: String(x.unit ?? "each"),
    image: String(x.image ?? x.img ?? x.photo ?? x.imageUrl ?? x.image_url ?? x.picture ?? ""),
    description: String(x.description ?? x.desc ?? x.details ?? ""),
    effects: Array.isArray(x.effects) ? x.effects : [],
    flavors: Array.isArray(x.flavors) ? x.flavors : [],
  };
  const price = posNum(x.price ?? x.salePrice ?? x.sale_price ?? x.unitPrice ?? x.unit_price ?? x.retailPrice);
  const member = posNum(x.member ?? x.memberPrice ?? x.member_price ?? x.wholesale);
  if (Array.isArray(x.priceTiers) && x.priceTiers.length) {
    out.priceTiers = x.priceTiers
      .map((t) => ({ label: String(t.label ?? t.size ?? ""), price: posNum(t.price) ?? 0, member: posNum(t.member ?? t.memberPrice) ?? posNum(t.price) ?? 0 }))
      .filter((t) => t.label);
  } else {
    out.price = price ?? 0;
    out.member = member ?? price ?? 0;
  }
  return out;
}
function normalizePOS(j) {
  const arr = Array.isArray(j) ? j : (j && (j.products || j.items || j.data || j.menu || j.catalog)) || [];
  if (!Array.isArray(arr) || !arr.length) return [];
  return arr.map(normItem).filter(Boolean);
}
async function fetchPOS() {
  if (!POS_BASE) return null;
  const now = Date.now();
  if (now < posNeg) return null;
  const tryOne = async (path) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    try {
      const r = await fetch(POS_BASE + path, { headers: { Accept: "application/json" }, signal: ctl.signal });
      if (!r.ok) return null;
      if (!/json/i.test(r.headers.get("content-type") || "")) return null; // HTML shell ≠ feed
      const items = normalizePOS(await r.json());
      return items.length ? items : null;
    } catch (e) { return null; } finally { clearTimeout(timer); }
  };
  const results = await Promise.all(POS_PATHS.map(tryOne));
  const hit = results.find(Boolean);
  if (hit) return hit;
  posNeg = now + 5 * 60 * 1000; // nothing served → back off 5 min
  return null;
}

function revOf(data) {
  // Hash the fields that matter for "did the menu change": stock + price.
  const s = data
    .map((p) => `${p.id}:${p.stock}:${p.price ?? p.priceTiers?.[0]?.price ?? ""}`)
    .join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const POS_FEED_MAX_AGE = Number(process.env.POS_FEED_MAX_AGE_H || 72) * 3600 * 1000;

async function fetchUpstream() {
  // 0) BRYAN POS push-feed (api/pos-feed.js) — the POS pushes its live
  //    catalog here; freshest source of truth for stock and prices.
  try {
    const rec = await getJSON("pos:feed");
    if (rec && Array.isArray(rec.products) && rec.products.length &&
        Date.now() - rec.at < POS_FEED_MAX_AGE) {
      return { data: rec.products, source: "pos" };
    }
  } catch (e) { console.error("pos:feed read failed:", e.message); }
  // 1) generic backstore feed
  if (FEED) {
    try {
      const r = await fetch(FEED, { headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        const arr = Array.isArray(j) ? j : j.products || j.data || [];
        if (arr.length) return { data: arr, source: "feed" };
      }
    } catch (e) { console.error("MENU_FEED_URL failed:", e.message); }
  }
  // 1b) BRYAN POS app feed (dank-medical-pos-app) — live products/stock/prices
  try {
    const pos = await fetchPOS();
    if (pos && pos.length) return { data: pos, source: "pos" };
  } catch (e) { console.error("POS fetch failed:", e.message); }
  // 2) StoreHub
  if (shConfigured()) {
    try {
      const d = await fetchStoreHubProducts();
      if (d.length) return { data: d, source: "storehub" };
    } catch (e) { console.error("StoreHub fetch failed:", e.message); }
  }
  // 3) bundled
  try {
    const raw = await readFile(join(process.cwd(), "products.json"), "utf8");
    return { data: JSON.parse(raw), source: "bundled" };
  } catch (e) {
    return { data: [], source: "empty" };
  }
}

/* Owner edits from /api/admin — merged over every source so manual price/stock/
   product/promo changes stick regardless of where the menu comes from.
   Hidden products are only FLAGGED (_hidden) — the storefront hides them from
   customers while the logged-in owner can still see and un-hide them. */
async function applyOverrides(data) {
  try {
    const ov = await getJSON("admin:overrides");
    if (!ov) return data;
    let out = data.map((p) => (ov.products && ov.products[p.id] ? { ...p, ...ov.products[p.id] } : p));
    if (Array.isArray(ov.added) && ov.added.length) {
      const have = new Set(out.map((p) => p.id));
      out = out.concat(ov.added.filter((p) => p && p.id && !have.has(p.id)));
    }
    return out;
  } catch (e) { return data; }
}

export async function getMenu(force = false) {
  const now = Date.now();
  const cached = await getJSON("menu:cache");
  if (!force && cached && now - cached.at < TTL) return cached;

  let { data, source } = await fetchUpstream();
  data = await applyOverrides(data);
  const rev = revOf(data);
  const changedAt = cached && cached.rev === rev ? cached.changedAt : now;
  const rec = { data, rev, source, at: now, changedAt };
  try { await setJSON("menu:cache", rec, 60 * 60 * 24); } catch (e) {}
  return rec;
}

export async function bustMenu() {
  try { await setJSON("menu:cache", null, 1); } catch (e) {}
}
