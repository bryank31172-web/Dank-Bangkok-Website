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

/* The shared key between the website and BRYAN POS.

   Two names, one secret. The website has always called it POS_SYNC_KEY, but
   the POS's own "🔑 Generate" button (Settings → Website / E-commerce) tells
   the shop to save the value it just made as WEBSITE_API_KEY - so an owner who
   follows the POS's own instructions ends up with a key the website never
   reads, a menu that never syncs, and nothing anywhere saying why. Accepting
   both names costs nothing: neither has a default, so an unset deployment is
   still an unauthenticated one. POS_SYNC_KEY wins if somehow both are set. */
export function posSyncKey() {
  return process.env.POS_SYNC_KEY || process.env.WEBSITE_API_KEY || "";
}

/* Constant-time compare, so the key can't be rebuilt one character at a time by
   timing the 401s. timingSafeEqual throws on a length mismatch, hence the
   length test first — that leaks the length only, which is not the secret. */
export function safeEq(a, b) {
  const A = Buffer.from(String(a ?? "")), B = Buffer.from(String(b ?? ""));
  return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B);
}

const STAFF_ROLE_PERMISSIONS = Object.freeze({
  owner:["*"],
  manager:["orders","dashboard","sales","announcement_read","products","announcements","staff_manage","promotions"],
  professional:["orders","announcement_read"],
  parttime:["orders","announcement_read"],
});
const staffSecret=()=>process.env.STAFF_SESSION_SECRET||process.env.ADMIN_SECRET||"";
const b64u=(v)=>Buffer.from(v).toString("base64url");
const staffSign=(payload)=>b64u(crypto.createHmac("sha256",staffSecret()).update(payload).digest());
function readStaffToken(token){
  if(!staffSecret()||!token||typeof token!=="string"||!token.includes(".")) return null;
  const [payload,sig]=token.split(".",2);
  if(!safeEq(sig,staffSign(payload))) return null;
  try{
    const p=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(!p.id||!p.role||!p.exp||Date.now()>=p.exp||!STAFF_ROLE_PERMISSIONS[p.role]) return null;
    return {id:p.id,name:p.name||"Staff",role:p.role,active:true};
  }catch{return null;}
}
function identityFromCredential(given){
  const k=staffKey();
  if(k&&safeEq(given,k)) return {id:"legacy-owner",name:"Bryan",role:"owner",active:true,legacy:true};
  return readStaffToken(given);
}
export function hasPermission(identity,permission){
  if(!identity) return false;
  const list=STAFF_ROLE_PERMISSIONS[identity.role]||[];
  return list.includes("*")||list.includes(permission);
}
export function staffIdentity(req){
  return identityFromCredential(keyFrom(req));
}
staffIdentity.makeToken=function(account){
  if(!staffSecret()) throw new Error("ADMIN_SECRET is not configured");
  const payload=b64u(JSON.stringify({id:account.id,name:account.name,role:account.role,exp:Date.now()+1000*60*60*12}));
  return payload+"."+staffSign(payload);
};

/** True for the recovery key or a valid signed individual staff session. */
export function isStaffKey(given) {
  return Boolean(identityFromCredential(given));
}

/** Where the callers put the key: bearer/header first, then legacy query/body. */
export function keyFrom(req) {
  const auth=String(req?.headers?.authorization||"");
  const bearer=/^Bearer\s+(.+)$/i.exec(auth)?.[1];
  return bearer ?? req?.headers?.["x-staff-key"] ?? req?.query?.key ?? req?.body?.key ?? "";
}

export function isStaff(req, permission) {
  const identity=staffIdentity(req);
  return permission ? hasPermission(identity,permission) : Boolean(identity);
}

export function requirePermission(req,res,permission){
  if(!staffConfigured()&&!staffSecret()) return notConfigured(res,["STAFF_KEY or ADMIN_SECRET"]);
  const identity=staffIdentity(req);
  if(!identity){res.status(401).json({error:"bad key"});return false;}
  if(permission&&!hasPermission(identity,permission)){res.status(403).json({error:"forbidden"});return false;}
  return true;
}

/* Backward-compatible guard. New role-sensitive endpoints should name a permission. */
export function requireStaff(req,res,given) {
  if(given!==undefined){
    if(!identityFromCredential(given)){res.status(401).json({error:"bad key"});return false;}
    return true;
  }
  return requirePermission(req,res,null);
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
