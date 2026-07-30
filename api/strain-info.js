/* GET /api/strain-info?name=<product name>
   The strain page's data source, in the order Bryan asked for: our own
   strain-db.json first, then a live look at leafly.com for anything new.

   The live path reads leafly's structured page data (the __NEXT_DATA__ JSON
   every page ships) and keeps only the FACTS — type, THC, terpene, effects,
   flavours, lineage. The description we serve is composed here from those
   facts in our own words; leafly's editorial text is theirs and never copied.
   Photos are never taken from leafly either — the menu's own photo pipeline
   (the shop's Shopify pictures, stock, or a drawn tile) handles images.
   A hit is cached for 30 days so each new strain costs one lookup, and every
   failure path degrades to {found:false} so the page simply shows what the
   menu already had. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getJSON, setJSON } from "./_store.js";

function flat(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

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

/* Walk any JSON tree collecting the strain facts wherever leafly's build put
   them this month — resilient to their page structure moving around. */
function harvest(node, out, depth) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) { for (const v of node) harvest(v, out, depth + 1); return; }
  for (const [k, v] of Object.entries(node)) {
    const key = k.toLowerCase();
    if (!out.type && (key === "phenotype" || key === "category") && typeof v === "string" && /^(indica|sativa|hybrid)$/i.test(v)) out.type = v[0].toUpperCase() + v.slice(1).toLowerCase();
    if (!out.thc && (key === "thc" || key === "thclevel" || key === "averagethc") && (typeof v === "number" || (typeof v === "string" && /^[\d.]+$/.test(v)))) { const n = Number(v); if (n > 0 && n < 50) out.thc = n; }
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

async function liveLookup(name) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(thc|cbd)\s*[\d.\-]*\s*%?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return null;
  const slugs = [base];
  if (base.includes("s")) slugs.push(base.replace(/s\b/g, "z")); // Zkittles → Zkittlez style spellings
  for (const slug of slugs.slice(0, 2)) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      const r = await fetch("https://www.leafly.com/strains/" + slug, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DankMenu/1.0)", Accept: "text/html" },
        signal: ctl.signal,
      });
      if (!r.ok) continue;
      const html = await r.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) continue;
      const out = { type: "", thc: 0, terpene: "", effects: [], flavors: [], lineage: "" };
      harvest(JSON.parse(m[1]), out, 0);
      if (!out.type && !out.thc && !out.effects.length) continue;
      /* our own sentence, from the facts */
      const bits = [];
      if (out.type) bits.push(out.type.toLowerCase() + " strain");
      if (out.thc) bits.push("around " + out.thc + "% THC");
      if (out.terpene) bits.push(out.terpene.toLowerCase() + "-dominant");
      const desc = bits.length ? name.replace(/\([^)]*\)/g, "").trim() + " — a " + bits.join(", ") + "." : "";
      return {
        name: String(name), known: true, type: out.type || "",
        thc: out.thc ? String(out.thc) + "%" : "", cbd: "",
        terpene: out.terpene, effects: out.effects, flavors: out.flavors,
        lineage: out.lineage, desc, live: true,
      };
    } catch (e) { /* blocked, timeout, moved — all fine, fall through */ }
    finally { clearTimeout(timer); }
  }
  return null;
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

  const live = await liveLookup(name);
  if (live) {
    try { await setJSON("strain:info:" + f, live, 60 * 60 * 24 * 30); } catch (e) {}
    return res.status(200).json({ found: true, source: "live", strain: live });
  }
  try { await setJSON("strain:info:" + f, { known: false }, 60 * 60 * 24 * 3); } catch (e) {}
  return res.status(200).json({ found: false });
}
