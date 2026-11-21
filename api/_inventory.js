import {boConfigured,boRpc,boErrorCode} from './_bo-db.js';
import {getMenu} from './_menu.js';
import {getJSON} from './_store.js';
import {hasPermission,staffIdentity} from './_auth.js';
import {buildInventory} from '../assets/inventory-model.js';

export async function inventoryOverview(req){
  const costs=hasPermission(staffIdentity(req),'settings');
  const [menu,pos]=await Promise.all([getMenu(),getJSON('pos:feed')]);
  let snapshot={stores:[],items:[],balances:[],counts:[],transfers:[]},available=false,migrationRequired=false,error=null;
  if(boConfigured()){
    try{snapshot=await boRpc('bo_inventory_snapshot',{});available=true;}
    catch(e){migrationRequired=boErrorCode(e)==='42883'||/PGRST202|404/.test(e.message);error=migrationRequired?'ต้องอัปเดตฐานข้อมูลสต็อกก่อนใช้หน้านี้':'โหลดสมุดสต็อกไม่สำเร็จ';}
  }else error='ยังไม่ได้เชื่อมฐานข้อมูลสต็อก';
  // Catalog names remain useful even when inventory is unavailable; no zeroes
  // are fabricated and the UI disables mutations until the schema is ready.
  const data=buildInventory(snapshot,menu.data||[],pos,{costs});
  return {...data,stores:snapshot.stores||[],counts:snapshot.counts||[],transfers:snapshot.transfers||[],available,migrationRequired,error,
    permissions:{adjust:hasPermission(staffIdentity(req),'inventory_adjust'),settings:costs,costs},
    refreshedAt:available?snapshot.at:null,posAt:pos?.at||null,catalogSource:menu.source,
    authority:{ledger:'สมุดสต็อก DANK แยกสาขา',pos:'ภาพรวมจาก POS ไม่ระบุสาขา — ไม่รวมกับสมุดสต็อก',salesConnected:false},
    documentLimit:100};
}
export async function inventoryCommand(req,action,payload){
  const id=String(req.body?.request_id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)){
    const error=new Error('request_id required');error.status=400;throw error;
  }
  return boRpc('bo_inventory_command',{p_action:action,p_request_id:id,p_payload:payload,p_actor:staffIdentity(req).id});
}
export function inventoryError(res,error){
  const missing=/PGRST202|42883|404/.test(error.message);
  const text=error.message;
  const messages=[
    [/request_id/,'คำขอนี้ไม่ถูกต้อง กรุณาโหลดหน้าใหม่'],
    [/stock changed/,'สต็อกเปลี่ยนหลังเปิดฟอร์ม กรุณารีเฟรชและตรวจยอดก่อนยืนยันอีกครั้ง'],
    [/stock moved/,'มีความเคลื่อนไหวหลังเริ่มตรวจนับ กรุณาทบทวนและเริ่มรอบใหม่เพื่อไม่ทับยอดล่าสุด'],
    [/insufficient/,'จำนวนที่สาขาต้นทางมีไม่พอ หรือยังไม่มีผลนับเริ่มต้น'],
    [/initial stock count/,'ต้องตรวจนับครั้งแรกเพื่อยืนยันยอดของสาขาก่อน'],
    [/register.*unit/,'ยืนยันหน่วยสินค้าก่อนทำรายการ'],
    [/cannot change a unit/,'มีประวัติสต็อกแล้ว จึงเปลี่ยนหน่วยตรง ๆ ไม่ได้ ต้องตรวจสอบการแปลงหน่วยก่อน'],
    [/quantity|precision/,'จำนวนไม่ถูกต้อง หรือมีทศนิยมเกินที่หน่วยสินค้ารองรับ'],
    [/reason and explanation/,'ระบุเหตุผลและคำอธิบายอย่างน้อย 3 ตัวอักษร'],
    [/waste and damage/,'ของเสียและเสียหายต้องเป็นจำนวนที่ลดลง'],
    [/dispatch goods/,'ต้องส่งสินค้าออกจากต้นทางก่อนยืนยันรับ'],
    [/active store|different stores/,'เลือกสาขาที่เปิดใช้งาน และต้นทางต้องต่างจากปลายทาง'],
    [/no longer editable/,'รอบตรวจนับนี้ปิดแล้ว ไม่สามารถแก้จำนวนได้'],
    [/23505/,'รายการสินค้าซ้ำ กรุณาเลือกสินค้าแต่ละรายการเพียงครั้งเดียว'],
  ];
  const message=messages.find(([pattern])=>pattern.test(text))?.[1]||'บันทึกไม่สำเร็จ กรุณาตรวจข้อมูลและลองอีกครั้ง';
  return res.status(missing?503:error.status===400?400:/P0001|23505|23514|22P02|22003/.test(text)?409:502).json({error:missing?'ต้องอัปเดตฐานข้อมูลสต็อกก่อนบันทึก':message,migrationRequired:missing});
}
