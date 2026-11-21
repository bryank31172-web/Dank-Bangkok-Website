import {requirePermission,hasPermission,staffIdentity} from '../_auth.js';
import {boConfigured,boSelect,enc} from '../_bo-db.js';
import {inventoryOverview,inventoryCommand,inventoryError} from '../_inventory.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(!requirePermission(req,res,'inventory_view'))return;
  if(req.method==='GET'&&req.query?.view==='overview'){
    try{return res.status(200).json(await inventoryOverview(req));}catch(error){return inventoryError(res,error);}
  }
  if(!boConfigured())return res.status(503).json({error:'ยังไม่ได้เชื่อมฐานข้อมูลสต็อก'});
  try{
    if(req.method==='GET'){
      const q=req.query||{},parts=['select=*','order=id.desc'];
      for(const [key,column] of [['item_type','item_type'],['item_key','item_key'],['store','store_id']])if(q[key])parts.push(column+'=eq.'+enc(q[key]));
      if(q.from)parts.push('created_at=gte.'+enc(q.from));
      if(q.to)parts.push('created_at=lte.'+enc(q.to));
      if(q.before_id&&/^\d+$/.test(q.before_id))parts.push('id=lt.'+q.before_id);
      const limit=Math.min(500,Math.max(1,Number(q.limit)||50));parts.push('limit='+(limit+1));
      const rows=await boSelect('bo_inventory_ledger',parts.join('&'))||[],page=rows.slice(0,limit);
      return res.status(200).json({rows:page,total:page.length,nextCursor:rows.length>limit?String(page.at(-1).id):null});
    }
    if(req.method!=='POST')return res.status(405).json({error:'method'});
    if(!requirePermission(req,res,'inventory_adjust'))return;
    const b=req.body||{};
    if(b.action==='register'){
      if(!hasPermission(staffIdentity(req),'settings'))return res.status(403).json({error:'ไม่มีสิทธิ์ตั้งค่าหน่วยสินค้า'});
      const precision=Number(b.precision);
      if(!['product','ingredient'].includes(b.item_type)||!String(b.item_key||'').trim()||!String(b.name||'').trim()||!String(b.unit||'').trim()||!Number.isInteger(precision)||precision<0||precision>3)return res.status(400).json({error:'ระบุสินค้า หน่วย และจำนวนทศนิยม 0–3 ให้ครบ'});
      return res.status(200).json(await inventoryCommand(req,'register',{
        item_type:b.item_type,item_key:String(b.item_key).slice(0,200),name:String(b.name).slice(0,200),sku:String(b.sku||'').slice(0,100),barcode:String(b.barcode||'').slice(0,100),category:String(b.category||'').slice(0,100),unit:String(b.unit).trim().slice(0,30),precision
      }));
    }
    const delta=Number(b.qty_delta);
    if(!['product','ingredient'].includes(b.item_type)||!b.item_key||!b.store_id||!Number.isFinite(delta)||delta===0||b.qty_delta===null||b.qty_delta===''||!['manual_adjust','waste','damage'].includes(b.reason))return res.status(400).json({error:'กรอกสินค้า สาขา จำนวน และเหตุผลให้ถูกต้อง'});
    return res.status(200).json(await inventoryCommand(req,'adjust',{item_type:b.item_type,item_key:b.item_key,store_id:b.store_id,qty_delta:delta,reason:b.reason,note:String(b.note||'').trim().slice(0,500),expected_ledger_id:b.expected_ledger_id}));
  }catch(error){return inventoryError(res,error);}
}
