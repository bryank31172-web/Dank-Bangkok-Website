import {requirePermission} from '../_auth.js';
import {boConfigured,boSelect,enc} from '../_bo-db.js';
import {inventoryCommand,inventoryError} from '../_inventory.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(!requirePermission(req,res,req.method==='GET'?'inventory_view':'inventory_adjust'))return;
  if(!boConfigured())return res.status(503).json({error:'ยังไม่ได้เชื่อมฐานข้อมูลสต็อก'});
  try{
    if(req.method==='GET'){
      const parts=['select=*,lines:bo_stocktake_lines(*)','order=started_at.desc,id.desc','limit=100'];
      if(req.query?.store)parts.push('store_id=eq.'+enc(req.query.store));
      if(req.query?.status)parts.push('status=eq.'+enc(req.query.status));
      if(req.query?.id)parts.push('id=eq.'+enc(req.query.id));
      return res.status(200).json({rows:await boSelect('bo_stocktakes',parts.join('&'))||[],limit:100});
    }
    const b=req.body||{};
    if(req.method==='POST'&&!b.action){
      if(!b.store_id||!Array.isArray(b.items)||!b.items.length||b.items.length>200)return res.status(400).json({error:'เลือกสาขาและสินค้า 1–200 รายการ'});
      return res.status(200).json(await inventoryCommand(req,'count_start',{store_id:b.store_id,items:b.items,note:String(b.note||'').slice(0,500)}));
    }
    if(req.method==='PATCH'){
      if(!b.id||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>200||b.lines.some(l=>l.counted_qty!==null&&(l.counted_qty===''||!Number.isFinite(Number(l.counted_qty))||Number(l.counted_qty)<0)))return res.status(400).json({error:'กรอกจำนวนที่นับได้ให้ถูกต้อง เว้นว่างหมายถึงยังไม่นับ'});
      return res.status(200).json(await inventoryCommand(req,'count_save',{id:b.id,lines:b.lines}));
    }
    if(req.method==='POST'&&b.id&&['complete','cancel'].includes(b.action))return res.status(200).json(await inventoryCommand(req,b.action==='complete'?'count_complete':'count_cancel',{id:b.id}));
    return res.status(405).json({error:'method'});
  }catch(error){return inventoryError(res,error);}
}
