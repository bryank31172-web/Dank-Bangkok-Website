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
import { posSyncKey } from "./_auth.js";

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

/* The POS writes the category into the product NAME: "( Bar ) Tequila shot",
   "( Beer ) Crispy Boy lager Can", "( Edible) Devours Nano Gummies 500mg".
   Left alone every card on the site reads "( Bar ) Tequila shot", and the
   food page has no category to filter on. Split the leading bracket off and
   use it as the category.

   Only the LEADING group is touched, and only when it is short enough to be a
   category word: "( Equipment ) Bong XL ( 50 cm" keeps its stray bracket, and
   a name that is nothing but a bracket is left alone rather than emptied. */
const NAME_CAT_RE = /^\s*[(\uFF08]\s*([^)\uFF09]{1,24}?)\s*[)\uFF09]\s*/;
function splitNameCat(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(NAME_CAT_RE);
  if (!m) return { name: s, cat: "" };
  const rest = s.slice(m[0].length).trim();
  if (!rest) return { name: s, cat: "" };
  return { name: rest, cat: m[1].trim() };
}

function posNum(v) {
  if (v === undefined || v === null) return undefined;
  const cleaned = String(v).replace(/[^0-9.]/g, "");
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return isFinite(n) ? n : undefined;
}

/* Preserve real commerce variants when an upstream catalogue supplies them.
   The current DANK POS feed is flat, so this is a backwards-compatible pass-
   through rather than a database migration. SEO schema may use these fields
   only when the values genuinely exist. */
function normalizeVariant(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const price = posNum(raw.price ?? raw.salePrice ?? raw.sale_price);
  const stock = posNum(raw.stock ?? raw.quantity ?? raw.qty ?? raw.inventory ?? raw.onHand);
  const images = (Array.isArray(raw.images) ? raw.images : [raw.image ?? raw.imageUrl ?? raw.image_url])
    .filter(Boolean).map(String);
  const variant = {
    id: String(raw.id ?? raw._id ?? raw.sku ?? `variant-${index + 1}`),
    name: String(raw.name ?? raw.title ?? ""),
    slug: String(raw.slug ?? ""),
    sku: String(raw.sku ?? ""),
    color: String(raw.color ?? raw.attributes?.color ?? ""),
    colorCode: String(raw.colorCode ?? raw.color_code ?? ""),
    size: String(raw.size ?? raw.attributes?.size ?? ""),
    material: String(raw.material ?? raw.attributes?.material ?? ""),
    price: price === undefined ? undefined : Math.round(price),
    stock,
    image: images[0] || "",
    images,
  };
  const meaningful = variant.name || variant.sku || variant.color || variant.size || variant.material ||
    variant.image || variant.price !== undefined || variant.stock !== undefined;
  return meaningful ? variant : null;
}
/* Bookkeeping lines. The till keeps its tender types and account adjustments
   in the same product list as the stock - "Delivery", "Visa", "TF to Cash",
   "Pay In Advance", "pay old bill" - and they arrived on the storefront as
   ฿0 HYBRID cards a customer could try to add to a basket.

   Matched on whole words, never substrings: the shop sells Papaya Fuel,
   Payload OG, Paydirt, Cash Crop and Purple Payback, and a naive /pay|cash/
   would have deleted all five. */
const LEDGER_EXACT = /^(delivery|deposit|visa|mastercard|master ?card|credit ?card|debit ?card|cash|change|tip|tips|discount|refund|void|test|misc|service ?charge|vat|tax|promptpay|qr|bank ?transfer|transfer|wallet|top ?up|topup)$/i;
const LEDGER_PHRASE = /^(pay|paid|tf|transfer|settle|charge|adjust)\b|(\bold bill\b|\bin advance\b|\bto cash\b|\bon account\b)/i;
function isLedgerLine(n) {
  const s = String(n ?? "").trim();
  return LEDGER_EXACT.test(s) || LEDGER_PHRASE.test(s);
}

