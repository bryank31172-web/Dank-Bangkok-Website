import {requirePermission} from '../_auth.js';
import {boConfigured,boSelect,enc} from '../_bo-db.js';
import {inventoryCommand,inventoryError} from '../_inventory.js';
import {supplyCommand,supplyError,supplyEvents} from '../_supply.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(!requirePermission(req,res,req.method==='GET'?'inventory_view':'inventory_adjust'))return;
  if(!boConfigured())return res.status(503).json({error:'ยังไม่ได้เชื่อมฐานข้อมูลสต็อก'});
  try{
    if(req.method==='GET'){
      const parts=['select=*,lines:bo_stock_transfer_lines(*)','order=created_at.desc,id.desc'];
      if(req.query?.store)parts.push(`or=(from_store_id.eq.${enc(req.query.store)},to_store_id.eq.${enc(req.query.store)})`);
      if(req.query?.status)parts.push('status=eq.'+enc(req.query.status));
      if(req.query?.id)parts.push('id=eq.'+enc(req.query.id));
      return res.status(200).json({rows:await boSelect('bo_stock_transfers',parts.join('&'))||[],...(req.query?.id?{events:await supplyEvents('transfer',req.query.id)}:{})});
    }
    if(req.method!=='POST')return res.status(405).json({error:'method'});
    const b=req.body||{};
    if(b.action){
      if(!b.id||!['dispatch','receive','close','cancel'].includes(b.action))return res.status(400).json({error:'เลือกส่งสินค้า รับสินค้า ปิดผลต่าง หรือยกเลิก'});
      if(['receive','close'].includes(b.action)){
        if(!Number.isSafeInteger(b.expected_revision)||b.expected_revision<0)return res.status(400).json({error:'โหลดเอกสารล่าสุดก่อนรับสินค้า'});
        if(b.action==='receive'&&(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>200||b.lines.some(l=>!l||!Number.isFinite(l.qty_received)||l.qty_received<=0)))return res.status(400).json({error:'ระบุจำนวนรับจริงอย่างน้อยหนึ่งรายการ'});
        try{return res.status(200).json(await supplyCommand(req,'transfer_'+b.action,{id:b.id,expected_revision:b.expected_revision,note:String(b.note||'').slice(0,500),...(b.action==='receive'?{lines:b.lines}:{})}));}catch(error){return supplyError(res,error);}
      }
      return res.status(200).json(await inventoryCommand(req,'transfer_'+b.action,{id:b.id}));
    }
    if(!b.from_store_id||!b.to_store_id||b.from_store_id===b.to_store_id||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>200||b.lines.some(l=>!Number.isFinite(Number(l.qty))||Number(l.qty)<=0))return res.status(400).json({error:'เลือกสาขาต้นทางและปลายทางต่างกัน พร้อมจำนวนที่มากกว่าศูนย์'});
    return res.status(200).json(await inventoryCommand(req,'transfer_start',{from_store_id:b.from_store_id,to_store_id:b.to_store_id,lines:b.lines}));
  }catch(error){return inventoryError(res,error);}
}
