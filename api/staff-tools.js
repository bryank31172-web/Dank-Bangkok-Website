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
      const picture=text(b.picture,350000),strain=text(b.strain,120),cannabisType=text(b.cannabisType||b.type,60),description=text(b.description,1000),freeDelivery=b.freeDelivery===true||b.freeDelivery==="true",discountEnabled=b.discountEnabled===true||b.discountEnabled==="true",discountType=b.discountType==="fixed"?"fixed":"percent",discountValue=Math.max(0,number(b.discountValue)),available=b.available!==false&&b.available!=="false";if(picture&&!/^(https?:\/\/|\/|data:image\/)/i.test(picture))return res.status(400).json({error:"picture must be a URL"});
      if(discountEnabled&&(discountValue<=0||(discountType==="percent"&&discountValue>100)))return res.status(400).json({error:"invalid discount"});
      if(action==="create"&&number(b.price)<=0)return res.status(400).json({error:"product price required"});
      if(action==="create") ov.added.push({id:"web-"+crypto.randomUUID(),name,category:text(b.category,80)||"Other",price:Math.max(0,number(b.price)),image:picture,picture,strain,strainType:cannabisType,type:cannabisType,description,freeDelivery,discountEnabled,discountType,discountValue,available,_hidden:!available,_source:"staff"});
      else if(action==="delete") {const ai=ov.added.findIndex(x=>x.id===id);if(ai>=0)ov.added.splice(ai,1);else ov.products[id]={...(ov.products[id]||{}),_hidden:true};}
      else if(action==="delivery") {const ai=ov.added.findIndex(x=>x.id===id);if(ai>=0)ov.added[ai]={...ov.added[ai],freeDelivery};else ov.products[id]={...(ov.products[id]||{}),freeDelivery};}
      else {const changes={name,category:text(b.category,80)||"Other",price:Math.max(0,number(b.price)),image:picture,picture,strain,strainType:cannabisType,type:cannabisType,description,freeDelivery,discountEnabled,discountType,discountValue,available,_hidden:!available};const ai=ov.added.findIndex(x=>x.id===id);if(ai>=0)ov.added[ai]={...ov.added[ai],...changes};else ov.products[id]={...(ov.products[id]||{}),...changes};}
    }
    await setJSON("admin:overrides",ov,YEAR);try{await bustMenu()}catch{}
    return res.status(200).json({ok:true});
  }catch(e){return res.status(500).json({error:"request failed"});}
}
