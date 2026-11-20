import crypto from 'node:crypto';
import {dateKey,dayStart,buildReport,round,BREAKDOWN_GROUPS} from '../assets/backoffice-sales.js';
import {readSalesRecords,salesView} from './_bo-sales.js';
import {getJSON,setJSON,storageConfigured,storageFault} from './_store.js';
export const DELIVERY_KEY='backoffice:report-delivery:v1';
export function deliveryConfiguration(){
  const missing=[];
  if(!storageConfigured())missing.push('ฐานข้อมูลถาวร');
  for(const name of ['RESEND_API_KEY','REPORT_EMAIL_FROM','CRON_SECRET'])if(!process.env[name])missing.push(name);
  if(process.env.REPORT_SCHEDULER_ENABLED!=='true')missing.push('เปิดตัวเรียกงานรายชั่วโมง');
  return {ready:!missing.length,missing};
}
export function validateDelivery(input){
  const emails=String(input.recipients||'').split(/[,;\s]+/).filter(Boolean);
  if(!emails.length||emails.length>10||emails.some(email=>!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)))throw Error('ระบุอีเมลผู้รับให้ถูกต้อง ไม่เกิน 10 คน');
  if(!['daily','weekly','monthly'].includes(input.frequency))throw Error('ความถี่ไม่ถูกต้อง');
  const hour=Number(input.hour);
  if(!Number.isInteger(hour)||hour<0||hour>23)throw Error('เวลาส่งไม่ถูกต้อง');
  if(!['hour','day','week','month','year',...BREAKDOWN_GROUPS].includes(input.group||'day'))throw Error('การจัดกลุ่มไม่ถูกต้อง');
  const filters={};for(const key of ['store','channel','employee','payment','orderType','receipt'])if(input.filters?.[key])filters[key]=String(input.filters[key]).slice(0,200);
  if(input.filters?.branches){const branches=JSON.parse(input.filters.branches);if(!Array.isArray(branches)||branches.length>100)throw Error('ตัวกรองสาขาไม่ถูกต้อง');filters.branches=JSON.stringify(branches.map(String));}
  return {name:String(input.name||'ยอดขายตามช่วงเวลา').slice(0,100),recipients:[...new Set(emails)],frequency:input.frequency,hour,group:input.group||'day',filters,enabled:true};
}
export function dueWindow(schedule,now=Date.now()){
  const local=new Date(now+7*3600000),end=dayStart(now);
  if(local.getUTCHours()<schedule.hour)return null;
  if(schedule.frequency==='weekly'&&local.getUTCDay()!==1)return null;
  if(schedule.frequency==='monthly'&&local.getUTCDate()!==1)return null;
  let start=new Date(end);
  if(schedule.frequency==='daily')start=new Date(+end-86400000);
  else if(schedule.frequency==='weekly')start=new Date(+end-7*86400000);
  else {const d=new Date(+end+7*3600000);d.setUTCMonth(d.getUTCMonth()-1);start=new Date(+d-7*3600000);}
  return {start:start.toISOString(),end:end.toISOString(),key:dateKey(end)};
}
const cell=value=>'"'+String(value??'—').replace(/^[=+@\t]/,match=>"'"+match).replaceAll('"','""')+'"';
export async function runDeliveries(now=Date.now()){
  const config=deliveryConfiguration();if(!config.ready)throw Error('ยังไม่พร้อม: '+config.missing.join(', '));
  const schedules=await getJSON(DELIVERY_KEY)||[],records=await readSalesRecords();
  if(records.missing||storageFault())throw Error('ข้อมูลไม่ครบ จึงยังไม่ส่งรายงาน');
  const all=salesView(records.orders),results=[];
  for(const schedule of schedules){
    if(!schedule.enabled)continue;
    const window=dueWindow(schedule,now);if(!window)continue;
    const sentKey='backoffice:report-sent:'+schedule.id+':'+window.key;
    if(await getJSON(sentKey))continue;
    const report=buildReport(all,{...window,...schedule.filters},schedule.group);
    const grouped=BREAKDOWN_GROUPS.includes(schedule.group);
    const cols=[...(grouped?['qty']:[]),'orders','gross','discount','returns','net','tax','total','cost','profit'];
    const csv='\uFEFF'+[[...(grouped?[schedule.group]:['start','end']),...cols],...report.rows.map(row=>[...(grouped?[row.label]:[row.start,row.end]),...cols.map(key=>row[key])]),['TOTAL',...(grouped?[]:['']),...cols.map(key=>report.totals[key])]].map(row=>row.map(cell).join(',')).join('\r\n');
    const key=crypto.createHash('sha256').update(schedule.id+':'+window.key).digest('hex');
    try{
      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'sales-report-'+key},
        body:JSON.stringify({from:process.env.REPORT_EMAIL_FROM,to:schedule.recipients,
          subject:'DANK — '+schedule.name+' — '+window.key,
          text:`รายงานยอดขายตามช่วงเวลา\nเวลาไทย (UTC+7)\n${window.start} - ${window.end} (ไม่รวมเวลาสิ้นสุด)\nยอดขายรวม: ${round(report.totals.total).toFixed(2)} THB\nจำนวนรายการขาย: ${report.totals.orders}\nตัวกรอง: ${JSON.stringify(schedule.filters)}\nข้อมูลจากรายการที่บันทึกใน DANK เท่านั้น\n— ในไฟล์หมายถึงข้อมูลไม่ครบ\nแก้ไขหรือหยุดส่งได้ใน รายงาน > ตั้งเวลาส่งรายงาน`,
          attachments:[{filename:'dank-sales-'+window.key+'.csv',content:Buffer.from(csv).toString('base64')}]}),signal:AbortSignal.timeout(15000)
      });
      if(!response.ok)throw Error('ผู้ให้บริการอีเมลตอบกลับ '+response.status);
      const sent=await response.json();
      await setJSON(sentKey,{id:sent.id,at:now},86400*400);
      await setJSON('backoffice:report-status:'+schedule.id,{lastSentAt:new Date(now).toISOString(),lastError:null},86400*400);results.push({id:schedule.id,status:'accepted'});
    }catch(error){await setJSON('backoffice:report-status:'+schedule.id,{lastError:String(error.message||error)},86400*400);results.push({id:schedule.id,status:'failed'});}
  }
  return results;
}
