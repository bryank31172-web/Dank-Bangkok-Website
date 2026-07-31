/* Shared auth helpers for the /api endpoints.

   Every staff endpoint used to carry its own copy of
   `process.env.STAFF_KEY || "<some literal>"`. That literal ships inside the
   repo, so any deployment that forgot to set STAFF_KEY in Vercel could be
   opened by anybody who had read the source: the orders list, the member list,
   the live chat threads, the billable LINE pushes. Ten hand-written copies of
   the same comparison also meant ten chances to get it subtly wrong, and one of
   them (count.js) only guarded the GET.

   There is no fallback here any more. When STAFF_KEY is missing the endpoints
   answer 503 "not configured" and authenticate nobody. The check is a function
   call rather than a throw at module load on purpose — a throw during import on
   Vercel becomes an opaque 500 for that route, which makes a missing
   environment variable look like a broken deployment instead of a missing
   environment variable, and takes the route down even for the parts of it that
   need no key at all.                                                       */
import crypto from "node:crypto";

export function staffKey() {
  return process.env.STAFF_KEY || "";
}

export function staffConfigured() {
  return Boolean(staffKey());
}

/* Constant-time compare, so the key can't be rebuilt one character at a time by
   timing the 401s. timingSafeEqual throws on a length mismatch, hence the
   length test first — that leaks the length only, which is not the secret. */
export function safeEq(a, b) {
  const A = Buffer.from(String(a ?? "")), B = Buffer.from(String(b ?? ""));
  return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B);
}

/** True only when `given` matches a configured staff key. Unset key ⇒ always false. */
export function isStaffKey(given) {
  const k = staffKey();
  return Boolean(k) && safeEq(given, k);
}

/** Where the callers put the key: ?key= on GETs, body.key on POSTs, or a header. */
export function keyFrom(req) {
  return req?.query?.key ?? req?.body?.key ?? req?.headers?.["x-staff-key"] ?? "";
}

/** Soft check for the endpoints that merely show staff extras (e.g. /api/thread). */
export function isStaff(req) {
  return isStaffKey(keyFrom(req));
}

/* Guard for a staff-only branch. Returns true when the caller may proceed;
   otherwise it has ALREADY written the response, so use it as:
       if (!requireStaff(req, res)) return;                                   */
export function requireStaff(req, res, given) {
  if (!staffConfigured()) return notConfigured(res, ["STAFF_KEY"]);
  if (!isStaffKey(given === undefined ? keyFrom(req) : given)) {
    res.status(401).json({ error: "bad key" });
    return false;
  }
  return true;
}

/* Same fail-closed shape for the other single-purpose secrets (POS_SYNC_KEY,
   WEBHOOK_SECRET, the admin credentials): if the deployment never set them, the
   endpoint refuses everyone rather than falling back to a value from the repo. */
export function requireEnv(res, names) {
  const missing = names.filter((n) => !process.env[n]);
  return missing.length ? notConfigured(res, missing) : true;
}

export function notConfigured(res, missing) {
  res.status(503).json({
    error: "not configured",
    detail: `${missing.join(", ")} is not set on this deployment — see .env.example`,
  });
  return false;
}

function hostOf(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  try {
    return new URL(s.includes("://") ? s : "https://" + s).host.toLowerCase();
  } catch {
    return "";
  }
}

/* Gate for the endpoints a shopper's browser must be able to call but a
   stranger's curl must not — the Grok relay, the staff handoff fan-out, the
   payment-slip upload. They cannot take the staff key (customers don't have
   one), so instead we insist the request was made by a page served from this
   same deployment. A browser sends Origin on every cross-site POST and a
   Referer on page-initiated fetches; a script hitting the URL directly sends
   neither, which is the case we want to turn away. It is not a hard
   authentication boundary — headers can be forged outside a browser — it is the
   cheap half of the fix that stops the URL being usable by anyone who finds it.
   ALLOWED_ORIGIN (comma-separated) adds extra hosts, e.g. a preview domain. */
export function sameOrigin(req) {
  const allowed = new Set();
  const self = hostOf(req?.headers?.["x-forwarded-host"] || req?.headers?.host);
  if (self) allowed.add(self);
  for (const extra of String(process.env.ALLOWED_ORIGIN || "").split(",")) {
    const h = hostOf(extra);
    if (h) allowed.add(h);
  }
  const origin = hostOf(req?.headers?.origin);
  const referer = hostOf(req?.headers?.referer);
  if (!origin && !referer) return false;
  if (origin) return allowed.has(origin);
  return allowed.has(referer);
}

/** As above, but writes the 403 for you: `if (!requireSameOrigin(req,res)) return;` */
export function requireSameOrigin(req, res) {
  if (sameOrigin(req)) return true;
  res.status(403).json({ error: "forbidden" });
  return false;
}
