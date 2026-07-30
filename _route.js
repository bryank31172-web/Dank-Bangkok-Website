/* Delivery ETA with automatic NEAREST-BRANCH selection.
   Products go out from several shops; when a customer shares a location we
   check drive time from every branch (Google Routes API) and quote the closest.

   Env:
     GOOGLE_MAPS_API_KEY  — key with the Routes API enabled
     DELIVERY_MODE        — "TWO_WHEELER" (motorbike, default) or "DRIVE"
     DELIVERY_PREP_MIN    — minutes added for prep/packing (default 15)
     SHOP_BRANCHES        — OPTIONAL JSON array to override branches.json, e.g.
                            [{"id":"pattanakarn","name":"...","origin":"13.70,100.65"}]
     SHOP_ORIGIN          — OPTIONAL single origin fallback if no branches file
     ROUTE_API_URL        — OPTIONAL your own endpoint (skips Google entirely)

   Each branch `origin` may be "lat,lng" (most accurate) or a plain address
   (Google geocodes it). branches.json ships with all four DANK shops.        */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PREP = () => Number(process.env.DELIVERY_PREP_MIN || 15);

function parseLoc(s) {
  const m = String(s || "").match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m ? { latLng: { latitude: +m[1], longitude: +m[2] } } : null;
}
function originField(origin) {
  const loc = parseLoc(origin);
  return loc ? { location: loc } : { address: String(origin || "") };
}

export function routeConfigured() {
  return Boolean(process.env.ROUTE_API_URL || process.env.GOOGLE_MAPS_API_KEY);
}

let _branchCache = null;
export async function getBranches() {
  if (_branchCache) return _branchCache;
  // 1) env override
  if (process.env.SHOP_BRANCHES) {
    try { const a = JSON.parse(process.env.SHOP_BRANCHES); if (Array.isArray(a) && a.length) return (_branchCache = a); } catch {}
  }
  // 2) bundled branches.json
  try {
    const raw = await readFile(join(process.cwd(), "branches.json"), "utf8");
    const a = JSON.parse(raw);
    if (Array.isArray(a) && a.length) return (_branchCache = a);
  } catch {}
  // 3) single origin fallback
  if (process.env.SHOP_ORIGIN) return (_branchCache = [{ id: "main", name: "DANK", origin: process.env.SHOP_ORIGIN }]);
  return (_branchCache = []);
}

// one Google Routes call: branch origin → customer destination
async function routeOne(origin, destination, key, mode) {
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: originField(origin),
        destination,
        travelMode: mode,
        routingPreference: "TRAFFIC_AWARE",
        languageCode: "th-TH",
        units: "METRIC",
      }),
    });
    if (!r.ok) return null;
    const route = (await r.json()).routes?.[0];
    if (!route) return null;
    const sec = parseInt(String(route.duration || "0").replace("s", ""), 10) || 0;
    return { sec, meters: route.distanceMeters ?? null };
  } catch { return null; }
}

/**
 * @returns {ok, minutes, travelMin, km, prep, branch:{id,name}, error?}
 * Picks the branch with the shortest travel time to the customer.
 */
export async function computeEta({ destLat, destLng, address } = {}) {
  const prep = PREP();

  // Your own endpoint takes over completely, if set
  if (process.env.ROUTE_API_URL) {
    try {
      const r = await fetch(process.env.ROUTE_API_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destLat, destLng, address }),
      });
      if (r.ok) {
        const j = await r.json();
        const travelMin = j.minutes ?? j.durationMin ?? (j.durationSec ? j.durationSec / 60 : null);
        const km = j.km ?? (j.distanceMeters ? j.distanceMeters / 1000 : null);
        if (travelMin != null) return { ok: true, travelMin: Math.round(travelMin), minutes: Math.round(travelMin) + prep, km: km != null ? +km.toFixed(1) : null, prep, branch: j.branch || null };
      }
    } catch {}
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, error: "no route provider configured" };

  const destination =
    destLat != null && destLng != null
      ? { location: { latLng: { latitude: +destLat, longitude: +destLng } } }
      : { address: String(address || "") };
  const mode = process.env.DELIVERY_MODE || "TWO_WHEELER";

  const branches = await getBranches();
  if (!branches.length) return { ok: false, error: "no branches configured" };

  // check every branch in parallel, keep the fastest
  const results = await Promise.all(
    branches.map(async (b) => ({ b, r: await routeOne(b.origin, destination, key, mode) }))
  );
  const viable = results.filter((x) => x.r).sort((a, b) => a.r.sec - b.r.sec);
  if (!viable.length) return { ok: false, error: "no route from any branch" };

  const best = viable[0];
  const travelMin = Math.round(best.r.sec / 60);
  const km = best.r.meters != null ? +(best.r.meters / 1000).toFixed(1) : null;
  return { ok: true, travelMin, minutes: travelMin + prep, km, prep, branch: { id: best.b.id, name: best.b.name } };
}

/** Friendly Thai + English ETA text (names the branch it ships from). */
export function etaText(eta) {
  if (!eta.ok) return "ขอโทษค่ะ ตอนนี้คำนวณเวลาจัดส่งอัตโนมัติไม่ได้ เดี๋ยวทีมงานแจ้งเวลาให้นะคะ 🙏";
  const from = eta.branch?.name ? `จากสาขา ${eta.branch.name} ` : "";
  const dist = eta.km != null ? ` (${eta.km} กม.)` : "";
  return (
    `🛵 ${from}ถึงคุณประมาณ ~${eta.minutes} นาที${dist}\n` +
    `รวมเวลาเตรียมของ ~${eta.prep} นาที + เดินทาง ~${eta.travelMin} นาที แล้วค่ะ 🌿\n` +
    `(Est. delivery ~${eta.minutes} min${eta.km != null ? `, ${eta.km} km` : ""}${eta.branch?.name ? ` from ${eta.branch.name}` : ""})`
  );
}
