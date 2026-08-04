/* GET /api/strain-info?name=<product name>
   The strain page's data source, in the order Bryan asked for:

     1. our own strain-db.json          (instant, no network)
     2. the KV cache                    (one lookup per strain, ever)
     3. leafly.com                      (structured page data)
     4. weed.com                        (article text, read for facts)
     5. a web search                    (only if STRAIN_SEARCH_KEY is set)

   What crosses the wire from steps 3-5 is FACTS: indica or sativa, THC and
   CBD percentages, the lead terpene, the effects and flavours named, the
   parents. The description the customer reads is composed here, in our own
   words, from those facts — nobody's editorial writing is copied. Photographs
   are never taken from these sites either; the menu's own photo pipeline (the
   shop's Shopify pictures, stock, or a drawn tile) handles images.

   A hit is cached 30 days, a miss 3 days, and every failure path degrades to
   {found:false} so the page simply shows whatever the menu already had. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getJSON, setJSON } from "./_store.js";
import { harvestProse, describe, cleanName } from "./_strain-harvest.js";

function flat(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

/* ---------- tier 1: our own database ---------- */

let dbCache = null;
async function db() {
  if (dbCache) return dbCache;
  try {
    const j = JSON.parse(await readFile(join(process.cwd(), "strain-db.json"), "utf8"));
    const strains = j.strains || {};
    const alias = j.alias || {};
    const keys = Object.keys(strains).concat(Object.keys(alias)).sort((a, b) => b.length - a.length);
    dbCache = { strains, alias, keys };
  } catch (e) {
    dbCache = { strains: {}, alias: {}, keys: [] };
  }
  return dbCache;
}
function findLocal(d, f) {
  if (!f) return null;
  const hit = d.strains[f] || d.strains[d.alias[f]];
  if (hit) return hit;
  for (const k of d.keys) if (f.includes(k)) return d.strains[k] || d.strains[d.alias[k]];
  return null;
}

/* ---------- turning a POS product name into a URL slug ----------
   POS names carry grade, weight and category noise — "(weed) Gary Payton Top
   Shelf 3.5g" is one strain wearing four adjectives. Strip the noise, but if
   stripping empties the name, keep the original: a strain really can be
   called "Exotic". */

const NOISE = /\b(?:thc|cbd|aaaa|aaa|top\s*shelf|topshelf|mid\s*grade|midgrade|premium|exotics?|house|special|strain|flowers?|weed|cannabis|bud|pack|tier|grade|indoor|outdoor|greenhouse)\b/g;

function slugOf(name) {
  const raw = String(name || "").toLowerCase().replace(/\([^)]*\)/g, " ");
  let s = raw
    .replace(/\b\d+(?:\.\d+)?\s*(?:g|gr|gram|grams|oz|kg|mg|%)\b/g, " ")
    .replace(/\b(?:thc|cbd)\s*[\d.\-]*\s*%?/g, " ")
    .replace(NOISE, " ");
  if (!/[a-z0-9]/.test(s)) s = raw;
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/* Street spellings swap s and z freely — Zkittles, Zkittlez, Zooties, Zootiez. */
function slugVariants(name) {
  const base = slugOf(name);
  if (!base) return [];
  const out = [base];
  const z = base.replace(/s\b/g, "z");
  if (z !== base) out.push(z);
  const s = base.replace(/z\b/g, "s");
  if (s !== base && !out.includes(s)) out.push(s);
  return out.slice(0, 3);
}

/* "Premium Top Shelf Indica 1g" names a grade, not a plant, and cleaning it
   leaves the bare word "Indica". Looking that up would fetch some category
   page and hang another strain's facts on a generic product, so a name with
   nothing but grade words in it never gets a lookup. */
const BARE_CATEGORY = /^(?:indica|sativa|hybrid|weed|flower|flowers|exotic|premium|house|mix|mixed|assorted|other|misc|new|sale)$/i;

function looksLikeStrain(name) {
  const c = cleanName(name).trim();
  if (c.length < 2) return false;
  return c.split(/\s+/).some((t) => {
    const w = t.replace(/[^A-Za-z0-9]/g, "");
    return w.length > 0 && !BARE_CATEGORY.test(w);
  });
}

async function fetchPage(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms || 4500);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DankMenu/1.0; +https://dankbkk.com)", Accept: "text/html" },
      signal: ctl.signal,
      redirect: "follow",
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) {
    return null; /* blocked, timeout, moved — all fine, the next tier tries */
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- tier 3: leafly (structured) ----------
   Every leafly strain page ships a __NEXT_DATA__ JSON blob. Walk it and take
   the facts wherever this month's build happens to have put them. */

function harvest(node, out, depth) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) { for (const v of node) harvest(v, out, depth + 1); return; }
  for (const [k, v] of Object.entries(node)) {
    const key = k.toLowerCase();
    if (!out.type && (key === "phenotype" || key === "category") && typeof v === "string" && /^(indica|sativa|hybrid)$/i.test(v)) out.type = v[0].toUpperCase() + v.slice(1).toLowerCase();
    if (!out.thcNum && (key === "thc" || key === "thclevel" || key === "averagethc") && (typeof v === "number" || (typeof v === "string" && /^[\d.]+$/.test(v)))) { const n = Number(v); if (n > 0 && n < 50) out.thcNum = n; }
    if (!out.cbdNum && (key === "cbd" || key === "cbdlevel" || key === "averagecbd") && (typeof v === "number" || (typeof v === "string" && /^[\d.]+$/.test(v)))) { const n = Number(v); if (n > 0 && n < 30) out.cbdNum = n; }
    if (!out.terpene && (key === "straintopterp" || key === "topterp" || key === "dominantterpene") && typeof v === "string" && v) out.terpene = v[0].toUpperCase() + v.slice(1);
    if ((key === "topeffect" || key === "topeffectname") && typeof v === "string" && v && out.effects.length < 4 && !out.effects.includes(v)) out.effects.push(v[0].toUpperCase() + v.slice(1));
    if ((key === "topflavor" || key === "topflavour") && typeof v === "string" && v && out.flavors.length < 4 && !out.flavors.includes(v)) out.flavors.push(v[0].toUpperCase() + v.slice(1));
    if (!out.lineage && (key === "parents" || key === "lineage") && Array.isArray(v) && v.length) {
      const names = v.map((x) => (x && (x.name || x.title)) || (typeof x === "string" ? x : "")).filter(Boolean);
      if (names.length) out.lineage = names.join(" x ");
    }
    if (typeof v === "object") harvest(v, out, depth + 1);
  }
}

