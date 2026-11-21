import { safeEq, makeBackofficeToken, staffIdentity, BACKOFFICE_PERMISSIONS } from "../_auth.js";

export default function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"method"});
  const password=process.env.BACKOFFICE_PASSWORD;
  if(!password||!process.env.ADMIN_SECRET) return res.status(503).json({error:"BackOffice authentication is not configured"});
  if(req.body?.action==="login"){
    if(!safeEq(req.body.password,password)) return res.status(401).json({error:"Incorrect password"});
    return res.status(200).json({token:makeBackofficeToken(),profile:{name:"BackOffice"},permissions:BACKOFFICE_PERMISSIONS});
  }
  if(req.body?.action==="verify"){
    const identity=staffIdentity(req);
    if(identity?.role!=="backoffice") return res.status(401).json({error:"Session expired"});
    return res.status(200).json({profile:{name:"BackOffice"},permissions:BACKOFFICE_PERMISSIONS});
  }
  return res.status(400).json({error:"unknown action"});
}
