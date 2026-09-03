import crypto from "node:crypto";
import { requireEnv, staffIdentity, hasPermission, safeEq } from "./_auth.js";
import { authenticateAccountKey, seedInitialAccounts, listAccounts, publicAccount, createAccount, updateAccount, deleteAccount, resetAccount, setOwnAccountKey, setAccountKey, setAccountActive, setAccountRole, ROLE_PERMISSIONS, ROLE_LABELS } from "./_staff-accounts.js";
import { getJSON, setJSON } from "./_store.js";

const PRESENCE_TTL=180, ONLINE_WINDOW=120000;
const presenceKey=id=>"staff:presence:"+id;
async function markPresence(account,online=true){if(!account?.id||account.id==="legacy-owner")return;await setJSON(presenceKey(account.id),{lastSeen:online?Date.now():0},PRESENCE_TTL);}

export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Staff-Key, Authorization");
  if(req.method==="OPTIONS") return res.status(204).end();
  if(req.method!=="POST") return res.status(405).json({error:"method"});
  if(!requireEnv(res,["ADMIN_SECRET"])) return;
  try{
    const b=req.body||{};
    if(b.action==="login"){
      let generated=[];
      const legacy=process.env.STAFF_KEY||"";
      let account=null;
      if(b.email||b.password){
        if(!requireEnv(res,["ADMIN_EMAIL","ADMIN_PASSWORD","ADMIN_SECRET"])) return;
        const email=String(b.email||"").trim().toLowerCase();
        const expectedEmail=String(process.env.ADMIN_EMAIL||"").trim().toLowerCase();
        const givenHash=crypto.createHash("sha256").update(String(b.password||"")).digest("hex");
        const expectedHash=crypto.createHash("sha256").update(String(process.env.ADMIN_PASSWORD||"")).digest("hex");
        if(!safeEq(email,expectedEmail)||!safeEq(givenHash,expectedHash)) return res.status(401).json({error:"wrong email or password"});
        const seeded=await seedInitialAccounts(); generated=seeded.generated;
        account=seeded.accounts.find(a=>a.role==="owner"&&a.active!==false)||null;
      } else if(legacy && safeEq(b.key,legacy)){
        const seeded=await seedInitialAccounts(); generated=seeded.generated;
      }
      if(!account) account=await authenticateAccountKey(b.key);
      if(!account) return res.status(401).json({error:"bad key"});
      const token=staffIdentity.makeToken(account);
      await markPresence(account);
      return res.status(200).json({ok:true,token,profile:publicAccount(account),permissions:ROLE_PERMISSIONS[account.role]||[],generated});
    }
    const actor=staffIdentity(req);
    if(!actor) return res.status(401).json({error:"session expired"});
    if(b.action==="verify"||b.action==="heartbeat"){await markPresence(actor);return res.status(200).json({ok:true,profile:publicAccount(actor),permissions:ROLE_PERMISSIONS[actor.role]||[]});}
    if(b.action==="offline"){await markPresence(actor,false);return res.status(200).json({ok:true});}
    if(b.action==="setself"){
      const account=await setOwnAccountKey(actor,String(b.key||""));
      return res.status(200).json({ok:true,account});
    }
    if(b.action==="contactlist"){
      if(!["professional","parttime"].includes(actor.role)) return res.status(403).json({error:"forbidden"});
      const accounts=await listAccounts();
      const rows=await Promise.all(accounts.filter(a=>a.active!==false).map(async account=>{const presence=await getJSON(presenceKey(account.id)),lastSeen=Number(presence?.lastSeen)||0;return {id:account.id,name:account.name,phone:account.phone||"",role:account.role,online:Date.now()-lastSeen<ONLINE_WINDOW};}));
      return res.status(200).json({ok:true,accounts:rows});
    }
    if(!hasPermission(actor,"staff_manage")) return res.status(403).json({error:"forbidden"});
    if(b.action==="list"){
      const accounts=(await listAccounts()).map(publicAccount);
      const rows=await Promise.all(accounts.map(async account=>{const presence=await getJSON(presenceKey(account.id));const lastSeen=Number(presence?.lastSeen)||0;return {...account,lastSeen,online:account.active!==false&&Date.now()-lastSeen<ONLINE_WINDOW};}));
      return res.status(200).json({ok:true,accounts:rows,roles:ROLE_LABELS,canAssignRoles:actor.role==="owner"});
    }
    if(b.action==="create"){
      const out=await createAccount(actor,b.name,b.role,{phone:b.phone,startDate:b.startDate,salary:b.salary});
      return res.status(200).json({ok:true,...out});
    }
    if(b.action==="update"){
      const account=await updateAccount(actor,b.id,{name:b.name,phone:b.phone,startDate:b.startDate,salary:b.salary,role:b.role,active:b.active});
      return res.status(200).json({ok:true,account});
    }
    if(b.action==="delete"){
      const account=await deleteAccount(actor,b.id);
      return res.status(200).json({ok:true,account});
    }
    if(b.action==="reset"){
      const out=await resetAccount(actor,b.id);
      return res.status(200).json({ok:true,...out});
    }
    if(b.action==="setkey"){
      const account=await setAccountKey(actor,b.id,String(b.key||""));
      return res.status(200).json({ok:true,account});
    }
    if(b.action==="active"){
      const account=await setAccountActive(actor,b.id,b.active);
      return res.status(200).json({ok:true,account});
    }
    if(b.action==="role"){
      const account=await setAccountRole(actor,b.id,String(b.role||""));
      return res.status(200).json({ok:true,account});
    }
    return res.status(400).json({error:"unknown action"});
  }catch(e){
    const status=/forbidden/.test(e.message)?403:400;
    return res.status(status).json({error:e.message||"request failed"});
  }
}
