/* Server-rendered SEO pages for the existing static storefront.
   This file deliberately stays dependency-free and only renders facts already
   present in the menu or location configuration. The interactive storefront,
   cart and checkout remain in index.html. */

import { findPost, markdownToHtml, publishedPosts } from "./_blog.js";

export const SITE_URL = "https://www.dankbangkok.com";

export const LOCATIONS = [
  {
    slug: "pattanakarn",
    name: "DANK Cannabis Club & (open24 hrs.) Weed Dispensary",
    type: "Store",
    address: "223 Phatthanakan Rd, Bangkok 10250, Thailand",
    locality: "Bangkok",
    region: "Pattanakarn",
    postalCode: "10250",
    phone: "+66841620610",
    hours: "Open daily · call 24/7",
    map: "https://maps.app.goo.gl/zivxFn4nf6RpBysC6?g_st=ic",
    /* Owner-supplied Google Maps screenshot, checked 27 Aug 2026. This is
       visible trust content only; it is intentionally not added to schema. */
    googleRating: 5,
    googleReviewCount: 1174,
    googleReviewsUrl: "https://maps.app.goo.gl/Q8KQq5noTHABf4HN6?g_st=ic",
  },
  {
    slug: "sathorn",
    name: "DANK Cannabis Club (Sathorn Rama 3) weed dispensary & co-working space",
    type: "Store",
    address: "76/10 Nang Linchi Rd, Bangkok 10120, Thailand",
    locality: "Bangkok",
    region: "Sathorn",
    postalCode: "10120",
    phone: "+66942240702",
    hours: "Open daily · call 24/7",
    map: "https://maps.app.goo.gl/X2j67wBR3q4ueNEU8?g_st=ic",
  },
  {
    slug: "lomsak-phetchabun",
    name: "DANK Lomsak Phetchabun",
    type: "LocalBusiness",
    address: "56/2 Khotchaseni Rd, Phetchabun 67110, Thailand",
    locality: "Lom Sak",
    region: "Phetchabun",
    postalCode: "67110",
    phone: "+66841620610",
    hours: "Call to confirm current hours",
    map: "https://maps.app.goo.gl/ZxrDoRr3iUxJmUWFA?g_st=ic",
  },
  {
    slug: "224-livehouse",
    name: "224 LIVEHOUSE — Pattanakarn",
    type: "BarOrPub",
    address: "Phatthanakan 1 Alley, Bangkok 10250, Thailand",
    locality: "Bangkok",
    region: "Pattanakarn",
    postalCode: "10250",
    phone: "+66841620610",
    hours: "Open late · call to confirm current hours",
    map: "https://maps.app.goo.gl/QgbvTmwEQ3GzFvVo8?g_st=ic",
    venueUrl: "/224-livehouse.html",
  },
];

export function slugify(value, fallback = "item") {
  const slug = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || fallback;
}

export function categoryUrl(category) {
  return `/products/${encodeURIComponent(slugify(category, "other"))}/`;
}

export function productUrl(product) {
  return `${categoryUrl(product?.category) + encodeURIComponent(slugify(product?.slug || product?.name, "product"))}/`;
}

const HIDDEN_CATEGORY = /^(bars?|cocktails?|liquors?|spirits?|whisk(e)?ys?|vodkas?|gins?|rums?|tequilas?|wines?|sake|soju)\b/i;
const BAR_NAME = /\b(gin|vodka|rum|tequila|whisk(?:e)?y|brandy|soju|sake|cognac|absinthe|fireball|sangsom|sang\s*som|hong\s*thong|regency|s[au]ntor[yi]|suntory|cocktail|margarita|mojito|martini|negroni|highball|shot)\b|on\s*the\s*rocks?/i;
const PREROLL_CATEGORY = /^(pre[\s-]?roll|joint)s?\b/i;
const PREROLL_KEEP = /\b(hash|rocket|fuzz|cigar|wax|blunt|backwood|blackwood)/i;
const INTERNAL_ITEM = /\breview\b|\btest(ing)?\b|\(\s*inventory\s*\)/i;

