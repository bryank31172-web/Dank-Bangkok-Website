import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { safeEq } from "./_auth.js";

const STORE_KEY = "staff:accounts:v1";
const TTL = 60 * 60 * 24 * 365 * 10;
export const ROLE_PERMISSIONS = Object.freeze({
  owner: ["*"],
  manager: ["orders", "dashboard", "sales", "announcement_read", "products", "announcements", "staff_manage", "promotions"],
  professional: ["orders", "dashboard", "announcement_read"],
  parttime: ["orders", "dashboard", "announcement_read"],
});
export const ROLE_LABELS = Object.freeze({
  owner: "Owner",
  manager: "Manager",
  professional: "Professional Staff",
  parttime: "Part-time Staff",
});
const secret = () => process.env.STAFF_SESSION_SECRET || process.env.ADMIN_SECRET || "";
const hashKey = (key) => crypto.createHmac("sha256", secret()).update(String(key)).digest("hex");
export const validStaffKey = (key) => {
  const s=String(key||"");
  return s.length>=12&&s.length<=128&&/[A-Z]/.test(s)&&/[a-z]/.test(s)&&/[0-9]/.test(s)&&/[!@#$%^&*?_+\-]/.test(s)&&! /\s/.test(s);
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
  return { id:a.id, name:a.name, phone:a.phone||"", startDate:a.startDate||"", salary:Number(a.salary)||0, role:a.role, active:a.active !== false, createdAt:a.createdAt, updatedAt:a.updatedAt };
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
    const key=makeKey(), row={id:crypto.randomUUID(),name,phone:"",startDate:"",salary:0,role,keyHash:hashKey(key),active:true,createdAt:now,updatedAt:now};
    generated.push({id:row.id,name,role,key});
    return row;
  });
  await saveAccounts(accounts);
  return { accounts, generated };
}
export async function createAccount(actor, name, requestedRole, details={}) {
  let role=String(requestedRole||"parttime").toLowerCase();
  if (!ROLE_PERMISSIONS[role]) role="parttime";
  if(actor.role==="manager"&&role==="owner") role="parttime";
  const clean=String(name||"").trim().slice(0,80);
  if(!clean) throw new Error("full name required");
  const phone=String(details.phone||"").trim().slice(0,30);
  const startDate=/^\d{4}-\d{2}-\d{2}$/.test(String(details.startDate||""))?String(details.startDate):"";
  const salary=Math.max(0,Math.round(Number(details.salary)||0));
  const rows=await listAccounts(), now=Date.now(), key=makeKey();
  const row={id:crypto.randomUUID(),name:clean,phone,startDate,salary,role,keyHash:hashKey(key),active:true,createdAt:now,updatedAt:now};
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
  if(!validStaffKey(key)) throw new Error("key must be 12–128 characters with uppercase, lowercase, a number, and a special symbol");
  if(!actor?.id||actor.id==="legacy-owner") throw new Error("use the named Bryan account to change its individual key");
  const rows=await listAccounts(), row=rows.find(a=>a.id===actor.id);
  if(!row) throw new Error("account not found");
  row.keyHash=hashKey(key); row.updatedAt=Date.now(); row.active=true;
  await saveAccounts(rows); return publicAccount(row);
}
export async function setAccountKey(actor,id,key) {
  if(!validStaffKey(key)) throw new Error("key must be 12–128 characters with uppercase, lowercase, a number, and a special symbol");
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
  if(actor.role==="manager"&&(row.role==="owner"||role==="owner")) throw new Error("forbidden");
  if(row.id===actor.id&&role!==row.role) throw new Error("you cannot change your own role");
  row.name=name;
  row.phone=String(details.phone||"").trim().slice(0,30);
  row.startDate=/^\d{4}-\d{2}-\d{2}$/.test(String(details.startDate||""))?String(details.startDate):"";
  row.salary=Math.max(0,Math.round(Number(details.salary)||0));
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
  if(!ROLE_PERMISSIONS[role]) throw new Error("invalid role");
  const rows=await listAccounts(), row=rows.find(a=>a.id===id);
  if(!row) throw new Error("account not found");
  if(!mayManage(actor,row)||row.id===actor.id) throw new Error("forbidden");
  if(actor.role==="manager"&&(row.role==="owner"||role==="owner")) throw new Error("forbidden");
  row.role=role; row.updatedAt=Date.now(); await saveAccounts(rows);
  return publicAccount(row);
}
