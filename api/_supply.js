import {boRpc,boSelect,enc} from './_bo-db.js';
import {staffIdentity} from './_auth.js';
export async function supplyCommand(req,action,payload){
 const request=String(req.body?.request_id||'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request)){const e=new Error('request_id required');e.status=400;throw e;}
 return boRpc('bo_supply_command',{p_action:action,p_request_id:request,p_payload:payload,p_actor:staffIdentity(req).id});
}
export function supplyError(res,error){
 const missing=/PGRST202|42883|42P01|42703|404/.test(error.message);
 const mapping=[[/initial stock count/,'ต้องตรวจนับยอดก่อนรับของรอบนี้ที่สาขาปลายทางก่อน (ถ้าไม่มีของ ให้ยืนยันศูนย์)'],[/document changed/,'เอกสารเปลี่ยนแล้ว กรุณารีเฟรชและตรวจจำนวนอีกครั้ง'],[/unit changed/,'หน่วยสินค้าเปลี่ยนหลังสร้างใบสั่งซื้อ กรุณาตรวจสอบเอกสารก่อนรับ'],[/request_id/,'คำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่'],[/exceeds remaining/,'จำนวนรับเกินที่ยังค้างรับ หรือทศนิยมไม่ตรงกับหน่วย'],[/register item unit/,'กรุณายืนยันหน่วยสินค้าในหน้าสต็อกก่อน'],[/duplicate/,'มีสินค้าหรือรายการรับซ้ำ'],[/precision|quantity|unit cost/,'ตรวจจำนวน ทศนิยม และต้นทุนให้ถูกต้อง'],[/explanation/,'ระบุเหตุผลอย่างน้อย 3 ตัวอักษร'],[/active supplier|active store/,'เลือกซัพพลายเออร์และสาขาที่เปิดใช้งาน'],[/not found/,'ไม่พบเอกสารหรือรายการสินค้า'],[/draft|receiving|dispatched|cancel/,'สถานะเอกสารเปลี่ยนแล้ว หรือไม่รองรับการทำรายการนี้']];
 return res.status(missing?503:error.status===400?400:/P0001|23505|23514|22P02|22003|22007|22008/.test(error.message)?409:502).json({error:missing?'ต้องติดตั้งฐานข้อมูลจัดซื้อและรับสินค้า (0005) ก่อนใช้งาน':mapping.find(([p])=>p.test(error.message))?.[1]||'บันทึกไม่สำเร็จ กรุณาตรวจข้อมูลและลองอีกครั้ง',migrationRequired:missing});
}
export async function supplyEvents(type,id){return boSelect('bo_supply_events',`entity_type=eq.${enc(type)}&entity_id=eq.${enc(id)}&order=created_at.asc,id.asc&select=*`);}
