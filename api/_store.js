/* ============================================================
   Storage adapter — everything the site has to remember.
   Orders, members, wallets, the homepage edits, the POS menu cache.

   Three backends, tried in this order:

     1. Supabase Postgres  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
     2. Upstash Redis      UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
                           (Vercel's KV_REST_API_* names work too)
     3. memory             no configuration, and nothing survives a restart

   Everything above this line is a key/value store, so the interface is the
   same whichever one is live and no caller needs to know which it is.
   ============================================================ */

/* Values are read through here rather than off process.env directly, because
   the quickstart panels these get copied out of print them as
   KV_REST_API_TOKEN="AX4…" — quotes included. Paste that whole thing into a
   dashboard field and the token silently carries two extra characters, which
   the service answers with a flat 401 and no hint as to why. Trim the
   wrapper. */
const env = (name) => String(process.env[name] || "").trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();

const mem = globalThis.__dankMem || (globalThis.__dankMem = new Map());

/* A wrong credential used to take the whole site down: every getJSON threw, so
   /api/products answered 500 and the shop showed nothing at all. That is a
   worse failure than having no database, which the site is built to survive.
   So a backend that errors is treated as a backend that is absent — the
   request falls through to memory and still serves the customer — and the
   fault is remembered so /api/health can say out loud what is wrong. It is
   re-tried every 30s, which means correcting the value in the dashboard heals
   the site on its own, without a redeploy. */
const FAULT_COOLDOWN = 30_000;
let fault = null; // { at, msg }

export const storageFault = () => (fault ? fault.msg : "");
const noteFault = (e) => { fault = { at: Date.now(), msg: String((e && e.message) || e) }; };
const cooling = () => Boolean(fault && Date.now() - fault.at < FAULT_COOLDOWN);

/* ---------------------------------------------------------------- Supabase */

const SB_URL = (env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/+$/, "");
const SB_KEY = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_KEY") || env("SUPABASE_KEY");
const SB_REST = SB_URL ? `${SB_URL}/rest/v1` : "";

/* The publishable key and the secret key sit side by side on the API settings
   page and look equally like "the key". Handing over the publishable one is
   the worst case here, because site_kv has RLS on with no policies: reads come
   back 200 OK and empty rather than failing, so the site would look connected
   and quietly remember nothing forever. Name it instead. */
function keyIsPublishable(k) {
  if (/^sb_publishable_/.test(k)) return true;
  if (/^sb_secret_/.test(k)) return false;
  const parts = k.split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      return claims.role !== "service_role";
    } catch (_) { /* not a JWT we can read; let the request decide */ }
  }
  return false;
}

export const supabaseConfigured = () => Boolean(SB_URL && SB_KEY);
export const supabaseKeyIsPublishable = () => Boolean(SB_KEY && keyIsPublishable(SB_KEY));
const supabaseUsable = () => supabaseConfigured() && /^https?:\/\//i.test(SB_URL) && !supabaseKeyIsPublishable();