const GENERIC_CAT = /^(specials?|general|other|misc|uncategori[sz]ed|none|n\/a|-|default)$/i;
function pickCat(candidates, fromName) {
  const feed = candidates.map((v) => String(v ?? "").trim()).find(Boolean) || "";
  const named = String(fromName ?? "").trim();
  if (feed && !GENERIC_CAT.test(feed)) return feed;
  return named || feed || "Specials";
}

/* A strain type is a fact about flower. The POS carries one type field for
   every product and the website defaulted it to "Hybrid", which stamped a
   green HYBRID badge on onion rings, lighters, beer and t-shirts. Only
   flower-shaped categories get the default; everywhere else an absent type
   stays absent, and the card shows the category instead. */
const STRAIN_CAT = /\b(exotics?|top\s?shelf|mid\s?grade|flowers?|buds?|pre[\s-]?rolls?|joints?|shake|smalls?|hash|rosin|concentrates?|indoor|outdoor|greenhouse)\b/i;

export function strainType(raw, category) {
  const v = String(raw == null ? "" : raw).trim();
  /* A bare "Hybrid" is the POS's own default for every product it holds, so it
     is not evidence of anything — that is how the badge reached the onion
     rings in the first place. Naming indica or sativa is a real answer,
     including a compound one like "Indica-dominant Hybrid", and is kept
     whatever the category says. */
  if (/\b(indica|sativa)\b/i.test(v)) return v;
  return STRAIN_CAT.test(String(category || "")) ? "Hybrid" : "";
}

