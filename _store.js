/* ============================================================
   Thread storage adapter.
   Production: Upstash Redis (free tier) — set
     UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
   (upstash.com → create Redis DB → REST API section, 2 minutes).
   Without them: in-memory store — fine for local testing, but on
   Vercel serverless memory isn't shared between instances, so set
   Upstash before going live with staff chat.
   ============================================================ */

const URL_ = process.env.UPSTASH_REDIS_REST_URL || "";
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const mem = globalThis.__dankMem || (globalThis.__dankMem = new Map());

export const usingRedis = () => Boolean(URL_ && TOK);

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

export async function getJSON(key) {
  if (usingRedis()) {
    const v = await redis(["GET", key]);
    return v ? JSON.parse(v) : null;
  }
  return mem.has(key) ? JSON.parse(mem.get(key)) : null;
}

export async function setJSON(key, val, ttlSeconds = 60 * 60 * 24 * 14) {
  const s = JSON.stringify(val);
  if (usingRedis()) return redis(["SET", key, s, "EX", String(ttlSeconds)]);
  mem.set(key, s);
}

/* Counter used by the rate limiters. Redis INCR is atomic, which is what makes
   the limit hold when two requests from the same address land on different
   serverless instances at the same moment; the in-memory fallback is
   per-instance and best-effort, like everything else here without Upstash.
   Kept in its own map so a counter can never be mistaken for a JSON value. */
const counts = globalThis.__dankCounts || (globalThis.__dankCounts = new Map());

export async function bump(key, ttlSeconds) {
  if (usingRedis()) {
    const n = Number(await redis(["INCR", key]));
    if (n === 1) await redis(["EXPIRE", key, String(Math.max(1, Math.round(ttlSeconds)))]);
    return n;
  }
  const now = Date.now();
  if (counts.size > 5000) for (const [k, v] of counts) if (v.exp <= now) counts.delete(k);
  const rec = counts.get(key);
  if (!rec || rec.exp <= now) {
    counts.set(key, { n: 1, exp: now + ttlSeconds * 1000 });
    return 1;
  }
  rec.n += 1;
  return rec.n;
}

/* How many ids stay in the live index, and how many are kept behind it.
   These used to be one number, 200, and anything past it was dropped on the
   floor by `idx.slice(0, 200)` on every single add. The staff console's Orders
   tab reads this index and nothing else, so the 201st order silently deleted
   the oldest one from the only place staff could see it — and since POST
   /api/order needs no key, a few hundred junk orders were enough to erase a
   real day's work. Now the overflow is moved to a companion archive index
   instead of being discarded, so an id can fall off the first page but never
   out of the system. */
const INDEX_LIVE_MAX = 2000;
const INDEX_ARCHIVE_MAX = 20000;
const archiveKey = (key) => key + ":archive";

export async function indexAdd(id, key = "threads:index") {
  const idx = (await getJSON(key)) || [];
  if (idx.includes(id)) return;
  idx.unshift(id);
  if (idx.length > INDEX_LIVE_MAX) {
    const overflow = idx.splice(INDEX_LIVE_MAX); // the oldest ids on the live page
    const ak = archiveKey(key);
    const archived = (await getJSON(ak)) || [];
    // Both lists are newest-first and everything overflowing is newer than
    // anything already archived, so concatenating in this order keeps the sort.
    await setJSON(ak, overflow.concat(archived).slice(0, INDEX_ARCHIVE_MAX));
  }
  await setJSON(key, idx);
}

export async function indexList(key = "threads:index", { includeArchive = false } = {}) {
  const live = (await getJSON(key)) || [];
  if (!includeArchive) return live;
  return live.concat((await getJSON(archiveKey(key))) || []);
}
