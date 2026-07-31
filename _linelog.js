/* DANK Custom Box — what comes free with it, and how many are left.

   A box is 28 grams of flower. Everything in the gift list below rides along
   free, so every box that goes out consumes one of each: a tin of hash, a
   brownie, a jelly, a pack of Backwoods, RAW papers, a tee and a hat. None of
   that was ever coming off a stock count, which is fine right up until the
   afternoon somebody promises a hat that isn't in the shop.

   Two rules shape this file.

   1. THE SALE NEVER BLOCKS. A box is several thousand baht of flower; refusing
      it because the free brownie ran out would be an expensive kind of tidy.
      Counters are allowed to go past their stock and the shortfall is reported
      to staff instead — on the stored order and in the Telegram/LINE ping — so
      somebody can substitute or apologise before the customer arrives.

   2. THE CUSTOMER DOESN'T DECIDE HOW MANY BOXES THEY BOUGHT. The count is
      recomputed here from the order's own flower weight. A browser that posts
      {boxes: 99} gets whatever 28-gram multiples it actually paid for, because
      otherwise the gift ledger is drainable by anyone with a text editor.

   Stock is held as an issued-counter rather than a decrementing number: Redis
   INCR is atomic across serverless instances, a "read 12, write 11" pair is
   not, and two boxes ordered in the same second on different instances is
   exactly the case that would otherwise lose a decrement. remaining = stock -
   issued, and restocking resets the counter.                                */

import { getJSON, setJSON, bumpBy } from "./_store.js";

export const CONFIG_KEY = "boxgifts:config";
export const issuedKey = (id) => "boxgift:issued:" + id;
const YEAR = 60 * 60 * 24 * 365;

/** Grams of flower that earn one box. */
export const DEFAULT_THRESHOLD = 28;

/* A customer can legitimately buy two boxes; ten is past any real order and
   stops a malformed or hostile payload from burning the whole ledger. */
export const MAX_BOXES = 10;

/* stock:null means "not tracked" — never short, never counted. That is the
   right default until Bryan has entered real numbers, because a made-up count
   would start reporting shortfalls that aren't real. */
export const DEFAULT_GIFTS = [
  { id: "hash",      emoji: "🎁", label: "1g premium hash",           sku: "", shId: "", stock: null },
  { id: "brownie",   emoji: "🍫", label: "Premium brownie",           sku: "", shId: "", stock: null },
  { id: "jelly",     emoji: "🍬", label: "Premium gummy jelly",       sku: "", shId: "", stock: null },
  { id: "backwoods", emoji: "🚬", label: "Backwoods 1 pack",          sku: "", shId: "", stock: null },
  { id: "papers",    emoji: "📜", label: "RAW Classic papers + tips", sku: "", shId: "", stock: null },
  { id: "tshirt",    emoji: "👕", label: "DANK premium T-shirt",      sku: "", shId: "", stock: null },
  { id: "hat",       emoji: "🧢", label: "DANK premium hat",          sku: "", shId: "", stock: null },
];

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function cleanGift(g, fallback = {}) {
  const id = String(g?.id ?? fallback.id ?? "").trim().slice(0, 32);
  if (!id) return null;
  return {
    id,
    emoji: String(g?.emoji ?? fallback.emoji ?? "🎁").slice(0, 8),
    label: String(g?.label ?? fallback.label ?? id).slice(0, 80),
    sku:   String(g?.sku   ?? fallback.sku   ?? "").slice(0, 64),
    shId:  String(g?.shId  ?? fallback.shId  ?? "").slice(0, 64),
    // null and "" both mean untracked; 0 means genuinely out of stock
    stock: g?.stock === null || g?.stock === "" || g?.stock === undefined
      ? (fallback.stock ?? null)
      : num(g.stock, null),
  };
}

/** Stored config if there is one, otherwise the defaults above. A saved list is
    authoritative — if Bryan deleted a gift it must not reappear on next deploy. */
export async function getGiftConfig() {
  const stored = await getJSON(CONFIG_KEY);
  const byId = Object.fromEntries(DEFAULT_GIFTS.map((g) => [g.id, g]));
  const gifts = Array.isArray(stored?.gifts) && stored.gifts.length
    ? stored.gifts.map((g) => cleanGift(g, byId[String(g?.id ?? "")] || {})).filter(Boolean)
    : DEFAULT_GIFTS.map((g) => ({ ...g }));
  const threshold = Math.max(1, num(stored?.threshold, DEFAULT_THRESHOLD));
  return { gifts, threshold, updatedAt: num(stored?.updatedAt, 0) };
}

export async function saveGiftConfig(gifts, threshold) {
  const byId = Object.fromEntries(DEFAULT_GIFTS.map((g) => [g.id, g]));
  const clean = (Array.isArray(gifts) ? gifts : [])
    .slice(0, 30)
    .map((g) => cleanGift(g, byId[String(g?.id ?? "")] || {}))
    .filter(Boolean);
  const cfg = {
    gifts: clean,
    threshold: Math.max(1, num(threshold, DEFAULT_THRESHOLD)),
    updatedAt: Date.now(),
  };
  await setJSON(CONFIG_KEY, cfg, YEAR);
  return cfg;
}