export function isPublicProduct(product) {
  if (!product || typeof product !== "object" || product._hidden) return false;
  const category = String(product.category || "");
  const name = String(product.name || "");
  if (!name || HIDDEN_CATEGORY.test(category) || BAR_NAME.test(name) || INTERNAL_ITEM.test(name)) return false;
  if (PREROLL_CATEGORY.test(category) && !PREROLL_KEEP.test(name)) return false;
  return true;
}

export function publicProducts(menu) {
  const seen = new Set();
  return (Array.isArray(menu) ? menu : []).filter(isPublicProduct).filter((product) => {
    const key = productUrl(product);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function categoriesFrom(menu) {
  const categories = new Map();
  for (const product of publicProducts(menu)) {
    const name = String(product.category || "Other").trim() || "Other";
    const slug = slugify(name, "other");
    if (!categories.has(slug)) categories.set(slug, { slug, name, products: [] });
    categories.get(slug).products.push(product);
  }
  return [...categories.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findProduct(menu, categorySlug, productSlug) {
  return publicProducts(menu).find((product) =>
    slugify(product.category, "other") === categorySlug &&
    slugify(product.slug || product.name, "product") === productSlug
  ) || null;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absoluteUrl(value) {
  const url = String(value || "");
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return SITE_URL + (url.startsWith("/") ? url : `/${url}`);
}

function numericPrices(product) {
  const tiers = Array.isArray(product?.priceTiers) ? product.priceTiers : [];
  const values = tiers.map((tier) => Number(tier?.price)).filter((price) => Number.isFinite(price) && price > 0);
  const single = Number(product?.price);
  if (!values.length && Number.isFinite(single) && single > 0) values.push(single);
  return values;
}

function availability(stock) {
  if (!Number.isFinite(Number(stock))) return undefined;
  return Number(stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
}

function offerFor(product) {
  const prices = numericPrices(product);
  if (!prices.length) return undefined;
  if (prices.length === 1) {
    const offer = { "@type": "Offer", priceCurrency: "THB", price: prices[0] };
    const state = availability(product.stock);
    if (state) offer.availability = state;
    return offer;
  }
  return {
    "@type": "AggregateOffer",
    priceCurrency: "THB",
    lowPrice: Math.min(...prices),
    highPrice: Math.max(...prices),
    offerCount: prices.length,
  };
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) =>
    value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length)
  ));
}

function productEntity(product, url) {
  const entity = compact({
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    url,
    image: (Array.isArray(product.images) ? product.images : [product.image]).filter(Boolean).map(absoluteUrl),
    description: product.description,
    category: product.category,
    sku: product.sku,
    offers: offerFor(product),
  });
  return entity;
}

/* ProductGroup is emitted only when the application supplies real variants.
   Current DANK menu records do not, so current pages remain Product entities. */
export function buildProductEntity(product, url) {
  const variants = Array.isArray(product?.variants) ? product.variants.filter(Boolean) : [];
  if (!variants.length) return productEntity(product, url);

  const dimensions = ["color", "size", "material"].filter((key) => variants.some((variant) => variant?.[key]));
  if (!dimensions.length) return productEntity(product, url);

  const hasVariant = variants.slice(0, 50).map((variant, index) => {
    const label = [variant.color, variant.size, variant.material].filter(Boolean).join(" · ");
    const idPart = slugify(variant.slug || variant.sku || label, `variant-${index + 1}`);
    return compact({
      "@type": "Product",
      "@id": `${url}#${idPart}`,
      name: variant.name || (label ? `${product.name} — ${label}` : product.name),
      color: variant.color,
      size: variant.size,
      material: variant.material,
      sku: variant.sku,
      image: (Array.isArray(variant.images) ? variant.images : [variant.image]).filter(Boolean).map(absoluteUrl),
      isVariantOf: { "@id": `${url}#product-group` },
      offers: offerFor(variant),
    });
  });

  return compact({
    "@type": "ProductGroup",
    "@id": `${url}#product-group`,
    name: product.name,
    url,
    description: product.description,
    image: (Array.isArray(product.images) ? product.images : [product.image]).filter(Boolean).map(absoluteUrl),
    productGroupID: product.productGroupID,
    variesBy: dimensions.map((dimension) => `https://schema.org/${dimension}`),
    hasVariant,
  });
}

function breadcrumbEntity(items, url) {
  return {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: items.map((item, index) => compact({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.path ? SITE_URL + item.path : undefined,
    })),
  };
}

function jsonLd(entities) {
  const graph = entities.filter(Boolean);
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`;
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${items.map((item, index) =>
    item.path ? `<a href="${escapeHtml(item.path)}">${escapeHtml(item.name)}</a>${index < items.length - 1 ? "<span>›</span>" : ""}` : `<span aria-current="page">${escapeHtml(item.name)}</span>`
  ).join("")}</nav>`;
}

function pageShell({ title, description, canonical, body, entities = [], noindex = false, image = "", ogType = "website", lang = "en", head = "" }) {
  const robots = noindex ? "noindex,follow" : "index,follow,max-image-preview:large";
  const canonicalUrl = SITE_URL + canonical;
  const imageUrl = absoluteUrl(image);
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="${robots}">
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta property="og:type" content="${escapeHtml(ogType)}">
<meta property="og:site_name" content="DANK BKK">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}"><meta name="twitter:card" content="summary_large_image">` : "<meta name=\"twitter:card\" content=\"summary\">"}
<title>${escapeHtml(title)}</title>
${head}${jsonLd(entities)}
<style>
:root{--bg:#060a07;--panel:#101a12;--panel2:#16241a;--line:#294634;--text:#e8f5ec;--muted:#9bb3a2;--green:#3ddc84;--gold:#d9b25b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}a{color:inherit}.wrap{width:min(1120px,calc(100% - 32px));margin:auto}header{position:sticky;top:0;background:rgba(6,10,7,.94);border-bottom:1px solid var(--line);z-index:10}header .wrap{display:flex;align-items:center;justify-content:space-between;min-height:64px;gap:18px}.brand{display:flex;align-items:center;gap:9px;font-weight:800;letter-spacing:.5px;text-decoration:none;font-size:20px;white-space:nowrap}.brand img{width:40px;height:40px;object-fit:contain}.brand b{color:var(--green)}nav.main{display:flex;gap:16px;flex-wrap:wrap}nav.main a{color:var(--muted);font-size:14px;text-decoration:none}nav.main a:hover{color:var(--green)}main{padding:36px 0 72px}.breadcrumbs{display:flex;gap:9px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-bottom:24px}.breadcrumbs a{text-decoration:none}.breadcrumbs a:hover{color:var(--green)}h1{font-size:clamp(30px,5vw,58px);line-height:1.05;margin:0 0 16px}h2{font-size:24px;margin:38px 0 16px}.lede{color:var(--muted);max-width:760px;margin:0 0 28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;text-decoration:none}.card:hover{border-color:var(--green)}.card img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;background:var(--panel2);margin-bottom:14px}.card h2,.card h3{margin:0 0 7px;font-size:18px}.meta{color:var(--muted);font-size:14px}.product{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,1fr);gap:30px;align-items:start}.product-media{background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:16px}.product-media img{width:100%;aspect-ratio:1;object-fit:contain;border-radius:14px}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fact{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}.fact small{display:block;color:var(--muted)}.tiers{width:100%;border-collapse:collapse;background:var(--panel);border-radius:14px;overflow:hidden}.tiers th,.tiers td{text-align:left;padding:11px;border-bottom:1px solid var(--line)}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}.button{display:inline-flex;padding:12px 18px;border-radius:12px;background:linear-gradient(135deg,var(--green),#1db960);color:#04180d;text-decoration:none;font-weight:800}.button.secondary{background:transparent;color:var(--text);border:1px solid var(--line)}.notice{padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--muted)}.post-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:16px}.post-card{display:flex;flex-direction:column;padding:0;overflow:hidden}.post-card img{aspect-ratio:16/9;margin:0;border-radius:0}.post-card .post-body{padding:16px 18px 18px}.post-date{color:var(--gold);font-size:13px;font-weight:700;letter-spacing:.3px}.article{max-width:760px}.article .hero{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:18px;border:1px solid var(--line);margin:8px 0 28px}.article-body{font-size:17px;line-height:1.75}.article-body h2{font-size:26px;margin:40px 0 12px}.article-body h3{font-size:20px;margin:28px 0 10px;color:var(--green)}.article-body a{color:var(--green)}.article-body img{max-width:100%;border-radius:14px}.article-body figure{margin:24px 0}.article-body blockquote{margin:24px 0;padding:14px 18px;border-left:3px solid var(--gold);background:var(--panel);border-radius:0 12px 12px 0;color:var(--muted)}.article-body li{margin:6px 0}.cta-box{margin:40px 0 24px;padding:22px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}.cta-box h2{margin-top:0}.cta-shops{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px;margin-top:14px}.cta-shops .fact strong{display:block;margin:4px 0 2px}.cta-shops .actions{margin:12px 0 0}.faq h3{color:var(--text);font-size:18px}html[lang="th"] h1{line-height:1.3}html[lang="th"] h2,html[lang="th"] h3{line-height:1.4}footer{border-top:1px solid var(--line);color:var(--muted);padding:26px 0;font-size:13px}
@media(max-width:760px){header .wrap{align-items:flex-start;padding-block:14px;flex-direction:column}nav.main{gap:11px}.product{grid-template-columns:1fr}main{padding-top:24px}}
</style>
</head>
<body>
<header><div class="wrap"><a class="brand" href="/" aria-label="DANK BKK home"><img src="/assets/dank-mascot.png" alt="" width="40" height="40">DANK BKK</a><nav class="main" aria-label="Main navigation"><a href="/products/">Products</a><a href="/locations/">Locations</a><a href="/about/">About</a><a href="/faq/">FAQ</a><a href="/blog/">Blog</a><a href="/contact/">Contact</a></nav></div></header>
<main><div class="wrap">${body}</div></main>
<footer><div class="wrap">DANK BKK · For adults 20+ · Please consume responsibly.</div></footer>
</body></html>`;
}

function priceLabel(product) {
  const prices = numericPrices(product);
  if (!prices.length) return "Price available in shop";
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? `฿${low.toLocaleString("en-US")}` : `฿${low.toLocaleString("en-US")}–฿${high.toLocaleString("en-US")}`;
}

function productCard(product) {
  const image = absoluteUrl(product.image || product.images?.[0]);
  return `<a class="card" href="${escapeHtml(productUrl(product))}">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">` : ""}<h2>${escapeHtml(product.name)}</h2><div class="meta">${escapeHtml(product.category || "Other")} · ${escapeHtml(priceLabel(product))}</div></a>`;
}

export function renderProductsPage(menu) {
  const categories = categoriesFrom(menu);
  const path = "/products/";
  const items = [{ name: "Home", path: "/" }, { name: "Products" }];
  const itemList = {
    "@type": "ItemList",
    "@id": `${SITE_URL + path}#categories`,
    itemListElement: categories.map((category, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: category.name,
      url: SITE_URL + categoryUrl(category.name),
    })),
  };
  return pageShell({
    title: "Products | DANK BKK",
    description: "Browse the current DANK BKK product catalogue by category.",
    canonical: path,
    entities: [breadcrumbEntity(items, SITE_URL + path), itemList],
    body: `${breadcrumbs(items)}<h1>Products</h1><p class="lede">Browse the current catalogue by category. Product availability and prices come from the shop's existing menu data.</p><div class="grid">${categories.map((category) => `<a class="card" href="${categoryUrl(category.name)}"><h2>${escapeHtml(category.name)}</h2><div class="meta">${category.products.length} product${category.products.length === 1 ? "" : "s"}</div></a>`).join("")}</div>`,
  });
}

export function renderCategoryPage(menu, categorySlug) {
  const category = categoriesFrom(menu).find((item) => item.slug === categorySlug);
  if (!category) return null;
  const path = categoryUrl(category.name);
  const items = [{ name: "Home", path: "/" }, { name: "Products", path: "/products/" }, { name: category.name }];
  const itemList = {
    "@type": "ItemList",
    "@id": `${SITE_URL + path}#products`,
    itemListElement: category.products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: product.name,
      url: SITE_URL + productUrl(product),
    })),
  };
  return pageShell({
    title: `${category.name} | DANK BKK`,
    description: `${category.name} products currently listed in the DANK BKK catalogue.`,
    canonical: path,
    entities: [breadcrumbEntity(items, SITE_URL + path), itemList],
    body: `${breadcrumbs(items)}<h1>${escapeHtml(category.name)}</h1><p class="lede">Products currently listed in this category. Select a product for its dedicated details page.</p><div class="grid">${category.products.map(productCard).join("")}</div>`,
  });
}

