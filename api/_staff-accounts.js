import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { safeEq } from "./_auth.js";

const STORE_KEY = "staff:accounts:v1";
const TTL = 60 * 60 * 24 * 365 * 10;
export const ROLE_PERMISSIONS = Object.freeze({
  owner: ["*"],
  manager: ["orders", "products", "announcements", "staff_manage", "promotions"],
  professional: ["orders"],
  parttime: ["orders"],
});
export const ROLE_LABELS = Object.freeze({
  owner: "Owner",
  manager: "Manager",
  professional: "Professional Staff",
  parttime: "Part-time Staff",
});
const secret = () => process.env.STAFF_SESSION_SECRET || process.env.ADMIN_SECRET || "";
const hashKey = (key) => crypto.createHmac("sha256", secret()).update(String(key)).digest("hex");
const makeKey = () => "dank_" + crypto.randomBytes(24).toString("base64url");

export async function listAccounts() {
  const rows = await getJSON(STORE_KEY);
  return Array.isArray(rows) ? rows : [];
}
async function saveAccounts(rows) {
  await setJSON(STORE_KEY, rows, TTL);
}
export function publicAccount(a) {
  return { id:a.id, name:a.name, role:a.role, active:a.active !== false, createdAt:a.createdAt, updatedAt:a.updatedAt };
}
export async function authenticateAccountKey(given) {
  const legacy = process.env.STAFF_KEY || "";
  if (legacy && safeEq(given, legacy)) return { id:"legacy-owner", name:"Bryan", role:"owner", active:true, legacy:true };
  if (!given || !secret()) return null;
  const h = hashKey(given);
  const rows = await listAccounts();
  const found = rows.find(a => a.active !== false && safeEq(h, a.keyHash));
  return found || null;
}
export async function seedInitialAccounts() {
  const existing = await listAccounts();
  if (existing.length) return { accounts:existing, generated:[] };
  const now=Date.now(), specs=[
    ["Bryan","owner"],
    ["Bank","manager"],
    ["Mon","professional"],
  ];
  const generated=[], accounts=specs.map(([name,role])=>{
    const key=makeKey(), row={id:crypto.randomUUID(),name,role,keyHash:hashKey(key),active:true,createdAt:now,updatedAt:now};
    generated.push({id:row.id,name,role,key});
    return row;
  });
  await saveAccounts(accounts);
  return { accounts, generated };
}
export async function createAccount(actor, name, requestedRole) {
  let role=String(requestedRole||"parttime").toLowerCase();
  if (!ROLE_PERMISSIONS[role]) role="parttime";
  if(actor.role!=="owner") role="parttime";
  const clean=String(name||"").trim().slice(0,80);
  if(!clean) throw new Error("name required");
  const rows=await listAccounts(), now=Date.now(), key=makeKey();
  const row={id:crypto.randomUUID(),name:clean,role,keyHash:hashKey(key),active:true,createdAt:now,updatedAt:now};
  rows.push(row); await saveAccounts(rows);
  return {account:publicAccount(row),key};
}
function mayManage(actor,target){
  if(actor.role==="owner") return true;
  return actor.role==="manager" && target.role!=="owner";
}
export async function resetAccount(actor,id) {
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  if(!mayManage(actor,row)) throw new Error("forbidden");
  const key=makeKey(); row.keyHash=hashKey(key); row.updatedAt=Date.now(); row.active=true;
  await saveAccounts(rows); return {account:publicAccount(row),key};
}
export async function setAccountActive(actor,id,active) {
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  if(!mayManage(actor,row) || row.id===actor.id) throw new Error("forbidden");
  row.active=Boolean(active); row.updatedAt=Date.now(); await saveAccounts(rows);
  return publicAccount(row);
}
export async function setAccountRole(actor,id,role) {
  if(actor.role!=="owner") throw new Error("forbidden");
  if(!ROLE_PERMISSIONS[role]) throw new Error("invalid role");
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  row.role=role; row.updatedAt=Date.now(); await saveAccounts(rows);
  return publicAccount(row);
}