/** Config plus live issued/remaining for each gift. */
export async function giftStatus() {
  const cfg = await getGiftConfig();
  const gifts = await Promise.all(
    cfg.gifts.map(async (g) => {
      const issued = num(await getJSON(issuedKey(g.id)), 0);
      const tracked = g.stock !== null && g.stock !== undefined;
      return {
        ...g,
        issued,
        tracked,
        remaining: tracked ? g.stock - issued : null,
        short: tracked ? g.stock - issued <= 0 : false,
      };
    })
  );
  return { ...cfg, gifts };
}

/* ---- how many boxes an order actually contains -------------------------- */

/* Mirror of the storefront's gramsOf(). Deliberately a copy rather than an
   import: the storefront is a single HTML file with no module boundary, and a
   server that trusts the client's arithmetic is the bug this whole file exists
   to avoid. Kept textually close so the two stay easy to compare. */
const FLOWER_CATS = ["Exotics", "Topshelf", "Midgrade", "Premium", "Flowers", "Flower"];

export function gramsOfItem(it) {
  if (!it || it.bonus) return 0; // ladder/first-order freebies don't earn a box
  // Older cached pages post no category at all, and the storefront sends
  // `category: c.category || ""` — so an empty string means "unknown", not
  // "not flower". Treating "" as a real category would zero out genuine
  // flower. Falling back to "does the option read as a weight" keeps those
  // orders working; edibles and merch carry piece options, so they don't
  // slip in.
  const cat = it.category == null ? "" : String(it.category).trim();
  if (cat && !FLOWER_CATS.includes(cat)) return 0;
  const L = String(it.option ?? it.tierLabel ?? "").toLowerCase().replace(/½/g, "0.5");
  const m = L.match(/([\d.]+)\s*g/);
  const g = m ? parseFloat(m[1]) : L.includes("joint") ? 1 : 0;
  const qty = num(it.qty, 1);
  return (g || 0) * (qty > 0 ? qty : 1);
}

export function flowerGrams(items) {
  return (Array.isArray(items) ? items : []).reduce((s, it) => s + gramsOfItem(it), 0);
}

/** Boxes earned by an order, from its own weight. The client's opinion is not consulted. */
export function boxesInOrder(items, threshold = DEFAULT_THRESHOLD) {
  const g = flowerGrams(items);
  const t = Math.max(1, num(threshold, DEFAULT_THRESHOLD));
  return { grams: Math.round(g * 100) / 100, boxes: Math.min(MAX_BOXES, Math.floor(g / t)) };
}

/* ---- issuing ------------------------------------------------------------ */

/** Atomically consume `boxes` of every gift. Never refuses; reports shortfalls.
    Returns [] when boxes < 1 so callers can use the length as "is this a box order". */
export async function issueGifts(boxes) {
  const n = Math.max(0, Math.min(MAX_BOXES, Math.floor(num(boxes, 0))));
  if (n < 1) return [];
  const cfg = await getGiftConfig();
  return Promise.all(
    cfg.gifts.map(async (g) => {
      let issued;
      try {
        issued = await bumpBy(issuedKey(g.id), n, YEAR);
      } catch (e) {
        // A ledger that can't be written must not lose the order. Report it as
        // unknown rather than silently claiming the gift was set aside.
        console.error("gift counter failed for", g.id, e.message);
        return { ...g, qty: n, remaining: null, short: false, error: true };
      }
      const tracked = g.stock !== null && g.stock !== undefined;
      const remaining = tracked ? g.stock - issued : null;
      return { ...g, qty: n, remaining, short: tracked && remaining < 0 };
    })
  );
}

/** Set a gift's stock to an absolute number and zero its issued counter. */
export async function restock(id, stock) {
  const cfg = await getGiftConfig();
  const i = cfg.gifts.findIndex((g) => g.id === id);
  if (i < 0) return null;
  cfg.gifts[i] = { ...cfg.gifts[i], stock: stock === null ? null : Math.max(0, num(stock, 0)) };
  await saveGiftConfig(cfg.gifts, cfg.threshold);
  await setJSON(issuedKey(id), 0, YEAR);
  return cfg.gifts[i];
}

/** One line per gift for a staff-facing alert, with the short ones called out. */
export function giftAlertLines(lines) {
  return (lines || [])
    .map((g) => {
      const qty = g.qty > 1 ? ` ×${g.qty}` : "";
      if (g.error) return `${g.emoji} ${g.label}${qty} (count unavailable)`;
      if (g.short) return `⚠️ ${g.emoji} ${g.label}${qty} — SHORT by ${Math.abs(g.remaining)}`;
      if (g.remaining === null) return `${g.emoji} ${g.label}${qty}`;
      return `${g.emoji} ${g.label}${qty} — ${g.remaining} left`;
    })
    .join("\n");
}
