import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { safeEq } from "./_auth.js";

const STORE_KEY = "staff:accounts:v1";
const TTL = 60 * 60 * 24 * 365 * 10;
/* Must match STAFF_ROLE_PERMISSIONS in _auth.js — see the comment there for why
   there are two copies. This one is what validates a role when an account is
   created/edited; that one is what a request is actually checked against. */
export const ROLE_PERMISSIONS = Object.freeze({
  owner: ["*"],
  manager: ["orders", "dashboard", "sales", "announcement_read", "products", "announcements", "staff_manage", "promotions",
    "inventory_view", "inventory_adjust", "suppliers", "purchasing", "expenses", "food_ops", "kitchen_tickets", "settings"],
  professional: ["orders", "dashboard", "announcement_read", "inventory_view", "kitchen_tickets"],
  parttime: ["orders", "dashboard", "announcement_read"],
  kitchen: ["dashboard", "announcement_read", "kitchen_tickets", "food_ops"],
});
export const ROLE_LABELS = Object.freeze({
  owner: "Owner",
  manager: "Manager",
  professional: "Professional Staff",
  parttime: "Part-time Staff",
  kitchen: "Kitchen Staff",
});

/* Per-account scope overrides, on top of the role's own list — this is what
   closes the gap with StoreHub's fully granular per-module checkboxes
   (docs/dank-backoffice/STOREHUB_FEATURE_ANALYSIS.md, Module H) without
   replacing the existing role system: a role still sets a sensible default,
   and an owner/manager can additionally grant one BackOffice scope to one
   person (e.g. a trusted Part-time Staff member who runs stock counts but
   shouldn't get the rest of Manager's access) instead of promoting them to a
   whole new role. Deliberately scoped to BackOffice's own permissions only —
   extending it to the storefront/orders scopes is a bigger change this list
   doesn't try to make. */
