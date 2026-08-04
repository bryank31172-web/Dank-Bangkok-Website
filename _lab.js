/* Certificates of analysis, as typed in by staff.

   The storefront card has two faces. With no certificate on file it renders an
   ESTIMATE derived from the strain database and says so in plain words. With a
   certificate it renders as a lab report: method, test date, lot number, heavy
   metal clearance, measured cannabinoids and measured terpenes. That second
   face is a claim the shop makes on its own behalf, so the numbers behind it
   have to come from somewhere real, and this is that somewhere — Bryan types
   what the certificate says, in staff.html#lab, and it lands here.

   Two things this file is careful about.

   1. NOTHING IS INVENTED ON THE WAY IN. Every field is optional except the
      cannabinoids, and a field that was left blank is dropped rather than
      defaulted. A report with no test date must show no test date; filling it
      with today's date would be the storefront lying with a straight face.

   2. THE TTL IS EXPLICIT. setJSON defaults to a fortnight, which is right for
      chat threads and very wrong for a certificate — the card would quietly
      fall back to the estimate two weeks after it was entered, with nobody
      touching anything. Five years is past the shelf life of any sample.

   Reports live in one JSON object keyed by product. That is a single read for
   the storefront (which needs all of them to paint any of them) and a
   read-modify-write for a save, which is safe here because the only writer is
   one person in the staff console — unlike the gift ledger, where two
   simultaneous orders on different instances were the whole problem.        */

import { getJSON, setJSON } from "./_store.js";

export const LAB_KEY = "lab:reports";
const TTL = 60 * 60 * 24 * 365 * 5;

/* Past this the object stops being a lab shelf and starts being a memory
   leak. The catalog is ~50 products; 500 is room for years of relabelling. */
const MAX_REPORTS = 500;

/* Matches labKind() in index.html. Anything else is stored as the storefront's
   own guess for that product, which is the sane fallback. */
const KINDS = ["flower", "extract", "vape", "edible", "preroll"];

/* Cannabinoid fields the card knows how to print, in the order it prints them.
   A key not in this list is dropped rather than passed through: the card would
   ignore it anyway, and storing it invites somebody to think it displays. */
const CANNABINOIDS = ["d9thc", "totalThc", "total", "thcv", "cbg", "cbc", "cbd", "cbn"];

const str = (v, n) => String(v ?? "").trim().slice(0, n);

/* Percentages, and only percentages. NaN, Infinity and "" all become null, so
   a field somebody tabbed through without filling in stays absent instead of
   printing "NaN%" under a letterhead. Negative is impossible; over 100 is a
   typo (an extra digit) rather than a very strong sample. */
function pct(v, max = 100) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

/** Product key: a product id from products.json, or the flattened product name. */
export const labKeyOf = (v) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64);

/* Returns a stored-shaped report, or null when there is not enough here to be
   one. "Not enough" means no cannabinoid reading: a card with a method and a
   date but no numbers would be a letterhead around an empty page, and worse,
   it would flip the product out of estimated mode while showing less. */
export function cleanReport(rec) {
  if (!rec || typeof rec !== "object") return null;

  const can = {};
  const src = rec.cannabinoids && typeof rec.cannabinoids === "object" ? rec.cannabinoids : {};
  for (const k of CANNABINOIDS) {
    const v = pct(src[k]);
    if (v !== null) can[k] = v;
  }
  if (!Object.keys(can).length) return null;

  const terpenes = (Array.isArray(rec.terpenes) ? rec.terpenes : [])
    .map((t) => ({ name: str(t?.name ?? t?.n, 40), pct: pct(t?.pct ?? t?.p, 20) }))
    .filter((t) => t.name && t.pct !== null)
    /* Sort before the cap, not after. The card shows the five dominant
       terpenes; capping first would keep whichever five happened to be typed
       into the top rows and silently drop a bigger one from row six. */
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  const out = { cannabinoids: can };
  const kind = str(rec.kind, 16).toLowerCase();
  if (KINDS.includes(kind)) out.kind = kind;

  /* Free text, kept short. The date is stored as typed rather than parsed: the
     shop writes 29/07/26 on its own paperwork and a certificate is a
     transcription, not a datetime. */
  const method = str(rec.method, 32);
  if (method) out.method = method;
  const tested = str(rec.tested, 24);
  if (tested) out.tested = tested;
  const sample = str(rec.sample, 40);
  if (sample) out.sample = sample;
  const lot = str(rec.lot, 16);
  if (lot) out.lot = lot;
  const aroma = str(rec.aroma, 400);
  if (aroma) out.aroma = aroma;

  /* Tri-state on purpose. true prints "free from lead · mercury · chromium";
     false means the sample was not screened for them; undefined means nobody
     said, and the card treats an unstated screen as done because that is what
     a full-panel certificate implies. Only an explicit false hides the line. */
  if (rec.metals === false || rec.metals === "false") out.metals = false;
  else if (rec.metals === true || rec.metals === "true") out.metals = true;

  if (terpenes.length) out.terpenes = terpenes;
  out.updated = new Date().toISOString().slice(0, 10);
  return out;
}

export async function getReports() {
  const stored = await getJSON(LAB_KEY);
  return stored && typeof stored === "object" && stored.reports ? stored.reports : {};
}

/** Saves one report. Returns { key, report } or null when the payload is thin. */
export async function saveReport(key, rec) {
  const k = labKeyOf(key);
  if (!k) return null;
  const report = cleanReport(rec);
  if (!report) return null;
  const reports = await getReports();
  if (!reports[k] && Object.keys(reports).length >= MAX_REPORTS) {
    throw new Error("too many reports");
  }
  reports[k] = report;
  await setJSON(LAB_KEY, { reports }, TTL);
  return { key: k, report };
}

/** Removes one report, flipping that product back to the estimated card. */
export async function deleteReport(key) {
  const k = labKeyOf(key);
  const reports = await getReports();
  if (!reports[k]) return false;
  delete reports[k];
  await setJSON(LAB_KEY, { reports }, TTL);
  return true;
}
