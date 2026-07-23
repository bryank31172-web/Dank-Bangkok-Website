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

export async function indexAdd(id, key = "threads:index") {
  const idx = (await getJSON(key)) || [];
  if (!idx.includes(id)) idx.unshift(id);
  await setJSON(key, idx.slice(0, 200));
}

export async function indexList(key = "threads:index") {
  return (await getJSON(key)) || [];
}
