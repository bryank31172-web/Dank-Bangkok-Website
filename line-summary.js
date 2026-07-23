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

function revOf(data) {
  // Hash the fields that matter for "did the menu change": stock + price.
  const s = data
    .map((p) => `${p.id}:${p.stock}:${p.price ?? p.priceTiers?.[0]?.price ?? ""}`)
    .join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

async function fetchUpstream() {
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

export async function getMenu(force = false) {
  const now = Date.now();
  const cached = await getJSON("menu:cache");
  if (!force && cached && now - cached.at < TTL) return cached;

  const { data, source } = await fetchUpstream();
  const rev = revOf(data);
  const changedAt = cached && cached.rev === rev ? cached.changedAt : now;
  const rec = { data, rev, source, at: now, changedAt };
  try { await setJSON("menu:cache", rec, 60 * 60 * 24); } catch (e) {}
  return rec;
}

export async function bustMenu() {
  try { await setJSON("menu:cache", null, 1); } catch (e) {}
}
