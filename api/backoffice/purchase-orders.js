import {requirePermission,hasPermission,staffIdentity} from '../_auth.js';
import {boConfigured,boSelect,boRpc,enc} from '../_bo-db.js';
import {supplyCommand,supplyError,supplyEvents} from '../_supply.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(!requirePermission(req,res,req.method==='GET'?'inventory_view':'purchasing'))return;
 if(!boConfigured())return res.status(503).json({error:'ยังไม่ได้เชื่อมฐานข้อมูลสต็อก'});
 const identity=staffIdentity(req),canPurchase=hasPermission(identity,'purchasing');
 try{
  if(req.method==='GET'){
   const q=req.query||{},limit=50,offset=Math.max(0,Math.floor(Number(q.offset)||0));
   const parts=['select=*,revision,lines:bo_purchase_order_lines(*)','order=created_at.desc,id.desc'];
   for(const [key,col] of [['id','id'],['store','store_id'],['supplier','supplier_id'],['status','status']])if(q[key])parts.push(col+'=eq.'+enc(q[key]));
   if(q.search)parts.push('po_number=ilike.'+enc('*'+String(q.search).replace(/[%*]/g,'').slice(0,60)+'*'));
   parts.push('limit='+(limit+1),'offset='+offset);
   let rows=await boSelect('bo_purchase_orders',parts.join('&'))||[];
   const nextOffset=rows.length>limit?offset+limit:null;rows=rows.slice(0,limit);
   if(!canPurchase)rows=rows.map(po=>({...po,lines:po.lines.map(({unit_cost,...line})=>line)}));
   const response={rows,nextOffset,permissions:{purchasing:canPurchase}};
   if(q.id)response.events=await supplyEvents('purchase_order',q.id);
   if(q.view==='workspace'){
    const [snapshot,suppliers]=await Promise.all([boRpc('bo_inventory_snapshot',{}),boSelect('bo_suppliers','select=id,name,active&order=name.asc')]);
    response.stores=snapshot.stores;response.items=snapshot.items;response.suppliers=suppliers;
   }
   return res.status(200).json(response);
  }
  if(!['POST','PATCH'].includes(req.method))return res.status(405).json({error:'method'});
  const b=req.body||{},action=req.method==='PATCH'?'edit':b.action||'create';
  if(!['create','edit','send','receive','cancel','close'].includes(action))return res.status(400).json({error:'การทำรายการไม่ถูกต้อง'});
  if(action!=='create'&&(!b.id||!Number.isSafeInteger(b.expected_revision)||b.expected_revision<0))return res.status(400).json({error:'โหลดเอกสารล่าสุดก่อนยืนยัน'});
  const payload=action==='create'||action==='edit'?{id:b.id||null,expected_revision:b.expected_revision??null,supplier_id:b.supplier_id,store_id:b.store_id,expected_date:b.expected_date||null,note:String(b.note||'').slice(0,500),lines:b.lines}: {id:b.id,expected_revision:b.expected_revision,note:String(b.note||'').slice(0,500),...(action==='receive'?{lines:b.lines}:{})};
  if(['create','edit','receive'].includes(action)&&(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>200||b.lines.some(line=>!line||typeof line!=='object'||(action==='receive'? !Number.isFinite(line.qty_received)||line.qty_received<=0:!Number.isFinite(line.qty_ordered)||line.qty_ordered<=0||!Number.isFinite(line.unit_cost)||line.unit_cost<0))))return res.status(400).json({error:'กรอกจำนวนและต้นทุนให้ครบ อย่างน้อยหนึ่งรายการ สูงสุด 200 รายการ'});
  return res.status(200).json(await supplyCommand(req,'po_'+action,payload));
 }catch(error){return supplyError(res,error);}
}
