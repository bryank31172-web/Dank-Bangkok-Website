import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { requirePermission, staffIdentity } from "./_auth.js";

const KEY="staff:announcements:v1", TTL=60*60*24*365*10;
const clean=(v,n=500)=>String(v||"").trim().slice(0,n);
export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Staff-Key, Authorization");
  if(req.method==="OPTIONS") return res.status(204).end();
  if(!requirePermission(req,res,"announcements")) return;
  try{
    const rows=Array.isArray(await getJSON(KEY))?await getJSON(KEY):[];
    if(req.method==="GET") return res.status(200).json({announcements:rows});
    if(req.method!=="POST") return res.status(405).json({error:"method"});
    const b=req.body||{}, actor=staffIdentity(req), now=Date.now();
    if(b.action==="create"){
      const title=clean(b.title,120),body=clean(b.body,2000);
      if(!title||!body)return res.status(400).json({error:"title and message required"});
      rows.unshift({id:crypto.randomUUID(),title,body,createdAt:now,updatedAt:now,author:actor.name});
    }else{
      const row=rows.find(x=>x.id===b.id);
      if(!row)return res.status(404).json({error:"not found"});
      if(b.action==="update"){row.title=clean(b.title,120);row.body=clean(b.body,2000);row.updatedAt=now;row.author=actor.name;}
      else if(b.action==="delete"){rows.splice(rows.indexOf(row),1);}
      else return res.status(400).json({error:"unknown action"});
    }
    await setJSON(KEY,rows.slice(0,100),TTL);
    return res.status(200).json({ok:true,announcements:rows});
  }catch(e){return res.status(500).json({error:"server"});}
}
