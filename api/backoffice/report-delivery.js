import crypto from 'node:crypto';
import {requirePermission,staffIdentity} from '../_auth.js';
import {getJSON,setJSON,storageFault} from '../_store.js';
import {DELIVERY_KEY,deliveryConfiguration,validateDelivery} from '../_bo-report-delivery.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'method'});
  // Recurring financial exports require management access, not dashboard-only access.
  if(!requirePermission(req,res,'settings'))return;
  try{
    const configuration=deliveryConfiguration(),rows=await getJSON(DELIVERY_KEY)||[];
    if(req.method==='GET')return res.status(200).json({configuration,rows:await Promise.all(rows.map(async row=>({...row,...await getJSON('backoffice:report-status:'+row.id)})))});
    if(!configuration.ready)return res.status(503).json({error:'ยังไม่พร้อม: '+configuration.missing.join(', ')});
    const body=req.body||{};
    if(body.action==='delete'){
      const next=rows.filter(row=>row.id!==body.id);
      await setJSON(DELIVERY_KEY,next,86400*3650);
    }else{
      if(rows.length>=20)return res.status(400).json({error:'บันทึกได้สูงสุด 20 ตารางส่ง'});
      const row={...validateDelivery(body),id:crypto.randomUUID(),createdAt:new Date().toISOString(),createdBy:staffIdentity(req)?.id||'backoffice'};
      rows.push(row);await setJSON(DELIVERY_KEY,rows,86400*3650);
    }
    if(storageFault())throw Error('บันทึกฐานข้อมูลไม่สำเร็จ');
    return res.status(200).json({ok:true});
  }catch(error){return res.status(400).json({error:String(error.message||error)});}
}
