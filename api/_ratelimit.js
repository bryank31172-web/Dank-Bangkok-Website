/* Per-IP rate limiting for the endpoints anyone on the internet can reach.

   /api/order, /api/chat and the phone lookups take no key by design, so before
   this there was nothing between a script and the store: a few hundred junk
   orders used to push every real order out of the staff console's only listing,
   and /api/chat was an open, billable relay to xAI for anyone who found the URL.

   Fixed windows, counted in the shared store, so the count survives across
   serverless instances when Upstash is configured (without it the counter is
   per-instance and best-effort, exactly like the rest of _store.js). Windows
   are approximate on purpose — a caller can get up to 2× the limit across a
   window boundary, which is fine for the abuse this is here to stop and much
   cheaper than a sliding log.                                               */
import { bump } from "./_store.js";

/** The caller's address as Vercel presents it, falling back to the socket. */
export function clientIp(req) {
  const fwd = req?.headers?.["x-forwarded-for"];
  const first = Array.isArray(fwd) ? String(fwd[0] || "") : String(fwd || "").split(",")[0];
  return first.trim() || req?.headers?.["x-real-ip"] || req?.socket?.remoteAddress || "unknown";
}

export async function rateLimit(req, name, limit, windowSec) {
  const window = Math.max(1, Math.floor(windowSec));
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / window);
  try {
    const n = await bump(`rl:${name}:${bucket}:${clientIp(req)}`, window * 2);
    return { ok: n <= limit, count: n, limit, retryAfter: window - (nowSec % window) };
  } catch (e) {
    // If the store is unreachable we let the request through rather than shut
    // the shop: a broken Redis should not stop customers ordering. It is logged
    // so a limiter that has quietly stopped limiting is visible.
    console.error("rate limit unavailable:", e.message);
    return { ok: true, count: 0, limit, retryAfter: 0 };
  }
}

/** Guard form: `if (!(await requireRate(req, res, "order", 12, 600))) return;` */
export async function requireRate(req, res, name, limit, windowSec) {
  const r = await rateLimit(req, name, limit, windowSec);
  if (r.ok) return true;
  const retry = Math.max(1, r.retryAfter);
  res.setHeader("Retry-After", String(retry));
  res.status(429).json({ error: "too many requests", retryAfter: retry });
  return false;
}