export function renderProductPage(menu, categorySlug, productSlug) {
  const product = findProduct(menu, categorySlug, productSlug);
  if (!product) return null;
  const path = productUrl(product);
  const url = SITE_URL + path;
  const items = [{ name: "Home", path: "/" }, { name: "Products", path: "/products/" }, { name: product.category || "Other", path: categoryUrl(product.category) }, { name: product.name }];
  const related = publicProducts(menu).filter((item) => item !== product && item.category === product.category).slice(0, 4);
  const images = (Array.isArray(product.images) ? product.images : [product.image]).filter(Boolean);
  const tiers = Array.isArray(product.priceTiers) ? product.priceTiers.filter((tier) => Number(tier?.price) > 0) : [];
  const facts = [
    ["Category", product.category],
    ["Type", product.type],
    ["THC", product.thcLabel || (Number(product.thc) > 0 ? `${product.thc}%` : "")],
    ["CBD", Number(product.cbd) > 0 ? `${product.cbd}%` : ""],
    ["Availability", Number.isFinite(Number(product.stock)) ? (Number(product.stock) > 0 ? "In stock" : "Out of stock") : ""],
    ["SKU", product.sku],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  const variants = Array.isArray(product.variants) ? product.variants.filter(Boolean) : [];
  const productSchema = buildProductEntity(product, url);
  return pageShell({
    title: `${product.name} | DANK BKK`,
    description: product.description || `${product.name} product details from the current DANK BKK catalogue.`,
    canonical: path,
    image: images[0],
    entities: [breadcrumbEntity(items, url), productSchema],
    body: `${breadcrumbs(items)}<div class="product"><div class="product-media">${images[0] ? `<img src="${escapeHtml(absoluteUrl(images[0]))}" alt="${escapeHtml(product.name)}">` : "<div class=\"notice\">No product image is currently available.</div>"}</div><div><h1>${escapeHtml(product.name)}</h1>${product.description ? `<p class="lede">${escapeHtml(product.description)}</p>` : ""}<div class="facts">${facts.map(([label, value]) => `<div class="fact"><small>${escapeHtml(label)}</small>${escapeHtml(value)}</div>`).join("")}</div>${tiers.length ? `<h2>Available sizes</h2><table class="tiers"><thead><tr><th>Size</th><th>Price</th></tr></thead><tbody>${tiers.map((tier) => `<tr><td>${escapeHtml(tier.label)}</td><td>฿${escapeHtml(Number(tier.price).toLocaleString("en-US"))}</td></tr>`).join("")}</tbody></table>` : `<h2>Price</h2><p>${escapeHtml(priceLabel(product))}</p>`}${variants.length ? `<h2>Available options</h2><div class="grid">${variants.map((variant) => {
      const dimensions = [variant.color, variant.size, variant.material].filter(Boolean);
      const optionName = variant.name || dimensions.join(" · ") || variant.sku || "Option";
      const optionMeta = [...dimensions, variant.sku ? `SKU ${variant.sku}` : "", priceLabel(variant), Number.isFinite(Number(variant.stock)) ? (Number(variant.stock) > 0 ? "In stock" : "Out of stock") : ""].filter(Boolean);
      return `<div class="card"><h3>${escapeHtml(optionName)}</h3><div class="meta">${escapeHtml(optionMeta.join(" · "))}</div></div>`;
    }).join("")}</div>` : ""}<div class="actions"><a class="button" href="/?product=${encodeURIComponent(String(product.id || ""))}">Open in shop</a><a class="button secondary" href="${escapeHtml(categoryUrl(product.category))}">Back to ${escapeHtml(product.category || "category")}</a></div></div></div>${related.length ? `<h2>Related products</h2><div class="grid">${related.map(productCard).join("")}</div>` : ""}`,
  });
}

export function renderLocationsPage() {
  const path = "/locations/";
  const items = [{ name: "Home", path: "/" }, { name: "Locations" }];
  return pageShell({
    title: "Locations | DANK BKK",
    description: "Addresses, contact details and map links for DANK locations.",
    canonical: path,
    entities: [breadcrumbEntity(items, SITE_URL + path)],
    body: `${breadcrumbs(items)}<h1>Locations</h1><p class="lede">Addresses and directions from the current DANK location list.</p><div class="grid">${LOCATIONS.map((location) => `<a class="card" href="/locations/${location.slug}/"><h2>${escapeHtml(location.name)}</h2><div class="meta">${escapeHtml(location.address)}${location.googleRating ? `<br>★★★★★ ${escapeHtml(Number(location.googleRating).toFixed(1))} on Google · ${escapeHtml(Number(location.googleReviewCount).toLocaleString("en-US"))}+ reviews` : ""}</div></a>`).join("")}</div>`,
  });
}

export function renderLocationPage(slug) {
  const location = LOCATIONS.find((item) => item.slug === slug);
  if (!location) return null;
  const path = `/locations/${location.slug}/`;
  const url = SITE_URL + path;
  const items = [{ name: "Home", path: "/" }, { name: "Locations", path: "/locations/" }, { name: location.name }];
  const localBusiness = compact({
    "@type": location.type,
    "@id": `${url}#business`,
    name: location.name,
    url,
    telephone: location.phone,
    hasMap: location.map,
    address: {
      "@type": "PostalAddress",
      streetAddress: location.address.split(",")[0],
      addressLocality: location.locality,
      addressRegion: location.region,
      postalCode: location.postalCode,
      addressCountry: "TH",
    },
  });
  return pageShell({
    title: `${location.name} | DANK BKK`,
    description: `${location.name}: address, contact information and directions.`,
    canonical: path,
    entities: [breadcrumbEntity(items, url), localBusiness],
    body: `${breadcrumbs(items)}<h1>${escapeHtml(location.name)}</h1><div class="facts"><div class="fact"><small>Address</small>${escapeHtml(location.address)}</div><div class="fact"><small>Hours</small>${escapeHtml(location.hours)}</div><div class="fact"><small>Phone</small><a href="tel:${escapeHtml(location.phone)}">084-162-0610</a></div></div>${location.googleReviewsUrl ? `<h2>Customer reviews</h2><a class="card" href="${escapeHtml(location.googleReviewsUrl)}" target="_blank" rel="noopener noreferrer"><h3>★★★★★ ${escapeHtml(Number(location.googleRating).toFixed(1))} on Google</h3><div class="meta">Based on ${escapeHtml(Number(location.googleReviewCount).toLocaleString("en-US"))}+ Google reviews · Read reviews on Google Maps ↗</div></a>` : ""}<div class="actions"><a class="button" href="${escapeHtml(location.map)}" target="_blank" rel="noopener noreferrer">Get directions</a>${location.venueUrl ? `<a class="button secondary" href="${escapeHtml(location.venueUrl)}">Open venue page</a>` : ""}</div>`,
  });
}

const FAQS = [
  ["Who may enter the cannabis storefront?", "Adults aged 20 or older. Valid identification may be required."],
  ["Where is pickup available?", "Pickup is available at the Pattanakarn and Sathorn branches shown on the website."],
  ["Which payment methods are listed?", "PromptPay, card, cash, bank transfer and crypto are listed by the current storefront."],
  ["How do I get directions?", "Open the Locations page and select the relevant branch for its Google Maps link."],
];

export function renderStaticPage(page) {
  if (page === "about") {
    const path = "/about/";
    const items = [{ name: "Home", path: "/" }, { name: "About" }];
    return pageShell({ title: "About | DANK BKK", description: "Factual information about DANK BKK and its connected storefront.", canonical: path, entities: [breadcrumbEntity(items, SITE_URL + path)], body: `${breadcrumbs(items)}<h1>About DANK BKK</h1><p class="lede">DANK BKK operates locations in Bangkok and Phetchabun. The online storefront reads its current product catalogue, prices and stock from the shop's existing menu systems.</p><div class="actions"><a class="button" href="/locations/">View locations</a><a class="button secondary" href="/products/">Browse products</a></div>` });
  }
  if (page === "contact") {
    const path = "/contact/";
    const items = [{ name: "Home", path: "/" }, { name: "Contact" }];
    return pageShell({ title: "Contact | DANK BKK", description: "DANK BKK phone, LINE and location links.", canonical: path, entities: [breadcrumbEntity(items, SITE_URL + path)], body: `${breadcrumbs(items)}<h1>Contact</h1><div class="facts"><div class="fact"><small>Phone</small><a href="tel:+66841620610">084-162-0610</a></div><div class="fact"><small>LINE and social links</small><a href="https://linktr.ee/dankbkk" rel="noopener noreferrer">linktr.ee/dankbkk</a></div></div><div class="actions"><a class="button" href="/locations/">Addresses and directions</a></div>` });
  }
  if (page === "faq") {
    const path = "/faq/";
    const items = [{ name: "Home", path: "/" }, { name: "FAQ" }];
    const schema = { "@type": "FAQPage", "@id": `${SITE_URL + path}#faq`, mainEntity: FAQS.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) };
    return pageShell({ title: "FAQ | DANK BKK", description: "Answers to common questions using information stated by the DANK BKK storefront.", canonical: path, entities: [breadcrumbEntity(items, SITE_URL + path), schema], body: `${breadcrumbs(items)}<h1>Frequently asked questions</h1>${FAQS.map(([question, answer]) => `<section class="card" style="margin-bottom:12px"><h2>${escapeHtml(question)}</h2><p class="meta">${escapeHtml(answer)}</p></section>`).join("")}` });
  }
  if (page === "blog") return renderBlogIndex();
  return null;
}