function normItem(x, i) {
  if (!x || typeof x !== "object") return null;
  const rawName = x.name ?? x.title ?? x.productName ?? x.product_name ?? "";
  if (!rawName) return null;
  const nc = splitNameCat(rawName);
  const name = nc.name;
  if (isLedgerLine(name)) return null;
  const id = String(x.id ?? x.sku ?? x._id ?? x.productId ?? x.code ?? "pos-" + i);
  let stock = x.stock ?? x.quantity ?? x.qty ?? x.inventory ?? x.available ?? x.onHand;
  if (typeof stock === "boolean") stock = stock ? 99 : 0;
  stock = posNum(stock); if (stock === undefined) stock = 99;
  const category = pickCat([x.category, x.categoryName, x.category_name, x.group], nc.cat);
  const out = {
    id, name: String(name),
    slug: String(x.slug ?? ""),
    sku: String(x.sku ?? ""),
    productGroupID: String(x.productGroupID ?? x.product_group_id ?? x.parentId ?? x.parent_id ?? ""),
    /* ?? is the wrong operator here: the POS sends category:"" rather than
       omitting it, and an empty string is not null, so it sailed through and
       every product arrived uncategorised. Take the first non-blank value,
       and let the bracket the shop typed into the name beat a placeholder
       category - "Specials" on all 393 products is not a taxonomy. */
    category,
    type: strainType(x.strainType ?? x.strain_type ?? x.type ?? x.variety, category),
    thc: posNum(x.thc) ?? 0,
    thcLabel: String(x.thcLabel ?? x.thc_label ?? (x.thc != null ? x.thc + "%" : "")),
    cbd: posNum(x.cbd) ?? 0,
    stock, unit: String(x.unit ?? "each"),
    image: String(x.image ?? x.img ?? x.photo ?? x.imageUrl ?? x.image_url ?? x.picture ?? ""),
    description: String(x.description ?? x.desc ?? x.details ?? ""),
    effects: Array.isArray(x.effects) ? x.effects : [],
    flavors: Array.isArray(x.flavors) ? x.flavors : [],
    attributes: x.attributes && typeof x.attributes === "object" ? x.attributes : {},
    variants: Array.isArray(x.variants) ? x.variants.map(normalizeVariant).filter(Boolean) : [],
  };
  /* Same rounding as api/pos-feed.js, for the sources that do not go through
     it (MENU_FEED_URL, a POS serving its own JSON, StoreHub). A net price with
     VAT applied arithmetically arrives as 140.187 and would be printed that
     way on a menu card. */
  const bahtOf = (v) => { const n = posNum(v); return n === undefined ? undefined : Math.round(n); };
  const price = bahtOf(x.price ?? x.salePrice ?? x.sale_price ?? x.unitPrice ?? x.unit_price ?? x.retailPrice);
  const member = bahtOf(x.member ?? x.memberPrice ?? x.member_price ?? x.wholesale);
  if (Array.isArray(x.priceTiers) && x.priceTiers.length) {
    out.priceTiers = x.priceTiers
      .map((t) => ({ label: String(t.label ?? t.size ?? ""), price: bahtOf(t.price) ?? 0, member: bahtOf(t.member ?? t.memberPrice) ?? bahtOf(t.price) ?? 0 }))
      .filter((t) => t.label);
  } else {
    out.price = price ?? 0;
    out.member = member ?? price ?? 0;
  }
  /* Same rule as the push path: no positive price anywhere means there is
     nothing to sell, so there is nothing to put on a shelf. */
  const anyPrice = (out.priceTiers || []).some((t) => t.price > 0) || out.price > 0;
  if (!anyPrice) return null;
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
      /* The pull used to go out anonymous. If the POS protects its catalogue
         with the very key the shop just generated for this purpose, every
         path 401s, the whole probe looks like "POS serves no JSON" and backs
         off for five minutes - with nothing anywhere saying it was refused.
         Sent as a header, never as a query string: a secret in a URL ends up
         in access logs. */
      const key = posSyncKey();
      const headers = { Accept: "application/json" };
      if (key) { headers["x-api-key"] = key; headers["Authorization"] = "Bearer " + key; }
      const r = await fetch(POS_BASE + path, { headers, signal: ctl.signal });
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
  /* Hash every field that changes a customer or search-engine page. The old
     revision only watched top-level stock and one price, so a renamed product,
     new photograph, description edit or real variant could change without the
     storefront refreshing or the product sitemap receiving a new lastmod. */
  const s = data
    .map((p) => JSON.stringify({
      id: p.id,
      name: p.name,
      slug: p.slug,
      category: p.category,
      type: p.type,
      description: p.description,
      freeDelivery: p.freeDelivery === true,
      discountEnabled: p.discountEnabled === true,
      discountType: p.discountType,
      discountValue: p.discountValue,
      available: p.available,
      sku: p.sku,
      stock: p.stock,
      price: p.price,
      member: p.member,
      priceTiers: p.priceTiers,
      image: p.image,
      images: p.images,
      variants: p.variants,
    }))
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

/* ---- Photo backfill -------------------------------------------------------
   The POS pushes names, prices and stock but no photographs, so every card
   from a POS feed would otherwise fall back to the leaf placeholder — the
   whole menu going grey overnight. product-images.json keeps the pictures
   alive independently of wherever the catalog comes from: an exact name match
   first, then a category-style photo, then nothing (leaf placeholder).
   Set GENERIC_PRODUCT_IMAGES=0 to skip the category photos and show the
   placeholder for anything without a real photo of its own.                  */
let imgMapCache = null;
const GENERIC_ON = String(process.env.GENERIC_PRODUCT_IMAGES ?? "1") !== "0";

function flatName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")   // "( weed ) Ztupid" -> " Ztupid"
    .replace(/[^a-z0-9]+/g, "");
}

/* Keeping only a-z0-9 means a Thai-only name flattens to the empty string, and
   an empty key can never match a photograph — "( cbd product) ขิงผง โชคดี
   เขาค้อ" was written off as unphotographable for that reason. So there is a
   second key that keeps letters and digits in any script.

   It is a fallback, never a replacement: widening flatName itself would turn
   "Thai Tea ชาไทย" from "thaitea" into "thaiteaชาไทย" and silently break a
   photo that matches today. This is only consulted when the ASCII key came out
   empty, which is exactly the case it was written for. */
function flatNameIntl(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    /* \p{M} keeps the Thai vowel and tone marks: without it the key for
       "ขิงผง" comes out "ขงผง", which nobody would ever type by hand. */
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
}

/* flatName() throws the spaces away, and a keyword search over the result will
   happily find "rig" inside "Original", "cola" inside "Chocolate", "ham" inside
   "Chamomile" and "tea" inside "Steam Bun" — each of which hangs a confident,
   completely wrong photograph on a product. Short keywords therefore have to
   match a whole word, so keep the words as well as the run-together form. */