export const ASSIGNABLE_EXTRA_SCOPES = Object.freeze([
  "inventory_view", "inventory_adjust", "suppliers", "purchasing",
  "expenses", "food_ops", "kitchen_tickets", "settings",
]);
const secret = () => process.env.STAFF_SESSION_SECRET || process.env.ADMIN_SECRET || "";
const hashKey = (key) => crypto.createHmac("sha256", secret()).update(String(key)).digest("hex");
export const validStaffKey = (key) => {
  const s=String(key||"");
  return s.length>=8&&s.length<=128&&/[A-Z]/.test(s)&&/[a-z]/.test(s)&&/[0-9]/.test(s)&&/[!@#$%^&*?_+\-]/.test(s)&&! /\s/.test(s);
};
const makeKey = () => "Dk!" + crypto.randomInt(0,10) + crypto.randomBytes(24).toString("base64url");
export async function listAccounts() {
  const rows = await getJSON(STORE_KEY);
  return Array.isArray(rows) ? rows : [];
}
async function saveAccounts(rows) {
  await setJSON(STORE_KEY, rows, TTL);
}
export function publicAccount(a) {
  return { id:a.id, name:a.name, phone:a.phone||"", role:a.role, active:a.active !== false, scopes:Array.isArray(a.scopes)?a.scopes:[], createdAt:a.createdAt, updatedAt:a.updatedAt };
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
    const key=makeKey(), row={id:crypto.randomUUID(),name,phone:"",role,keyHash:hashKey(key),active:true,createdAt:now,updatedAt:now};
    generated.push({id:row.id,name,role,key});
    return row;
  });
  await saveAccounts(accounts);
  return { accounts, generated };
}
export async function createAccount(actor, name, requestedRole, details={}) {
  let role=String(requestedRole||"parttime").toLowerCase();
  if (!ROLE_PERMISSIONS[role]) role="parttime";
  if(actor.role==="manager") role="parttime";
  const clean=String(name||"").trim().slice(0,80);
  if(!clean) throw new Error("full name required");
  const phone=String(details.phone||"").trim().slice(0,30);
  const rows=await listAccounts(), now=Date.now(), key=makeKey();
  const row={id:crypto.randomUUID(),name:clean,phone,role,keyHash:hashKey(key),active:true,createdAt:now,updatedAt:now};
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
export async function setOwnAccountKey(actor,key) {
  if(!validStaffKey(key)) throw new Error("key must be 8–128 characters with uppercase, lowercase, a number, and a special symbol");
  if(!actor?.id||actor.id==="legacy-owner") throw new Error("use the named Bryan account to change its individual key");
  const rows=await listAccounts(), row=rows.find(a=>a.id===actor.id);
  if(!row) throw new Error("account not found");
  row.keyHash=hashKey(key); row.updatedAt=Date.now(); row.active=true;
  await saveAccounts(rows); return publicAccount(row);
}
export async function setAccountKey(actor,id,key) {
  if(!validStaffKey(key)) throw new Error("key must be 8–128 characters with uppercase, lowercase, a number, and a special symbol");
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  if(!mayManage(actor,row)) throw new Error("forbidden");
  row.keyHash=hashKey(key); row.updatedAt=Date.now(); row.active=true;
  await saveAccounts(rows); return publicAccount(row);
}
export async function setAccountActive(actor,id,active) {
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  if(!mayManage(actor,row) || row.id===actor.id) throw new Error("forbidden");
  row.active=Boolean(active); row.updatedAt=Date.now(); await saveAccounts(rows);
  return publicAccount(row);
}
export async function updateAccount(actor,id,details={}) {
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  if(!mayManage(actor,row)) throw new Error("forbidden");
  const name=String(details.name||"").trim().slice(0,80);
  if(!name) throw new Error("full name required");
  let role=String(details.role||row.role);
  if(!ROLE_PERMISSIONS[role]) throw new Error("invalid role");
  if(actor.role==="manager"&&(row.role==="owner"||role!==row.role)) throw new Error("forbidden");
  if(row.id===actor.id&&role!==row.role) throw new Error("you cannot change your own role");
  row.name=name;
  row.phone=String(details.phone||"").trim().slice(0,30);
  row.role=role;
  if(details.active!==undefined) row.active=Boolean(details.active);
  row.updatedAt=Date.now(); await saveAccounts(rows);
  return publicAccount(row);
}
export async function deleteAccount(actor,id) {
  const rows=await listAccounts(), i=rows.findIndex(a=>a.id===id);
  if(i<0) throw new Error("account not found");
  const row=rows[i];
  if(row.id===actor.id||!mayManage(actor,row)) throw new Error("forbidden");
  if(row.role==="owner") throw new Error("owner accounts cannot be deleted");
  rows.splice(i,1); await saveAccounts(rows);
  return publicAccount(row);
}
export async function setAccountRole(actor,id,role) {
  if(actor.role!=="owner") throw new Error("forbidden");
  if(!ROLE_PERMISSIONS[role]) throw new Error("invalid role");
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  if(!mayManage(actor,row)||row.id===actor.id) throw new Error("forbidden");
  if(actor.role==="manager"&&(row.role==="owner"||role==="owner")) throw new Error("forbidden");
  row.role=role; row.updatedAt=Date.now(); await saveAccounts(rows);
  return publicAccount(row);
}
export async function setAccountScopes(actor,id,scopes) {
  if(actor.role!=="owner"&&actor.role!=="manager") throw new Error("forbidden");
  const clean=Array.isArray(scopes)?[...new Set(scopes)].filter(s=>ASSIGNABLE_EXTRA_SCOPES.includes(s)):[];
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  if(!mayManage(actor,row)) throw new Error("forbidden");
  /* A manager can grant scopes but never hand out more than their own role
     already has — otherwise a manager could use this to self-escalate a
     teammate past what a manager is themselves allowed to do. Owner has "*"
     and is exempt from this check. */
  if(actor.role!=="owner"){
    const actorScopes=new Set(ROLE_PERMISSIONS[actor.role]||[]);
    const over=clean.filter(s=>!actorScopes.has(s));
    if(over.length) throw new Error(`forbidden: cannot grant scope(s) you don't have yourself: ${over.join(", ")}`);
  }
  row.scopes=clean; row.updatedAt=Date.now(); await saveAccounts(rows);
  return publicAccount(row);
}
