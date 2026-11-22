import {requirePermission,staffIdentity,hasPermission} from '../_auth.js';
import {readSalesRecords,salesView} from '../_bo-sales.js';
import {matches,presetWindow,buildReport,BREAKDOWN_GROUPS} from '../../assets/backoffice-sales.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'method'});
  if(!requirePermission(req,res,'dashboard'))return;
  const identity=staffIdentity(req);
  // BackOffice's dedicated login can read receipts here, without gaining access
  // to the separate order mutation endpoint. Kitchen-only accounts cannot.
  if(identity?.role!=='backoffice'&&!hasPermission(identity,'orders'))return res.status(403).json({error:'forbidden'});
  try{
    const q=req.query||{},fallback=presetWindow('month');
    const scope={...q,start:q.start||fallback.start,end:q.end||fallback.end};
    const start=+new Date(scope.start),end=+new Date(scope.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return res.status(400).json({error:'ช่วงวันที่ไม่ถูกต้อง'});
    if(!['hour','day','week','month','year',...BREAKDOWN_GROUPS].includes(q.group||'day'))return res.status(400).json({error:'การจัดกลุ่มไม่ถูกต้อง'});
    if(q.itemGroup&&!BREAKDOWN_GROUPS.includes(q.itemGroup))return res.status(400).json({error:'การจัดกลุ่มไม่ถูกต้อง'});
    const records=await readSalesRecords(),all=salesView(records.orders);
    const inDate=all.filter(o=>matches(o,{start:scope.start,end:scope.end}));
    const options={};
    for(const key of ['branch','employee','channel','orderType'])options[key]=[...new Set(inDate.map(o=>o[key]))].sort();
    options.payment=[...new Set(inDate.flatMap(o=>o.paymentMethods))].sort();
    options.category=[...new Set(inDate.flatMap(o=>o.items.map(item=>item.category||'ไม่มีประเภทสินค้า')))].sort();
    const report=buildReport(all,scope,q.group||'day');
    return res.status(200).json({...report,options,scope,source:'recorded',lastSyncedAt:new Date().toISOString(),
      coverage:{indexed:records.indexed,missing:records.missing,complete:records.missing===0},
      note:'ข้อมูลจากรายการที่บันทึกใน DANK เท่านั้น ไม่รวมยอด POS ที่ยังไม่ได้เชื่อมเข้าระบบ ภาษีและต้นทุนที่ไม่ได้บันทึกจะแสดง —'});
  }catch(error){return res.status(502).json({error:'โหลดข้อมูลยอดขายไม่สำเร็จ',detail:String(error.message||error)});}
}