function wordsOf(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
/* Six characters is where a coincidence stops being plausible: "brownie" or
   "cartridge" buried inside a longer name is almost certainly that thing,
   "cap" is not. Anything at or under this length must land on a word. */
const WORD_ONLY_MAX = 5;
function kwHit(key, flat, words) {
  return key.length > WORD_ONLY_MAX ? flat.includes(key) : words.indexOf(key) >= 0;
}

async function imgMap() {
  if (imgMapCache) return imgMapCache;
  try {
    const raw = await readFile(join(process.cwd(), "product-images.json"), "utf8");
    const j = JSON.parse(raw);
    const byKeyword = j.byKeyword || {};
    /* Longest keyword first, so "chickenkaraage" wins over "chicken" and
       "weissbier" over "weiss" — otherwise a short generic word claims every
       product before the specific one gets a look in. Keywords that point at
       the shop's own Shopify photos scan before generic stock keywords of any
       length: "Zooties pre-roll" must find the shop's Zooties picture, not a
       stock photo of somebody's joint that "preroll" would otherwise serve. */
    const all = Object.keys(byKeyword).sort((a, b) => b.length - a.length);
    const own = all.filter((k) => /cdn\.shopify\.com/.test(byKeyword[k]));
    const gen = all.filter((k) => !/cdn\.shopify\.com/.test(byKeyword[k]));
    imgMapCache = { byName: j.byName || {}, byKeyword, keys: own.concat(gen), keysOwn: own, generic: j.generic || {} };
  } catch (e) {
    imgMapCache = { byName: {}, byKeyword: {}, keys: [], keysOwn: [], generic: {} };
  }
  return imgMapCache;
}

/* A drawn tile of its own for anything with no photograph — see api/tile.js. */
function tileUrl(p) {
  const qs =
    "n=" + encodeURIComponent(String(p.name || "").slice(0, 80)) +
    (p.category ? "&c=" + encodeURIComponent(String(p.category).slice(0, 40)) : "") +
    (p.type ? "&t=" + encodeURIComponent(String(p.type).slice(0, 24)) : "");
  return "/api/tile?" + qs;
}

/* Which category-style photo suits a product we have no real picture for.
   Reads the name and category together, because a POS category is often just
   "Specials" while the name is what actually says "pre-roll" or "grinder". */
function genericKey(p) {
  const s = (String(p.name || "") + " " + String(p.category || "")).toLowerCase();
  if (/\b(joint|pre-?roll|preroll|blunt|cone)\b/.test(s)) return "joints";
  if (/\b(vape|cart|cartridge|pod|disposable|510)\b/.test(s)) return "vapes";
  if (/\b(edible|gummy|gummies|cookie|brownie|chocolate|candy|snack|cake)\b/.test(s)) return "edibles";
  if (/\b(beer|lager|drink|soda|cola|tea|coffee|juice|water|shake|seltzer|can)\b/.test(s)) return "drinks";
  if (/\b(grinder|lighter|paper|rolling|bong|pipe|rig|tray|filter|tip|storage|accessor)/.test(s)) return "accessories";
  if (/\b(shirt|tee|hoodie|cap|hat|merch|sticker|tote|sock)/.test(s)) return "merch";
  /* Deliberately no catch-all here. Five hundred strains sharing one stock
     photo of somebody else's bud looks like a broken menu, not a stocked one —
     those fall through to a tile drawn from their own name instead, so every
     card is different and none of them tells the customer a lie. */
  return "";
}

/* Flower is the one category where a lookalike stock photo is a lie the
   customer can taste: strains are named after food ("Chocolate Crip", "Tea
   Time", "Durian Pop"), and the food keywords would happily hang a chocolate
   bar on a flower card. So weed-category products may only match the shop's
   own photos or an exact name entry — never generic stock, never a category
   photo. Anything left over gets its tile. */
const WEEDISH = /\bweed\b|\bflowers?\b|\bexotics?\b|\btop\s*shelf\b|\bmid\s*grade\b|\bindica\b|\bsativa\b|\bstrains?\b/i;
/* …but a joint photo on a product NAMED "pre-roll" tells the truth about the
   format, so rolled goods keep their generic pictures. */
const ROLLED = /joint|pre-?roll|blunt|cone/i;

/* A product-images entry is either one URL or a list of them. A list is shown
   in order: the shop's own Botanical Legends card leads, the photographs of
   the actual jar follow. `image` stays a single string so every existing
   caller — cards, cart lines, the customer display, the AI chat — keeps
   working untouched, and `images` carries the rest for the gallery. */
function shot(hit) {
  if (Array.isArray(hit)) {
    const list = hit.map((s) => String(s || "").trim()).filter(Boolean);
    if (!list.length) return {};
    return list.length > 1 ? { image: list[0], images: list } : { image: list[0] };
  }
  return { image: hit };
}

/* "zkittlesjoint" -> "zkittles". Only a trailing rolling word is stripped: the
   shop writes the strain first and the format last, and stripping anywhere
   else would turn "Joint Venture OG" into "Venture OG". Returns "" when the
   name is not a rolled one, or is nothing but the rolling word. */
const ROLL_SUFFIX = /(joints?|blunts?|prerolls?|cones?)$/;
function rolledStem(flat) {
  const s = String(flat || "").replace(ROLL_SUFFIX, "");
  return s && s !== flat ? s : "";
}

export async function fillImages(data) {
  if (!Array.isArray(data) || !data.length) return data;
  const m = await imgMap();
  const sdb = await strainDb();
  /* Keywords that describe a rolled thing. Checked before the rest of the
     list for a rolled product, because "chocolate" sits ahead of "joint" in
     the general order and "chocolate chip joint" is a joint, not a dessert. */
  const rollKeys = m.keys.filter((k) => ROLLED.test(k));
  return data.map((p) => {
    if (!p || typeof p !== "object") return p;
    if (p.image && String(p.image).trim()) return p;
    /* 1. an exact photo of this very product */
    const flat = flatName(p.name);
    const words = wordsOf(p.name);
    const hit = m.byName[flat] || (flat ? "" : m.byName[flatNameIntl(p.name)]);
    if (hit) return { ...p, ...shot(hit), _imgFrom: "name" };
    /* 1b. a rolled product wears its own strain's picture. "Zkittles Joint" is
       Zkittles, so it gets the Zkittles card rather than a stock photograph of
       somebody else's joint. Done by rule rather than by listing every rolled
       line, so a pre-roll added to the till next week is covered too. The
       alias table catches the near-misses — the shop writes "Zootie Joint" for
       Zooties and "OG Kush x Zkittles" for the Zkittlez cross. */
    const stem = rolledStem(flat);
    if (stem) {
      const key = m.byName[stem] ? stem : (sdb.alias[stem] && m.byName[sdb.alias[stem]] ? sdb.alias[stem] : "");
      if (key) return { ...p, ...shot(m.byName[key]), _imgFrom: "rolled:" + key };
    }
    const nameCat = String(p.name || "") + " " + String(p.category || "");
    /* A POS category is often just "Specials", so the category word cannot be
       relied on to say "this is flower". A name that IS a strain we know says
       it far more reliably — and "Thai Orange Tea" must never be served a photo
       of Thai food or a teapot because the POS filed it under Specials. */
    const known = !!(sdb.strains[flat] || sdb.strains[sdb.alias[flat]]);
    const weedish = (WEEDISH.test(nameCat) || known) && !ROLLED.test(nameCat);
    const isRolled = ROLLED.test(nameCat);
    if (GENERIC_ON) {
      /* 2. a real photo of what it plainly is — "(Beer) Wila weizen" is a
         wheat beer, "(Food) Chicken Karaage" is fried chicken. The shop's own
         photos scan first; strains scan ONLY those.

         A rolled product is a strain first and a joint second, so it takes the
         same two passes as flower does: the shop's own strain photographs, and
         only then everything else — which is where the picture of a rolled
         joint lives. Scanning the whole list in one go handed "chocolate chip
         joint" a photograph of chocolate. */
      const passes = weedish ? [m.keysOwn] : isRolled ? [m.keysOwn, rollKeys, m.keys] : [m.keys];
      for (const pass of passes) {
        for (const k of pass) {
          if (kwHit(k, flat, words)) return { ...p, image: m.byKeyword[k], _imgFrom: "keyword:" + k };
        }
      }
      /* 3. a photo of its category — never for flower */
      if (!weedish) {
        const g = m.generic[genericKey(p)];
        if (g) return { ...p, image: g, _imgFrom: "generic" };
      }
    }
    /* 4. a tile drawn from its own name — never a blank card */
    return { ...p, image: tileUrl(p), _imgFrom: "tile" };
  });
}

/* ---- Strain database backfill --------------------------------------------
   The POS sends a name, a price and a stock count; a customer tapping a strain
   expects a Leafly-style page — type, THC, effects, flavours, lineage, a line
   or two of description. strain-db.json carries that for every strain we know,
   keyed by the same flattened name the photo backfill uses, so "(weed) Cookiez
   Monster" finds "Cookie Monster" without anyone typing a mapping. Only EMPTY
   fields are filled — anything the POS or the owner editor set stays theirs. */
let strainDbCache = null;
async function strainDb() {
  if (strainDbCache) return strainDbCache;
  try {
    const j = JSON.parse(await readFile(join(process.cwd(), "strain-db.json"), "utf8"));
    const strains = j.strains || {};
    const alias = j.alias || {};
    const keys = Object.keys(strains).concat(Object.keys(alias)).sort((a, b) => b.length - a.length);
    strainDbCache = { strains, alias, keys };
  } catch (e) {
    strainDbCache = { strains: {}, alias: {}, keys: [] };
  }
  return strainDbCache;
}
function findStrain(db, flat) {
  if (!flat) return null;
  const direct = db.strains[flat] || db.strains[db.alias[flat]];
  if (direct) return direct;
  for (const k of db.keys) {
    if (flat.includes(k)) return db.strains[k] || db.strains[db.alias[k]];
  }
  return null;
}
export async function fillStrainInfo(data) {
  if (!Array.isArray(data) || !data.length) return data;
  const db = await strainDb();
  if (!db.keys.length) return data;
  return data.map((p) => {
    if (!p || typeof p !== "object") return p;
    const nameCat = String(p.name || "") + " " + String(p.category || "");
    if (!WEEDISH.test(nameCat) && !ROLLED.test(nameCat)) return p;
    const s = findStrain(db, flatName(p.name));
    if (!s) return p;
    const q = { ...p };
    /* `card: true` marks a strain whose numbers come off the shop's own
       printed Botanical Legends card. That card is what hangs on the wall and
       what the budtender reads out, so it wins outright — otherwise the site
       would keep showing a stale THC from the till or from the bundled
       catalogue and disagree with the counter. Every other strain still only
       fills gaps. */
    const own = s.card === true;
    if ((own || !String(q.description || "").trim()) && s.desc) q.description = s.desc;
    if ((own || !(Array.isArray(q.effects) && q.effects.length)) && s.effects && s.effects.length) q.effects = s.effects;
    if ((own || !(Array.isArray(q.flavors) && q.flavors.length)) && s.flavors && s.flavors.length) q.flavors = s.flavors;
    if ((own || !(Number(q.thc) > 0)) && s.thc) {
      const mnum = String(s.thc).match(/[\d.]+/g);
      if (mnum) q.thc = Number(mnum[mnum.length - 1]);
      if (own || !String(q.thcLabel || "").trim()) q.thcLabel = s.thc;
    }
    /* "Hybrid" is the POS default, not information — a researched
       "Indica-dominant Hybrid" is allowed to replace it, an explicit POS
       "Sativa" is not touched. A card overrides both. */
    if (s.type && (own || !q.type || /^hybrid$/i.test(String(q.type).trim()))) q.type = s.type;
    q.strain = { name: s.name || "", terpene: s.terpene || "", lineage: s.lineage || "" };
    return q;
  });
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
  data = await fillImages(data);
  data = await fillStrainInfo(data);
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
