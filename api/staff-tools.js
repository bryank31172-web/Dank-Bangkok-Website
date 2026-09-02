import crypto from "node:crypto";
import { requirePermission } from "./_auth.js";
import { getJSON, setJSON } from "./_store.js";
import { getMenu, bustMenu } from "./_menu.js";

const YEAR=60*60*24*365;
const text=(v,n=160)=>String(v??"").trim().slice(0,n);
const number=(v)=>Number.isFinite(Number(v))?Number(v):0;
const permissionFor=(section)=>section==="products"?"products":section==="promotions"?"promotions":"announcements";

export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Staff-Key, Authorization");
  if(req.method==="OPTIONS") return res.status(204).end();
  const section=String(req.query?.section||req.body?.section||"");
  if(!["products","promotions","announcements"].includes(section)) return res.status(400).json({error:"invalid section"});
  const permission=section==="announcements"&&req.method==="GET"?"announcement_read":permissionFor(section);
  if(!requirePermission(req,res,permission)) return;
  try{
    if(req.method==="GET"){
      if(section==="products") return res.status(200).json({ok:true,products:(await getMenu()).data});
      if(section==="announcements") return res.status(200).json({ok:true,announcements:(await getJSON("staff:announcements"))||[]});
      const ov=(await getJSON("admin:overrides"))||{};
      return res.status(200).json({ok:true,promotions:ov.promos||{}});
    }
    if(req.method!=="POST") return res.status(405).json({error:"method"});
    const b=req.body||{}, action=String(b.action||"");
    if(section==="announcements"){
      let rows=(await getJSON("staff:announcements"))||[];
      if(action==="delete") rows=rows.filter(x=>x.id!==b.id);
      else {const row={id:b.id||crypto.randomUUID(),title:text(b.title,100),message:text(b.message,1000),updatedAt:Date.now()};if(!row.title||!row.message)return res.status(400).json({error:"title and message required"});const i=rows.findIndex(x=>x.id===row.id);if(i<0)rows.unshift(row);else rows[i]=row;}
      await setJSON("staff:announcements",rows.slice(0,100),YEAR);return res.status(200).json({ok:true,announcements:rows});
    }
    const ov=(await getJSON("admin:overrides"))||{};ov.products=ov.products&&typeof ov.products==="object"?ov.products:{};ov.added=Array.isArray(ov.added)?ov.added:[];ov.promos=ov.promos&&typeof ov.promos==="object"?ov.promos:{};
    if(section==="promotions"){
      const code=text(b.code,30).toUpperCase().replace(/[^A-Z0-9_-]/g,"");
      if(!code)return res.status(400).json({error:"promotion code required"});
      if(action==="delete") delete ov.promos[code]; else ov.promos[code]={type:["pct","fixed","freedelivery"].includes(b.type)?b.type:"pct",value:number(b.value),min:number(b.min),desc:text(b.desc,160)};
    } else {
      const id=text(b.id,120), name=text(b.name,120);if(!id&&!name)return res.status(400).json({error:"product required"});
      if(action==="create") ov.added.push({id:"web-"+crypto.randomUUID(),name,category:text(b.category,80)||"Other",price:number(b.price),stock:number(b.stock),_source:"staff"});
      else if(action==="delete") {const ai=ov.added.findIndex(x=>x.id===id);if(ai>=0)ov.added.splice(ai,1);else ov.products[id]={...(ov.products[id]||{}),_hidden:true};}
      else ov.products[id]={...(ov.products[id]||{}),name,category:text(b.category,80),price:number(b.price),stock:number(b.stock),_hidden:false};
    }
    await setJSON("admin:overrides",ov,YEAR);try{await bustMenu()}catch{}
    return res.status(200).json({ok:true});
  }catch(e){return res.status(500).json({error:"request failed"});}
}
