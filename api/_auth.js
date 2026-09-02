import crypto from "node:crypto";

const ROLE_KEYS = [
  ["owner", "OWNER_KEY"],
  ["manager", "MANAGER_KEY"],
  ["professional-staff", "PROFESSIONAL_STAFF_KEY"],
  ["part-time-staff", "PART_TIME_STAFF_KEY"],
  ["professional-staff", "STAFF_KEY"],
];
const SESSION_PREFIX = "dsp1";

export function staffKey() { return process.env.STAFF_KEY || ""; }
export function staffConfigured() { return ROLE_KEYS.some(([, name]) => Boolean(process.env[name])); }
export function posSyncKey() { return process.env.POS_SYNC_KEY || process.env.WEBSITE_API_KEY || ""; }
export function safeEq(a, b) {
  const A = Buffer.from(String(a ?? "")), B = Buffer.from(String(b ?? ""));
  return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B);
}
function sessionSecret() { return process.env.STAFF_SESSION_SECRET || process.env.ADMIN_SECRET || ""; }
function sessionPayload(given) {
  const [prefix, body, sig] = String(given || "").split(".");
  const secret = sessionSecret(); if (prefix !== SESSION_PREFIX || !body || !sig || !secret) return null;
  const expected = crypto.createHmac("sha256", secret).update(prefix + "." + body).digest("base64url");
  if (!safeEq(sig, expected)) return null;
  try { const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return Number(payload.exp) > Date.now() ? payload : null; } catch { return null; }
}
export function createStaffSession(staff, hours = 12) {
  const secret = sessionSecret(); if (!secret) return "";
  const payload = Buffer.from(JSON.stringify({ id: staff.id || "environment", name: staff.name || "Staff", role: staff.role, exp: Date.now() + hours * 3600000 })).toString("base64url");
  const unsigned = SESSION_PREFIX + "." + payload;
  return unsigned + "." + crypto.createHmac("sha256", secret).update(unsigned).digest("base64url");
}
export function staffIdentity(given) {
  const session = sessionPayload(given); if (session) return { id: session.id, name: session.name, role: session.role };
  for (const [role, name] of ROLE_KEYS) {
    const configured = process.env[name] || "";
    if (configured && safeEq(given, configured)) return { id: "environment:" + name.toLowerCase(), name: role === "owner" ? "Owner" : role === "manager" ? "Manager" : "Staff", role };
  }
  return null;
}
export function staffRole(given) { return staffIdentity(given)?.role || ""; }
export function isManagementRole(role) { return role === "owner" || role === "manager"; }
export function isStaffKey(given) { return Boolean(staffRole(given)); }
export function keyFrom(req) { return req?.query?.key ?? req?.body?.key ?? req?.headers?.["x-staff-key"] ?? ""; }
export function isStaff(req) { return isStaffKey(keyFrom(req)); }
export function requireStaff(req, res, given) {
  const supplied = given === undefined ? keyFrom(req) : given;
  if (isStaffKey(supplied)) return true;
  if (!staffConfigured() && !sessionSecret()) return notConfigured(res, ["STAFF_KEY or a role-specific staff key"]);
  if (!isStaffKey(supplied)) { res.status(401).json({ error: "bad key" }); return false; }
  return true;
}
export function requireManagement(req, res) {
  if (!requireStaff(req, res)) return "";
  const role = staffRole(keyFrom(req));
  if (!isManagementRole(role)) { res.status(403).json({ error: "Owner or Manager access required" }); return ""; }
  return role;
}
export function requireEnv(res, names) {
  const missing = names.filter((n) => !process.env[n]);
  return missing.length ? notConfigured(res, missing) : true;
}
export function notConfigured(res, missing) {
  res.status(503).json({ error: "not configured", detail: `${missing.join(", ")} is not set on this deployment — see .env.example` });
  return false;
}
function hostOf(v) {
  const s = String(v ?? "").trim(); if (!s) return "";
  try { return new URL(s.includes("://") ? s : "https://" + s).host.toLowerCase(); } catch { return ""; }
}
export function sameOrigin(req) {
  const allowed = new Set(), self = hostOf(req?.headers?.["x-forwarded-host"] || req?.headers?.host);
  if (self) allowed.add(self);
  for (const extra of String(process.env.ALLOWED_ORIGIN || "").split(",")) { const h = hostOf(extra); if (h) allowed.add(h); }
  const origin = hostOf(req?.headers?.origin), referer = hostOf(req?.headers?.referer);
  if (!origin && !referer) return false;
  return origin ? allowed.has(origin) : allowed.has(referer);
}
export function requireSameOrigin(req, res) {
  if (sameOrigin(req)) return true;
  res.status(403).json({ error: "forbidden" }); return false;
}
