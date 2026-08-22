/* Counting what happens on the website, without following anybody around.

   What is stored is a set of integers per day — "42 page views on 2026-08-22",
   "9 baskets started" — and nothing else. No cookie, no device id, no IP, no
   name, no path a single person took through the shop. Two visitors and one
   visitor who came back twice are the same two marks in the same box, and
   there is no way to tell them apart afterwards, by design: a counter that
   cannot be un-summed cannot leak anything about a customer.

   That is also why this does not sit behind the cookie bar. The bar governs
   what the site keeps ON the customer's device; these numbers are kept on the
   shop's own server and describe the shop, not the shopper. The one thing that
   does touch the device — the sessionStorage flag that tells a second page view
   apart from a second visit — degrades to "count it as a view only" when it is
   unavailable, so a private window or a blocked store loses a statistic rather
   than breaking anything.

   Keys look like  an:2026-08-22:views  and  an:2026-08-22:pg:home
   and expire after 400 days, so the shop keeps just over a year of history and
   then forgets on its own. */

import { bumpBy, getJSON } from "./_store.js";

const KEEP = 60 * 60 * 24 * 400;   // just over a year, then it expires itself

/* A closed list, because the browser is the thing sending these and anything
   it can name becomes a key in the shop's storage. An unknown event is
   dropped rather than counted under a name nobody chose. */
export const EVENTS = ["views", "visits", "carts", "checkouts", "chats", "spins"];

/* Likewise for pages: the six a customer can actually land on. Staff pages are
   deliberately absent — the shop's own traffic is not the shop's audience. */
export const PAGES = ["home", "food", "livehouse", "joint", "track", "other"];

const EVENT_SET = new Set(EVENTS);
const PAGE_SET = new Set(PAGES);

/** "2026-08-22" in Bangkok, whatever timezone the server thinks it is in.
    Vercel runs in UTC; a 7am Bangkok order belongs to that day, not the one
    before it, and the whole dashboard would be a day out at the edges. */
export function bkkDay(at = Date.now()) {
  return new Date(at + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The last n days, oldest first, ending today. */
export function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(bkkDay(now - i * 86400000));
  return out;
}

const key = (day, name) => `an:${day}:${name}`;
const pageKey = (day, page) => `an:${day}:pg:${page}`;

/**
 * Record one thing that happened. Never throws and never blocks the caller:
 * a storage hiccup must not cost a page view, let alone a sale.
 * @param {string[]} events  names from EVENTS; unknown names are ignored
 * @param {string}   page    a name from PAGES, or omitted
 */
export async function record(events, page) {
  const day = bkkDay();
  const jobs = [];
  for (const e of new Set(events || [])) {
    if (EVENT_SET.has(e)) jobs.push(bumpBy(key(day, e), 1, KEEP));
  }
  if (page && PAGE_SET.has(page)) jobs.push(bumpBy(pageKey(day, page), 1, KEEP));
  if (!jobs.length) return false;
  /* allSettled, not all: one counter failing must not lose the others, and the
     caller has already answered the browser by the time this resolves. */
  const done = await Promise.allSettled(jobs);
  return done.some((d) => d.status === "fulfilled");
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Read the counters back for a range of days.
 * Every key is fetched at once rather than in a loop: 30 days of 6 events and
 * 6 pages is a few hundred small reads, which is fine in parallel and slow
 * enough to notice one after another.
 * @returns {{days:string[], series:Object, totals:Object, pages:Object}}
 */
export async function readRange(days) {
  const list = lastDays(days);
  const wanted = [];
  for (const d of list) {
    for (const e of EVENTS) wanted.push({ d, kind: "e", name: e, k: key(d, e) });
    for (const p of PAGES) wanted.push({ d, kind: "p", name: p, k: pageKey(d, p) });
  }
  const got = await Promise.all(
    wanted.map((w) => getJSON(w.k).then((v) => num(v)).catch(() => 0))
  );

  const series = {};
  for (const e of EVENTS) series[e] = list.map(() => 0);
  const totals = Object.fromEntries(EVENTS.map((e) => [e, 0]));
  const pages = Object.fromEntries(PAGES.map((p) => [p, 0]));
  const at = Object.fromEntries(list.map((d, i) => [d, i]));

  wanted.forEach((w, i) => {
    const v = got[i];
    if (w.kind === "e") { series[w.name][at[w.d]] = v; totals[w.name] += v; }
    else pages[w.name] += v;
  });

  return { days: list, series, totals, pages };
}
