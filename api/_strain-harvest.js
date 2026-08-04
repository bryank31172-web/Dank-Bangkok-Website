/* Prose harvester — pulls strain FACTS out of an ordinary article page.

   Leafly ships a machine-readable blob on every strain page, so that source
   gets parsed properly (see strain-info.js). weed.com does not: its strain
   pages are written as articles, so the only honest way to read them is the
   way a person would — find the sentence that says what the plant is and take
   the number out of it.

   What we take is facts only: indica/sativa, THC and CBD percentages, the
   lead terpene, which effects and flavours are named. We never keep a
   sentence of anyone's writing, and we never take their photographs. The
   description the customer reads is composed from these facts, in our own
   words, by describe() at the bottom of this file. */

export function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/g, " ")
    .replace(/&(?:ndash|mdash|#8211|#8212);/g, "-")
    .replace(/&(?:amp|#38);/g, "&")
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:#39|rsquo|#8217|apos);/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TERPENES = [
  "myrcene", "limonene", "caryophyllene", "terpinolene", "pinene", "linalool",
  "humulene", "ocimene", "bisabolol", "valencene", "nerolidol", "camphene",
  "geraniol", "eucalyptol", "farnesene", "guaiol", "sabinene", "terpineol",
  "borneol", "phellandrene", "carene", "isopulegol",
];

/* Only the pleasant half. The pages list "dry mouth, dry eyes, paranoia" under
   a negatives heading and those must never leak into the effect meters. */
const EFFECTS = [
  ["euphori", "Euphoric"], ["relax", "Relaxed"], ["uplift", "Uplifted"],
  ["happy", "Happy"], ["happiness", "Happy"], ["creativ", "Creative"],
  ["focus", "Focused"], ["energetic", "Energetic"], ["energizing", "Energetic"],
  ["giggl", "Giggly"], ["talkative", "Talkative"], ["sociab", "Sociable"],
  ["social", "Sociable"], ["tingl", "Tingly"], ["sleepy", "Sleepy"],
  ["sedat", "Sleepy"], ["couch-lock", "Sleepy"], ["hungry", "Hungry"],
  ["appetite", "Hungry"], ["calm", "Calm"], ["body high", "Body high"],
  ["arous", "Aroused"], ["motivat", "Motivated"],
];

const FLAVORS = [
  ["citrus", "Citrus"], ["lemon", "Lemon"], ["lime", "Lime"], ["orange", "Orange"],
  ["berry", "Berry"], ["blueberry", "Blueberry"], ["strawberry", "Strawberry"],
  ["grape", "Grape"], ["tropical", "Tropical"], ["mango", "Mango"],
  ["pineapple", "Pineapple"], ["sweet", "Sweet"], ["earthy", "Earthy"],
  ["pine", "Pine"], ["diesel", "Diesel"], ["fuel", "Fuel"], ["gassy", "Gas"],
  ["skunk", "Skunky"], ["spicy", "Spicy"], ["pepper", "Pepper"],
  ["herbal", "Herbal"], ["floral", "Floral"], ["vanilla", "Vanilla"],
  ["creamy", "Creamy"], ["mint", "Minty"], ["chocolate", "Chocolate"],
  ["coffee", "Coffee"], ["nutty", "Nutty"], ["cheese", "Cheese"],
  ["sour", "Sour"], ["candy", "Candy"], ["honey", "Honey"], ["woody", "Woody"],
  ["dough", "Doughy"], ["butter", "Buttery"],
];

/* Rank by how often the page says it, then by which was said first — the
   thing an article keeps coming back to is the thing that matters. */
function rankVocab(text, vocab, cap) {
  const t = text.toLowerCase();
  const seen = new Map();
  for (const [needle, label] of vocab) {
    let n = 0, from = 0, first = -1;
    for (;;) {
      const i = t.indexOf(needle, from);
      if (i < 0) break;
      if (first < 0) first = i;
      n++; from = i + needle.length;
      if (n > 30) break;
    }
    if (!n) continue;
    const prev = seen.get(label);
    if (prev) { prev.n += n; if (first < prev.first) prev.first = first; }
    else seen.set(label, { n, first });
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, cap)
    .map(([label]) => label);
}

/* "CBD Level: 1% or below" is not the same claim as "CBD: 1%", and the
   difference is the one a customer would notice. Keep the qualifier. */
const BELOW = /\b(?:below|under|less than|no more than|negligible|trace|or below|or less)\b/i;

function pct(text, which) {
  const W = which === "thc" ? "THC" : "CBD";
  const re = [
    /* "17-22% THC", "20 to 26 % THC" */
    new RegExp("(\\d{1,2}(?:\\.\\d)?)\\s*%?\\s*(?:-|to)\\s*(\\d{1,2}(?:\\.\\d)?)\\s*%\\s*" + W, "i"),
    /* "THC Level: 20-25%", "THC ranging from 20 to 26%" */
    new RegExp(W + "[^.%\\d]{0,45}?(\\d{1,2}(?:\\.\\d)?)\\s*%?\\s*(?:-|to)\\s*(\\d{1,2}(?:\\.\\d)?)\\s*%", "i"),
    /* "22% THC" */
    new RegExp("(\\d{1,2}(?:\\.\\d)?)\\s*%\\s*" + W, "i"),
    /* "THC comes in under 1%" */
    new RegExp(W + "[^.%\\d]{0,45}?(\\d{1,2}(?:\\.\\d)?)\\s*%", "i"),
  ];
  for (const r of re) {
    const m = text.match(r);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (!(hi > 0) || hi > 45 || (m[2] !== undefined && hi < lo)) continue;
    if (m[2] !== undefined) return { hi, label: lo + "-" + hi + "%" };
    const at = m.index || 0;
    const around = text.slice(Math.max(0, at - 45), at + m[0].length + 28);
    return { hi, label: (BELOW.test(around) ? "<" : "") + lo + "%" };
  }
  return null;
}

function terpene(text) {
  const t = text.toLowerCase();
  /* prefer a terpene sitting next to the words that mean "this is the main one" */
  const windows = t.match(/[^.]{0,90}(?:dominant|lead|leads|leading|primary|top|main)[^.]{0,90}/g) || [];
  for (const w of windows) {
    for (const tp of TERPENES) if (w.includes(tp)) return tp[0].toUpperCase() + tp.slice(1);
  }
  let best = null, at = Infinity;
  for (const tp of TERPENES) {
    const i = t.indexOf(tp);
    if (i >= 0 && i < at) { at = i; best = tp; }
  }
  return best ? best[0].toUpperCase() + best.slice(1) : "";
}

function tidyParent(s) {
  const v = String(s || "")
    .replace(/\s+/g, " ")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+(?:strain|genetics|cultivar|weed|cannabis)$/i, "")
    .trim();
  if (v.length < 2 || v.length > 34) return "";
  if (!/[a-z]/i.test(v)) return "";
  /* a parent name is a name, not a clause */
  if (/\b(?:that|which|this|these|when|with|from|known|makes|gives|produce)\b/i.test(v)) return "";
  return v;
}

function lineage(text) {
  const pats = [
    /cross(?:ing|ed)?\s+(?:of|between)\s+([A-Z][\w#'’\-. ]{1,32}?)\s+(?:and|x|×)\s+([A-Z][\w#'’\-. ]{1,32}?)(?=[.,;)]|\s+(?:strain|genetics|creates?|produces?|brings?|by|which|that|to|—|-)\b)/,
    /\b(?:parents?|genetics|lineage)\s*(?:are|is)?\s*[:—-]?\s*([A-Z][\w#'’\-. ]{1,32}?)\s*(?:x|×|X)\s*([A-Z][\w#'’\-. ]{1,32}?)(?=[.,;)\n]|$)/,
    /\b([A-Z][\w#'’\-. ]{2,30}?)\s+(?:x|×|X)\s+([A-Z][\w#'’\-. ]{2,30}?)(?=[.,;)]|\s+(?:cross|hybrid|strain|genetics)\b)/,
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (!m) continue;
    const a = tidyParent(m[1]), b = tidyParent(m[2]);
    if (a && b && a.toLowerCase() !== b.toLowerCase()) return a + " x " + b;
  }
  const m2 = text.match(/bred\s+from\s+(?:a\s+)?(?:combination\s+of\s+)?([A-Z][\w,'’\- ]{6,70}?)\s+(?:genetics|landrace)/);
  if (m2) {
    const v = m2[1].replace(/\s*,\s*and\s+/g, ", ").replace(/\s+and\s+/g, ", ").replace(/\s+/g, " ").trim();
    if (v.length >= 6 && v.length <= 70) return v;
  }
  return "";
}

function strainType(text) {
  const m = text.match(/\b(indica|sativa)[\s-]?dominant\s+hybrid\b/i);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + "-dominant Hybrid";
  const m2 = text.match(/\b(?:is|as)\s+an?\s+(indica|sativa|hybrid)\b/i);
  if (m2) return m2[1][0].toUpperCase() + m2[1].slice(1).toLowerCase();
  const m3 = text.match(/\b(?:type|category|classification)\s*[:—-]\s*(indica|sativa|hybrid)\b/i);
  if (m3) return m3[1][0].toUpperCase() + m3[1].slice(1).toLowerCase();
  const m4 = text.slice(0, 1600).match(/\b(indica|sativa|hybrid)\b/i);
  if (m4) return m4[1][0].toUpperCase() + m4[1].slice(1).toLowerCase();
  return "";
}

/* Does this page actually talk about the strain we asked for? A site that
   answers a miss with its blog index would otherwise hand us the facts of
   whatever strain happened to be featured that week. */
export function mentionsStrain(text, name) {
  const words = String(name || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 2 && !/^(the|and|weed|thc|cbd|top|shelf|gram|premium|exotic|indica|sativa|hybrid|strain)$/i.test(w));
  if (!words.length) return true;
  const head = text.slice(0, 4000).toLowerCase();
  return words.every((w) => head.includes(w.toLowerCase()));
}

export function harvestProse(html, name) {
  const text = stripHtml(html);
  if (text.length < 400) return null;
  if (!mentionsStrain(text, name)) return null;

  /* keep the negatives paragraph out of the effect meters */
  const cut = text.search(/\b(?:negative|adverse|side)\s+effects?\b/i);
  const positive = cut > 600 ? text.slice(0, cut) : text;

  const thc = pct(text, "thc");
  const cbd = pct(text, "cbd");
  const out = {
    type: strainType(text),
    thc: thc ? thc.label : "",
    thcNum: thc ? thc.hi : 0,
    cbd: cbd ? cbd.label : "",
    terpene: terpene(text),
    effects: rankVocab(positive, EFFECTS, 4),
    flavors: rankVocab(positive, FLAVORS, 4),
    lineage: lineage(text),
  };
  /* a page that yielded nothing but a guess at the category is not an answer */
  const solid = (out.thc ? 1 : 0) + (out.terpene ? 1 : 0) + (out.lineage ? 1 : 0) +
    (out.effects.length ? 1 : 0) + (out.flavors.length ? 1 : 0);
  if (solid < 2) return null;
  return out;
}

/* A POS product name is a strain wearing four adjectives — "(weed) Gushers
   Top Shelf 3.5g" is Gushers. Strip the grade, weight and category noise for
   anything a customer reads. If stripping empties it, keep the original: a
   strain really can be called "Exotic". */
const NAME_NOISE = /\b(?:thc|cbd|aaaa|aaa|top\s*shelf|topshelf|mid\s*grade|midgrade|premium|exotics?|house|special|strain|flowers?|weed|cannabis|bud|pack|tier|grade|indoor|outdoor|greenhouse)\b/gi;

export function cleanName(name) {
  const base = String(name || "").replace(/\([^)]*\)/g, " ");
  const s = base
    .replace(/\b\d+(?:\.\d+)?\s*(?:g|gr|gram|grams|oz|kg|mg|%)\b/gi, " ")
    .replace(/\b(?:thc|cbd)\s*[\d.\-]*\s*%?/gi, " ")
    .replace(NAME_NOISE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—,.:|]+|[\s\-–—,.:|]+$/g, "")
    .trim();
  if (/[a-z0-9]/i.test(s)) return s;
  return base.replace(/\s+/g, " ").trim() || String(name || "").trim();
}

/* Our sentence, built from the numbers — never their paragraph. */
export function describe(name, f) {
  const clean = cleanName(name);
  const bits = [];
  if (f.type) {
    const t = f.type.toLowerCase().replace(/^an?\s+/, "");
    bits.push((/^[aeiou]/.test(t) ? "an " : "a ") + t);
  }
  if (f.thc) bits.push("testing around " + f.thc + " THC");
  if (f.terpene) bits.push(f.terpene.toLowerCase() + " leading the terpene profile");
  let s = bits.length ? clean + " is " + bits.join(", ") + "." : clean + ".";
  if (f.lineage) s += " Bred from " + f.lineage + ".";
  if (f.effects && f.effects.length) {
    s += " Reported effects lean " + f.effects.slice(0, 3).map((e) => e.toLowerCase()).join(", ") + ".";
  }
  if (f.flavors && f.flavors.length) {
    s += " Expect " + f.flavors.slice(0, 3).map((e) => e.toLowerCase()).join(", ") + " on the palate.";
  }
  return s;
}