async function leaflyLookup(name) {
  for (const slug of slugVariants(name)) {
    const html = await fetchPage("https://www.leafly.com/strains/" + slug);
    if (!html) continue;
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) continue;
    const out = { type: "", thcNum: 0, cbdNum: 0, terpene: "", effects: [], flavors: [], lineage: "" };
    try { harvest(JSON.parse(m[1]), out, 0); } catch (e) { continue; }
    if (!out.type && !out.thcNum && !out.effects.length) continue;
    out.thc = out.thcNum ? out.thcNum + "%" : "";
    out.cbd = out.cbdNum ? out.cbdNum + "%" : "";
    return { facts: out, site: "leafly.com", url: "https://www.leafly.com/strains/" + slug };
  }
  return null;
}

/* ---------- tier 4: weed.com (article text) ---------- */

async function weedComLookup(name) {
  for (const slug of slugVariants(name)) {
    const url = "https://weed.com/strains/" + slug + "/";
    const html = await fetchPage(url);
    if (!html) continue;
    const facts = harvestProse(html, name);
    if (facts) return { facts, site: "weed.com", url };
  }
  return null;
}

/* ---------- tier 5: web search ----------
   A server cannot literally drive Chrome, so "if no have, searching" is done
   with a search API. It stays switched off until STRAIN_SEARCH_KEY exists in
   the environment, and social, video and shopping results are skipped so we
   only ever read a page that is actually about the plant. */

const SEARCH_SKIP = /(?:facebook|instagram|twitter|x\.com|tiktok|youtube|pinterest|reddit|amazon|ebay|linkedin|wikipedia)\./i;

async function searchLookup(name) {
  const key = process.env.STRAIN_SEARCH_KEY;
  if (!key) return null;
  let urls = [];
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4500);
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: String(name).replace(/\([^)]*\)/g, " ").trim() + " cannabis strain THC terpene effects", num: 8 }),
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));
    if (!r.ok) return null;
    const j = await r.json();
    urls = (j.organic || []).map((o) => o && o.link).filter(Boolean);
  } catch (e) {
    return null;
  }
  let tried = 0;
  for (const url of urls) {
    if (tried >= 3) break;
    if (SEARCH_SKIP.test(url) || /\.(?:pdf|jpg|png|webp|mp4)(?:$|\?)/i.test(url)) continue;
    if (/leafly\.com|weed\.com/i.test(url)) continue; /* already tried properly */
    tried++;
    const html = await fetchPage(url, 4000);
    if (!html) continue;
    const facts = harvestProse(html, name);
    if (facts) {
      let site = "";
      try { site = new URL(url).hostname.replace(/^www\./, ""); } catch (e) {}
      return { facts, site: site || "web", url };
    }
  }
  return null;
}

/* ---------- assembling what the page gets ---------- */

function toStrain(name, hit) {
  const f = hit.facts;
  return {
    name: cleanName(name),
    known: true,
    type: f.type || "",
    thc: f.thc || "",
    cbd: f.cbd || "",
    terpene: f.terpene || "",
    effects: f.effects || [],
    flavors: f.flavors || [],
    lineage: f.lineage || "",
    desc: describe(name, f),
    live: true,
    site: hit.site,
    url: hit.url,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  const name = String((req.query && (req.query.name || req.query.n)) || "").slice(0, 120);
  if (!name.trim()) return res.status(400).json({ found: false, error: "name required" });
  const f = flat(name);

  const d = await db();
  const local = findLocal(d, f);
  if (local && local.known !== false) return res.status(200).json({ found: true, source: "db", strain: local });

  try {
    const cached = await getJSON("strain:info:" + f);
    if (cached) return res.status(200).json({ found: !!cached.known, source: "cache", strain: cached });
  } catch (e) {}

  if (!looksLikeStrain(name)) return res.status(200).json({ found: false, reason: "not a strain name" });

  for (const tier of [leaflyLookup, weedComLookup, searchLookup]) {
    let hit = null;
    try { hit = await tier(name); } catch (e) { hit = null; }
    if (!hit) continue;
    const strain = toStrain(name, hit);
    try { await setJSON("strain:info:" + f, strain, 60 * 60 * 24 * 30); } catch (e) {}
    return res.status(200).json({ found: true, source: hit.site, strain });
  }

  try { await setJSON("strain:info:" + f, { known: false }, 60 * 60 * 24 * 3); } catch (e) {}
  return res.status(200).json({ found: false });
}