function formatDate(value, lang = "en") {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function postCard(post) {
  const image = absoluteUrl(post.image);
  return `<a class="card post-card" href="/blog/${escapeHtml(post.slug)}/">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ""}<div class="post-body"><div class="post-date">${escapeHtml(formatDate(post.date, post.lang))}</div><h2>${escapeHtml(post.title)}</h2><div class="meta">${escapeHtml(post.description)}</div></div></a>`;
}

export function renderBlogIndex() {
  const path = "/blog/";
  const posts = publishedPosts();
  const items = [{ name: "Home", path: "/" }, { name: "Blog" }];
  const list = posts.length
    ? `<div class="post-grid">${posts.map(postCard).join("")}</div>`
    : `<div class="notice">No articles yet — check back soon.</div>`;
  return pageShell({
    title: "Blog | DANK BKK",
    description: "News, guides and updates from DANK BKK in Bangkok.",
    canonical: path,
    noindex: !posts.length,
    entities: [breadcrumbEntity(items, SITE_URL + path)],
    body: `${breadcrumbs(items)}<h1>Blog</h1><p class="lede">News, guides and updates from DANK BKK.</p>${list}`,
  });
}

/* Every article ends by sending the reader to a shop: directions and a phone
   number, from the location list, in the article's language. */
function blogCta(lang) {
  const th = lang === "th";
  const shops = LOCATIONS.filter((location) => location.type === "Store");
  return `<section class="cta-box"><h2>${th ? "แวะมาที่ร้าน DANK BKK" : "Visit a DANK BKK shop"}</h2><p class="meta">${th ? "ทุกสาขาเปิดทุกวัน มีผู้ประกอบวิชาชีพประจำร้านให้คำปรึกษา กรุณานำบัตรประชาชนหรือพาสปอร์ตมาด้วย สำหรับผู้มีอายุ 20 ปีขึ้นไป" : "Every shop is open daily with a licensed practitioner on site. Bring your ID or passport. Adults 20+ only."}</p><div class="cta-shops">${shops.map((shop) => `<div class="fact"><small>${escapeHtml(shop.region)}</small><strong>${escapeHtml(shop.address)}</strong><div class="actions"><a class="button" href="${escapeHtml(shop.map)}" target="_blank" rel="noopener noreferrer">${th ? "ดูเส้นทาง" : "Get directions"}</a><a class="button secondary" href="tel:${escapeHtml(shop.phone)}">${th ? "โทร" : "Call"} ${escapeHtml(shop.phone.replace(/^\+66/, "0").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"))}</a></div></div>`).join("")}</div></section>`;
}

function faqSection(post) {
  if (!post.faqs?.length) return "";
  const th = post.lang === "th";
  return `<section class="faq"><h2>${th ? "คำถามที่พบบ่อย" : "Frequently asked questions"}</h2>${post.faqs.map((faq) => `<h3>${escapeHtml(faq.q)}</h3><p>${escapeHtml(faq.a)}</p>`).join("")}</section>`;
}

export function renderBlogArticle(post, { preview = false } = {}) {
  const path = `/blog/${post.slug}/`;
  const url = SITE_URL + path;
  const image = absoluteUrl(post.image);
  const th = post.lang === "th";
  const items = [{ name: th ? "หน้าแรก" : "Home", path: "/" }, { name: "Blog", path: "/blog/" }, { name: post.title }];
  const article = compact({
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated || post.date,
    image: (post.images || []).filter((img) => img.src).length
      ? post.images.filter((img) => img.src).map((img) => compact({ "@type": "ImageObject", url: absoluteUrl(img.src), name: img.title || undefined, description: img.description || undefined, caption: img.alt || undefined }))
      : image || undefined,
    inLanguage: post.lang || "en",
    keywords: post.keyword || undefined,
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: "DANK BKK", url: SITE_URL },
    publisher: { "@type": "Organization", name: "DANK BKK", url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/assets/dank-mascot.png` } },
  });
  const faq = post.faqs?.length ? {
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    mainEntity: post.faqs.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
  } : null;
  const head = `<meta property="article:published_time" content="${escapeHtml(post.date)}">${post.updated ? `<meta property="article:modified_time" content="${escapeHtml(post.updated)}">` : ""}${image && post.imageAlt ? `<meta property="og:image:alt" content="${escapeHtml(post.imageAlt)}">` : ""}`;
  return pageShell({
    title: post.metaTitle || `${post.title} | DANK BKK`,
    description: post.description,
    canonical: path,
    image: post.image,
    ogType: "article",
    lang: post.lang || "en",
    noindex: preview,
    head,
    entities: [breadcrumbEntity(items, url), article, faq],
    body: `${breadcrumbs(items)}<article class="article"><div class="post-date">${escapeHtml(formatDate(post.date, post.lang))}${post.updated ? ` · ${th ? "อัปเดต" : "Updated"} ${escapeHtml(formatDate(post.updated, post.lang))}` : ""}</div><h1>${escapeHtml(post.title)}</h1>${image && !String(post.body || "").includes(`](${post.image})`) ? `<img class="hero" src="${escapeHtml(image)}" alt="${escapeHtml(post.imageAlt || "")}">` : ""}<div class="article-body">${markdownToHtml(post.body, post.images || [])}${faqSection(post)}</div>${blogCta(post.lang)}<div class="actions"><a class="button secondary" href="/blog/">${th ? "อ่านบทความอื่น" : "More articles"}</a></div></article>`,
  });
}

export function renderBlogPost(slug) {
  const post = findPost(slug);
  return post ? renderBlogArticle(post) : null;
}

export function renderNotFound() {
  return pageShell({ title: "Page not found | DANK BKK", description: "The requested page was not found.", canonical: "/404/", noindex: true, body: `<h1>Page not found</h1><p class="lede">The requested page does not exist or is no longer available.</p><a class="button" href="/">Return home</a>` });
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function urlset(urls, lastmod = "") {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `  <url><loc>${xmlEscape(SITE_URL + path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
}

export function renderSitemap(type, menu = [], changedAt = 0) {
  if (type === "index") {
    const maps = ["pages", "products", "product-categories", "blog", "locations"];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps.map((name) => `  <sitemap><loc>${SITE_URL}/sitemap-${name}.xml</loc></sitemap>`).join("\n")}\n</sitemapindex>\n`;
  }
  const lastmod = Number(changedAt) > 0 ? new Date(Number(changedAt)).toISOString().slice(0, 10) : "";
  if (type === "pages") return urlset(["/", "/about/", "/products/", "/locations/", "/faq/", "/contact/", "/224-livehouse.html", "/build-your-joint.html", "/food.html", ...(publishedPosts().length ? ["/blog/"] : [])]);
  if (type === "products") return urlset(publicProducts(menu).map(productUrl), lastmod);
  if (type === "product-categories") return urlset(categoriesFrom(menu).map((category) => categoryUrl(category.name)), lastmod);
  if (type === "locations") return urlset(LOCATIONS.map((location) => `/locations/${location.slug}/`));
  if (type === "blog") {
    const posts = publishedPosts();
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${posts.map((post) => `  <url><loc>${xmlEscape(`${SITE_URL}/blog/${post.slug}/`)}</loc><lastmod>${xmlEscape(post.updated || post.date)}</lastmod></url>`).join("\n")}\n</urlset>\n`;
  }
  return null;
}
