import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";

const STORE_KEY = "staff:directory";
const TTL = 60 * 60 * 24 * 365 * 5;
const pepper = () => process.env.STAFF_KEY_PEPPER || process.env.STAFF_SESSION_SECRET || process.env.ADMIN_SECRET || "";
export const validRoles = new Set(["manager", "professional-staff", "part-time-staff"]);
export function directoryConfigured() { return Boolean(pepper()); }
export function hashStaffKey(key) { return crypto.createHmac("sha256", pepper()).update(String(key || "")).digest("hex"); }
export function newStaffKey() { return "dank_" + crypto.randomBytes(24).toString("base64url"); }
export async function getStaffDirectory() { const rows = await getJSON(STORE_KEY); return Array.isArray(rows) ? rows : []; }
export async function saveStaffDirectory(rows) { await setJSON(STORE_KEY, rows, TTL); }
export async function findStaffByKey(key) {
  if (!directoryConfigured() || !key) return null;
  const target = hashStaffKey(key), rows = await getStaffDirectory();
  for (const row of rows) if (row.active !== false && row.keyHash && crypto.timingSafeEqual(Buffer.from(row.keyHash), Buffer.from(target))) return row;
  return null;
}