async function sb(path, init = {}) {
  const r = await fetch(`${SB_REST}${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

const sbExpiry = (ttlSeconds) =>
  ttlSeconds && ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;

/* ------------------------------------------------------------------- Redis */

/* Two ways a shop ends up with Redis, and they use different variable names.
   Copying the values out of the Upstash dashboard by hand gives the UPSTASH_
   names; installing Upstash from the Vercel Marketplace injects KV_REST_API_*
   and never creates the UPSTASH_ ones at all. Accept both — reading only the
   first pair meant the easy path silently did nothing. */
const URL_ = env("UPSTASH_REDIS_REST_URL") || env("KV_REST_API_URL") || env("REDIS_REST_URL");
const TOK = env("UPSTASH_REDIS_REST_TOKEN") || env("KV_REST_API_TOKEN") || env("REDIS_REST_TOKEN");

/* KV_URL and REDIS_URL sit right next to the REST pair in that same panel and
   look just as much like "the database address", but they are rediss:// socket
   URLs for a Redis client, not something fetch() can talk to. */
const REST_OK = /^https?:\/\//i.test(URL_);
export const storageConfigured = () => Boolean(URL_ && TOK) || supabaseConfigured();
export const storageUrlUsable = () => (supabaseConfigured() ? /^https?:\/\//i.test(SB_URL) : REST_OK);

const redisUsable = () => Boolean(URL_ && TOK) && REST_OK;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

/* ---------------------------------------------------------------- dispatch */

/* Which backend a request will actually use, or "" for memory. Supabase wins
   when both are set: it is the one a shop chooses deliberately, Redis tends to
   be left over from the marketplace click. */
export function storageBackend() {
  if (cooling()) return "";
  if (supabaseUsable()) return "supabase";
  if (redisUsable()) return "redis";
  return "";
}

export const usingRedis = () => storageBackend() !== "";
export const storageMode = () => storageBackend() || "memory";

/* Runs op against the live backend and never throws: {ok:true, v} on success,
   {ok:false} after recording the fault, so every caller falls through to the
   in-memory path and the customer still gets served. */
async function run(ops) {
  const backend = storageBackend();
  if (!backend) return { ok: false };
  try {
    const v = await ops[backend]();
    fault = null;
    return { ok: true, v };
  } catch (e) {
    noteFault(e);
    return { ok: false };
  }
}

const enc = encodeURIComponent;

export async function getJSON(key) {
  const r = await run({
    async supabase() {
      const rows = await sb(`/site_kv?key=eq.${enc(key)}&select=value,expires_at&limit=1`);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return null;
      /* Expired rows are filtered here rather than by the query, so a clock
         disagreement between Postgres and Node can never hide a live row. */
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;
      return row.value === undefined ? null : row.value;
    },
    async redis() {
      const v = await redis(["GET", key]);
      if (!v) return null;
      try { return JSON.parse(v); } catch (_) { return null; }
    },
  });
  if (r.ok) return r.v;
  return mem.has(key) ? JSON.parse(mem.get(key)) : null;
}

export async function setJSON(key, val, ttlSeconds = 60 * 60 * 24 * 14) {
  const r = await run({
    async supabase() {
      return sb("/site_kv", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          key,
          value: val === undefined ? null : val,
          expires_at: sbExpiry(ttlSeconds),
          updated_at: new Date().toISOString(),
        }]),
      });
    },
    async redis() {
      return redis(["SET", key, JSON.stringify(val), "EX", String(ttlSeconds)]);
    },
  });
  if (r.ok) return r.v;
  mem.set(key, JSON.stringify(val));
}

/* Counter used by the rate limiters. Redis INCR is atomic, which is what makes
   the limit hold when two requests from the same address land on different
   serverless instances at the same moment; the in-memory fallback is
   per-instance and best-effort, like everything else here without Upstash.
   Kept in its own map so a counter can never be mistaken for a JSON value. */
const counts = globalThis.__dankCounts || (globalThis.__dankCounts = new Map());

export async function bump(key, ttlSeconds) {
  const ttl = Math.max(1, Math.round(ttlSeconds));
  const r = await run({
    async supabase() {
      return Number(await sb("/rpc/site_kv_bump", {
        method: "POST",
        body: JSON.stringify({ p_key: key, p_by: 1, p_ttl: ttl }),
      }));
    },
    async redis() {
      const n = Number(await redis(["INCR", key]));
      if (n === 1) await redis(["EXPIRE", key, String(ttl)]);
      return n;
    },
  });
  if (r.ok) return r.v;

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

/* The same atomic increment for a counter that moves by more than one at a
   time — an order for two boxes consumes two of every gift — and that other
   code has to be able to READ and RESET.

   That last part is why this one does not use the `counts` map above. The gift
   ledger is displayed by giftStatus() with getJSON() and zeroed by a restock
   with setJSON(key, 0), so the increment has to land in the same keyspace as
   those two or the counter reads back as 0 forever on a deployment without
   Upstash. Under Redis there is no distinction to reconcile: INCRBY leaves the
   key holding "12", and JSON.parse("12") is 12.

   Ledger keys are long-lived, so EXPIRE is set only when the key was created
   by this call — otherwise every order would push the year-long window out by
   another year and the key would never be collected. */
export async function bumpBy(key, n = 1, ttlSeconds = 60 * 60 * 24 * 365) {
  const by = Math.round(Number(n) || 0);
  const ttl = Math.max(1, Math.round(ttlSeconds));
  const r = await run({
    async supabase() {
      return Number(await sb("/rpc/site_kv_bump", {
        method: "POST",
        body: JSON.stringify({ p_key: key, p_by: by, p_ttl: ttl }),
      }));
    },
    async redis() {
      const v = Number(await redis(["INCRBY", key, String(by)]));
      if (v === by) await redis(["EXPIRE", key, String(ttl)]);
      return v;
    },
  });
  if (r.ok) return r.v;

  let cur = 0;
  try {
    cur = Number(mem.has(key) ? JSON.parse(mem.get(key)) : 0) || 0;
  } catch (_) {
    cur = 0;
  }
  const next = cur + by;
  mem.set(key, JSON.stringify(next));
  return next;
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
