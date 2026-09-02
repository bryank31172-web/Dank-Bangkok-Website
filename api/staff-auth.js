import { requireEnv, staffIdentity, hasPermission } from "./_auth.js";
import { authenticateAccountKey, seedInitialAccounts, listAccounts, publicAccount, createAccount, resetAccount, setAccountActive, setAccountRole, ROLE_PERMISSIONS, ROLE_LABELS } from "./_staff-accounts.js";

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
      if(legacy && b.key===legacy){
        const seeded=await seedInitialAccounts(); generated=seeded.generated;
      }
      const account=await authenticateAccountKey(b.key);
      if(!account) return res.status(401).json({error:"bad key"});
      const token=staffIdentity.makeToken(account);
      return res.status(200).json({ok:true,token,profile:publicAccount(account),permissions:ROLE_PERMISSIONS[account.role]||[],generated});
    }
    const actor=staffIdentity(req);
    if(!actor) return res.status(401).json({error:"session expired"});
    if(b.action==="verify") return res.status(200).json({ok:true,profile:publicAccount(actor),permissions:ROLE_PERMISSIONS[actor.role]||[]});
    if(!hasPermission(actor,"staff_manage")) return res.status(403).json({error:"forbidden"});
    if(b.action==="list"){
      const rows=(await listAccounts()).map(publicAccount);
      return res.status(200).json({ok:true,accounts:rows,roles:ROLE_LABELS,canAssignRoles:actor.role==="owner"});
    }
    if(b.action==="create"){
      const out=await createAccount(actor,b.name,b.role);
      return res.status(200).json({ok:true,...out});
    }
    if(b.action==="reset"){
      const out=await resetAccount(actor,b.id);
      return res.status(200).json({ok:true,...out});
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
