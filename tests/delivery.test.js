import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/delivery.js';
import { eligible, point, key, terminalKey, locationKey, startedKey, pausedKey } from '../api/_delivery.js';

function fixture(overrides={}){
  const db=new Map(),id='DR-123',customerToken='a'.repeat(64),driverToken='b'.repeat(64);
  db.set(key(id),{orderId:id,customerToken,expiresAt:Date.now()+86400000,destination:{lat:13.7,lng:100.5},driver:{name:'Driver',phone:'+66812345678',photo:'',token:driverToken}});
  db.set('order:'+id,{orderId:id,status:'new',total:100,items:[{name:'Sandwich',qty:1}],delivery:{zone:'Bangkok',address:'Lobby'},customer:{phone:'private'}});
  let generation=0,storage=true;
  const get=async k=>structuredClone(db.get(k)||null),write=async(k,v)=>{db.set(k,structuredClone(v))};
  const deps={get,write,claim:async()=>1,send:async()=>({ok:true}),group:()=>'C'+'c'.repeat(32),writeLocation:async(k,v)=>{const old=db.get(k);if(old?.capturedAt>=v.capturedAt)return false;await write(k,v);return true},ready:()=>storage,rate:async()=>true,permission:(req,res)=>{if(req.headers.authorization==='staff')return true;res.status(401).json({error:'bad key'});return false},token:()=>String(++generation).repeat(64),routeFor:async()=>({polyline:'abc',minutes:4,at:Date.now()}),endDelivery:async(id,status)=>{await write(terminalKey(id),{status,at:Date.now()})},...overrides},handler=createHandler(deps);
  async function call({role='',action,token=customerToken,body={},method,staff=false}={}){
    const req={method:method||(action?'POST':'GET'),headers:{'x-delivery-token':token,...(staff?{authorization:'staff'}:{})},query:{id,role},body:{id,role,action,...body}};
    const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(j){this.data=j;return this}};
    await handler(req,res);return res;
  }
  return {db,id,customerToken,driverToken,call,deps,setStorage:v=>storage=v};
}
const gps=()=>({location:{lat:13.71,lng:100.51,accuracy:8,capturedAt:Date.now()}});

test('eligibility follows the saved selection, or every delivery order when Track every product is on',()=>{
 const menu=[{shId:'food',name:'Sandwich',category:'Food'},{shId:'flower',name:'Blue Zangria',category:'Exotics'}];
 const order={fulfilment:'delivery',items:[{shId:'food'}]};
 assert.equal(eligible(order,menu,'food'),true);
 assert.equal(eligible(order,menu,''),false);
 assert.equal(eligible({...order,items:[{shId:'food'},{shId:'flower'}]},menu,'food'),false);
 assert.equal(eligible({...order,items:[{shId:'food'},{shId:'flower'}]},menu,'food,flower'),true);
 assert.equal(eligible({...order,items:[{shId:'invented'}]},menu,'invented'),false);
 assert.equal(eligible({...order,fulfilment:'table'},menu,'food'),false);
 assert.equal(eligible({...order,items:[{shId:'flower'}]},menu,'',true),true);
 assert.equal(point({lat:'13',lng:100}),null);assert.equal(point({lat:91,lng:100}),null);
});
test('private customer lookup contains no credential or customer address',async()=>{
 const f=fixture();const r=await f.call();assert.equal(r.code,200);assert.equal(r.data.status,'preparing');
 assert.equal(r.data.address,undefined);assert.equal(r.data.customerToken,undefined);assert.equal(r.data.driver.token,undefined);
 assert.equal((await f.call({token:''})).code,403);assert.equal((await f.call({token:f.driverToken})).code,403);
 assert.equal((await f.call({role:'driver'})).code,403);
 assert.equal(r.headers['Cache-Control'],'private, no-store');
});
test('customers cannot mutate delivery; staff role requires authentication',async()=>{
 const f=fixture();assert.equal((await f.call({action:'complete'})).code,403);
 assert.equal((await f.call({role:'staff'})).code,401);
 const r=await f.call({role:'staff',staff:true});assert.equal(r.code,200);assert.match(r.data.customerUrl,/delivery.html#/);
});
test('fresh GPS starts delivery, stale/inaccurate GPS is rejected',async()=>{
 const f=fixture();assert.equal((await f.call({role:'driver',action:'location',token:f.driverToken,body:gps()})).code,409);
 assert.equal((await f.call({role:'driver',action:'start',token:f.driverToken,body:{location:{...gps().location,capturedAt:Date.now()-200000}}})).code,400);
 assert.equal((await f.call({role:'driver',action:'start',token:f.driverToken,body:{location:{...gps().location,accuracy:600}}})).code,400);
 assert.equal((await f.call({role:'driver',action:'start',token:f.driverToken,body:gps()})).code,200);
 const r=await f.call();assert.equal(r.data.status,'on_the_way');assert.equal(r.data.stale,false);assert.equal(r.data.location.route.minutes,4);
 const loc=f.db.get(locationKey(f.id,f.driverToken));loc.capturedAt=Date.now()-211000;
 assert.equal((await f.call()).data.stale,true);
});
test('pause removes visible coordinates but keeps on-the-way stage',async()=>{
 const f=fixture();await f.call({role:'driver',action:'start',token:f.driverToken,body:gps()});
 await f.call({role:'driver',action:'pause',token:f.driverToken});const r=await f.call();assert.equal(r.data.status,'on_the_way');assert.equal(r.data.location,null);assert.equal(r.data.stale,true);
});
test('reassignment rotates driver access and requires destination',async()=>{
 const f=fixture();f.db.get(key(f.id)).destination=null;
 assert.equal((await f.call({role:'staff',staff:true,action:'assign',body:{name:'New',phone:'0812345678'}})).code,400);
 const r=await f.call({role:'staff',staff:true,action:'assign',body:{name:'New',phone:'0812345678',destination:{lat:13.8,lng:100.6}}});assert.equal(r.code,200);
 assert.equal((await f.call({role:'driver',token:f.driverToken})).code,403);
 assert.equal((await f.call()).data.status,'preparing');
});
test('completion/cancellation wins over late GPS and hides driver information',async()=>{
 for(const action of ['complete','cancel']){
 const f=fixture();await f.call({role:'driver',action:'start',token:f.driverToken,body:gps()});
 await f.call({role:'staff',staff:true,action});const r=await f.call();assert.equal(r.data.status,action==='complete'?'completed':'cancelled');assert.equal(r.data.driver,null);assert.equal(r.data.location,null);assert.equal(r.data.destination,null);
 assert.equal((await f.call({role:'driver',action:'location',token:f.driverToken,body:gps()})).code,409);
 assert.equal(f.db.get('order:'+f.id).total,100);
 }
});
test('expired link and persistent storage failure fail closed',async()=>{
 const f=fixture();f.setStorage(false);assert.equal((await f.call()).code,503);f.setStorage(true);
 f.db.get(key(f.id)).expiresAt=Date.now()-1;assert.equal((await f.call()).code,404);
});
test('only an authenticated assigned driver can complete a started delivery',async()=>{
 const f=fixture();assert.equal((await f.call({role:'driver',action:'complete',token:f.driverToken,body:{photo:'data:image/jpeg;base64,/9j/2Q=='}})).code,409);
 await f.call({role:'driver',action:'start',token:f.driverToken,body:gps()});assert.equal((await f.call({role:'driver',action:'complete',token:f.driverToken,body:{photo:'data:image/jpeg;base64,/9j/2Q=='}})).code,200);
 assert.equal((await f.call()).data.status,'completed');
});

test('a pause during route lookup wins over an in-flight start',async()=>{
 let f;f=fixture({routeFor:async()=>{f.db.set(pausedKey(f.id,f.driverToken),{at:Date.now()+1});return null}});
 const r=await f.call({role:'driver',action:'start',token:f.driverToken,body:gps()});assert.equal(r.code,409);
 assert.equal((await f.call()).data.location,null);
});

test('overlapping route requests preserve the newest GPS update',async()=>{
 let releaseOld,entered;const reached=new Promise(r=>entered=r);let calls=0;
 const f=fixture({routeFor:async()=>{if(++calls===1){entered();await new Promise(r=>releaseOld=r)}return null}});
 const now=Date.now(),old={location:{lat:13.71,lng:100.51,accuracy:8,capturedAt:now-1000}},fresh={location:{lat:13.72,lng:100.52,accuracy:8,capturedAt:now}};
 const first=f.call({role:'driver',action:'start',token:f.driverToken,body:old});await reached;
 await f.call({role:'driver',action:'start',token:f.driverToken,body:fresh});releaseOld();await first;
 assert.equal(f.db.get(locationKey(f.id,f.driverToken)).capturedAt,now);
});

test('new deliveries require an assigned rider departure photo before start; customer can view it privately',async()=>{
 const f=fixture(),record=f.db.get(key(f.id));record.departurePhotoRequired=true;
 assert.equal((await f.call({role:'driver',action:'start',token:f.driverToken,body:gps()})).code,409);
 const photo='data:image/jpeg;base64,/9j/2Q==';
 assert.equal((await f.call({action:'departure-photo',body:{photo}})).code,403);
 assert.equal((await f.call({role:'driver',action:'departure-photo',token:f.driverToken,body:{photo}})).code,200);
 assert.equal((await f.call()).data.departurePhoto,photo);
 assert.equal((await f.call({role:'driver',action:'start',token:f.driverToken,body:gps()})).code,200);
 await f.call({role:'driver',action:'complete',token:f.driverToken,body:{photo:'data:image/jpeg;base64,/9j/2Q=='}});
 assert.equal((await f.call()).data.departurePhoto,null);
 assert.equal((await f.call({role:'driver',action:'departure-photo',token:f.driverToken,body:{photo}})).code,409);
});
test('departure upload rejects malformed and oversized images and reassignment removes access to the old photo',async()=>{
 const f=fixture(),photo='data:image/jpeg;base64,/9j/2Q==';
 for(const photo of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,YWJjZA==','data:image/jpeg;base64,'+'A'.repeat(160001)])
 assert.equal((await f.call({role:'driver',action:'departure-photo',token:f.driverToken,body:{photo}})).code,400);
 await f.call({role:'driver',action:'departure-photo',token:f.driverToken,body:{photo}});
 await f.call({role:'staff',staff:true,action:'assign',body:{name:'New rider',phone:'0812345678',destination:{lat:13.8,lng:100.6}}});
 assert.equal((await f.call()).data.departurePhoto,null);
 assert.equal((await f.call({role:'driver',action:'departure-photo',token:f.driverToken,body:{photo}})).code,403);
});

test('customer contact and receipt remain private to the assigned rider after completion',async()=>{
 const f=fixture();const order=f.db.get('order:'+f.id);order.customer={name:'Customer One',phone:'+66 (81) 234-5678'};
 const customer=await f.call();assert.equal(customer.data.customer,undefined);assert.equal(customer.data.address,undefined);
 const rider=await f.call({role:'driver',token:f.driverToken});assert.deepEqual(rider.data.customer,{name:'Customer One',phone:'+66812345678'});
 order.customer.phone='javascript:alert(1)';assert.equal((await f.call({role:'driver',token:f.driverToken})).data.customer.phone,'');
 await f.call({role:'staff',staff:true,action:'complete'});const ended=await f.call({role:'driver',token:f.driverToken});assert.deepEqual(ended.data.customer,{name:'Customer One',phone:''});assert.equal(ended.data.address,'Bangkok, Lobby');assert.equal((await f.call()).data.customer,undefined);assert.equal((await f.call()).data.address,undefined);
});

test('90-second cadence stays fresh across one delayed refresh but stale GPS is hidden after 210 seconds',async()=>{
 const f=fixture();f.db.set(startedKey(f.id,f.driverToken),{at:Date.now()-100000});
 f.db.set(locationKey(f.id,f.driverToken),{lat:13.7,lng:100.5,capturedAt:Date.now()-100000});assert.equal((await f.call()).data.stale,false);
 f.db.set(locationKey(f.id,f.driverToken),{lat:13.7,lng:100.5,capturedAt:Date.now()-211000});assert.equal((await f.call()).data.stale,true);
});


test('rider route preview validates GPS and never starts sharing or writes device location',async()=>{
 const f=fixture();const before=structuredClone([...f.db]);
 assert.equal((await f.call({action:'preview-route',body:gps()})).code,403);
 assert.equal((await f.call({role:'driver',token:f.driverToken,action:'preview-route',body:{location:{...gps().location,capturedAt:Date.now()-130000}}})).code,400);
 const r=await f.call({role:'driver',token:f.driverToken,action:'preview-route',body:gps()});assert.equal(r.code,200);assert.equal(r.data.location.route.minutes,4);assert.deepEqual([...f.db],before);assert.equal((await f.call()).data.location,null);
 await f.call({role:'driver',token:f.driverToken,action:'start',body:gps()});assert.equal((await f.call({role:'driver',token:f.driverToken,action:'preview-route',body:gps()})).code,409);
});
test('completion during route preview cannot return rider GPS',async()=>{
 let f;f=fixture({routeFor:async()=>{f.db.set(terminalKey(f.id),{status:'completed'});return {minutes:4}}});
 const r=await f.call({role:'driver',token:f.driverToken,action:'preview-route',body:gps()});assert.equal(r.code,409);assert.equal(r.data.location,undefined);
});
test('staff can create a missing tracking link; same eligibility, idempotent, staff only',async()=>{
 let made=0;
 let f;f=fixture({createDelivery:async(o,opt)=>{assert.equal(opt?.byStaff,true);made++;f.db.set(key(o.orderId),{orderId:o.orderId,customerToken:'n'.repeat(64),expiresAt:Date.now()+86400000,destination:o.delivery?.coordinates||null,departurePhotoRequired:true,driver:null});return '/delivery.html#x'}});
 f.db.delete(key(f.id));f.db.get('order:'+f.id).fulfilment='delivery';f.db.get('order:'+f.id).items=[{name:'Sandwich',qty:1,shId:'food'}];
 assert.equal((await f.call({role:'staff',action:'create'})).code,401);
 assert.equal((await f.call({action:'create'})).code,403);
 const r=await f.call({role:'staff',staff:true,action:'create'});assert.equal(r.code,200);assert.equal(r.data.created,true);assert.match(r.data.customerUrl,/^\/delivery\.html#/);
 f.db.set(key(f.id),{orderId:f.id,customerToken:'c'.repeat(64),expiresAt:Date.now()+1000,destination:null,driver:null});
 const again=await f.call({role:'staff',staff:true,action:'create'});assert.equal(again.data.created,false);assert.equal(made,1);assert.match(again.data.customerUrl,/token=c{64}/);
 // Staff links work for any delivery order, whatever the items.
 f.db.delete(key(f.id));f.db.get('order:'+f.id).items=[{name:'Pre-roll',qty:1,shId:'preroll'}];
 assert.equal((await f.call({role:'staff',staff:true,action:'create'})).code,200);assert.equal(made,2);
 f.db.delete(key(f.id));
 f.db.get('order:'+f.id).fulfilment='pickup';assert.equal((await f.call({role:'staff',staff:true,action:'create'})).code,409);
 f.db.get('order:'+f.id).fulfilment='delivery';f.db.get('order:'+f.id).status='done';assert.equal((await f.call({role:'staff',staff:true,action:'create'})).code,409);
});

test('create link with destination and chosen rider assigns, DMs on LINE and rejects bad riders',async()=>{
 const sent=[],staffAcct=(id,o={})=>({id,name:'Rider '+id,phone:'081-234-5678',role:'parttime',active:true,...o});
 let f;f=fixture({accounts:async()=>[staffAcct('a1'),staffAcct('a2',{phone:''}),staffAcct('a3',{active:false})],
  send:async(to,msgs)=>{sent.push([to,msgs[0].text]);return {ok:true}},
  createDelivery:async o=>{f.db.set(key(o.orderId),{orderId:o.orderId,customerToken:'n'.repeat(64),expiresAt:Date.now()+86400000,destination:o.delivery?.coordinates||null,departurePhotoRequired:true,driver:null});return '/x'}});
 f.db.set('delivery:line-riders:v1',[{accountId:'a1',lineUserId:'U'+'a'.repeat(32),onShift:true}]);
 f.db.delete(key(f.id));Object.assign(f.db.get('order:'+f.id),{fulfilment:'delivery',items:[{name:'Sandwich',qty:1,shId:'food'}]});
 const opts=await f.call({role:'staff',staff:true,action:'rider-options'});assert.equal(opts.code,200);
 assert.deepEqual(opts.data.riders.map(r=>[r.id,r.onShift,r.line]),[['a1',true,true]]);assert.equal(JSON.stringify(opts.data).includes('Uaaaa'),false);
 assert.equal((await f.call({action:'rider-options'})).code,401);
 assert.equal((await f.call({role:'staff',staff:true,action:'create',body:{riderId:'a2',destination:{lat:13.7,lng:100.5}}})).code,400);
 assert.equal((await f.call({role:'staff',staff:true,action:'create',body:{riderId:'a3',destination:{lat:13.7,lng:100.5}}})).code,400);
 assert.equal((await f.call({role:'staff',staff:true,action:'create',body:{destination:{lat:'x',lng:1}}})).code,400);
 const r=await f.call({role:'staff',staff:true,action:'create',body:{riderId:'a1',place:'Siam Paragon',note:'  Gate 3,\n call on arrival ',destination:{lat:13.7463,lng:100.5346}}});
 assert.equal(r.code,200);assert.equal(r.data.created,true);assert.match(r.data.driverUrl,/^\/driver-delivery\.html#/);assert.equal(r.data.lineSent,true);
 const rec=f.db.get(key(f.id));assert.deepEqual(rec.destination,{lat:13.7463,lng:100.5346});assert.equal(rec.place,'Siam Paragon');assert.equal(rec.driver.accountId,'a1');assert.equal(rec.driver.phone,'0812345678');
 assert.equal(sent.length,1);assert.match(sent[0][1],/Siam Paragon/);assert.match(sent[0][1],/Note: Gate 3, call on arrival/);assert.equal(f.db.get(key(f.id)).note,'Gate 3, call on arrival');
 const cust=await f.call({token:'n'.repeat(64)});assert.equal(cust.code,200);assert.equal(cust.data.note,undefined);
 const drv=await f.call({role:'driver',token:f.db.get(key(f.id)).driver.token});assert.equal(drv.data.note,'Gate 3, call on arrival');assert.match(sent[0][1],/https:\/\/www\.dankbangkok\.com\/driver-delivery\.html#/);
 const s=await f.call({role:'staff',staff:true});assert.equal(s.data.address,'Siam Paragon');assert.equal(r.data.driverUrl,s.data.driverUrl);
});
test('website tracking starts with no customer link; it is made only when a rider is assigned',async()=>{
 const staffAcct={id:'a1',name:'Rider a1',phone:'081-234-5678',role:'parttime',active:true};
 let f;f=fixture({accounts:async()=>[staffAcct],send:async()=>({ok:true}),
  createDelivery:async o=>{f.db.set(key(o.orderId),{orderId:o.orderId,customerToken:null,expiresAt:Date.now()+86400000,destination:o.delivery?.coordinates||null,departurePhotoRequired:true,driver:null});return true}});
 f.db.set('delivery:line-riders:v1',[{accountId:'a1',lineUserId:'U'+'a'.repeat(32),onShift:true}]);
 f.db.delete(key(f.id));Object.assign(f.db.get('order:'+f.id),{fulfilment:'delivery',items:[{name:'Sandwich',qty:1}]});
 const noRider=await f.call({role:'staff',staff:true,action:'create'});
 assert.equal(noRider.code,200);assert.equal(noRider.data.customerUrl,'');
 assert.equal(f.db.get(key(f.id)).customerToken,null);
 assert.equal((await f.call({role:'staff',staff:true})).data.customerUrl,'');
 assert.equal((await f.call({token:''})).code,403,'an empty token must never open a record that has no customer link');
 assert.equal((await f.call({token:'null'})).code,403);
 const r=await f.call({role:'staff',staff:true,action:'create',body:{riderId:'a1',destination:{lat:13.7463,lng:100.5346}}});
 assert.equal(r.code,200);assert.match(r.data.driverUrl,/^\/driver-delivery\.html#/);
 const token=f.db.get(key(f.id)).customerToken;assert.match(token,/^[0-9a-f]{64}$/);
 assert.equal(r.data.customerUrl,'/delivery.html#'+new URLSearchParams({id:f.id,token}));
 assert.equal((await f.call({token})).code,200);
 assert.equal((await f.call({role:'staff',staff:true})).data.customerUrl,r.data.customerUrl);
});
test('LINE form: staff-group members and registered LINE IDs can sign in; others refused; staff key paths unchanged',async()=>{
 const U='U'+'b'.repeat(32),acct={id:'s1',name:'Mai',phone:'0812345678',role:'parttime',active:true};
 let f;f=fixture({accounts:async()=>[acct,{id:'s2',name:'Old',phone:'0811111111',role:'parttime',active:false}],
  verifyLine:async t=>({good:U,old:'U'+'c'.repeat(32),stranger:'U'+'d'.repeat(32),groupie:'U'+'e'.repeat(32)})[t]||null,groupMember:async u=>u==='U'+'e'.repeat(32),orderIds:async()=>[f.id,'NOPE'],send:async()=>({ok:true}),
  createDelivery:async o=>{f.db.set(key(o.orderId),{orderId:o.orderId,customerToken:'n'.repeat(64),expiresAt:Date.now()+86400000,destination:o.delivery?.coordinates||null,driver:null});return '/x'}});
 f.db.set('delivery:line-riders:v1',[{accountId:'s1',lineUserId:U,onShift:true},{accountId:'s2',lineUserId:'U'+'c'.repeat(32),onShift:true}]);
 f.db.delete(key(f.id));Object.assign(f.db.get('order:'+f.id),{fulfilment:'delivery',customer:{name:'Ann'},items:[{name:'Sandwich',qty:1,shId:'food'}]});
 const run=async(token,body)=>{const req={method:'POST',headers:token?{'x-line-id-token':token}:{},query:{},body};const res={setHeader(){},status(c){this.code=c;return this},json(j){this.data=j;return this}};await createHandler(f.deps)(req,res);return res};
 assert.equal((await run('bad',{action:'pending'})).code,401);
 assert.equal((await run('stranger',{action:'pending'})).code,403);
 assert.equal((await run('old',{action:'pending'})).code,403);
 const p=await run('good',{action:'pending'});assert.equal(p.code,200);assert.deepEqual(p.data.orders.map(o=>[o.orderId,o.customer,o.tracking]),[[f.id,'Ann',false]]);
 assert.equal((await run('good',{action:'rider-options'})).code,200);
 // Anyone in the staff LINE group can use the form without registering.
 assert.equal((await run('groupie',{action:'pending'})).code,200);assert.equal((await run('groupie',{action:'rider-options'})).code,200);
 assert.equal((await run('groupie',{role:'staff',id:f.id,action:'cancel'})).code,401);
 const c=await run('good',{role:'staff',id:f.id,action:'create',riderId:'s1',destination:{lat:13.74,lng:100.53},place:'Siam'});
 assert.equal(c.code,200);assert.equal(c.data.rider.name,'Mai');
 // A LINE token never unlocks other staff actions.
 assert.equal((await run('good',{role:'staff',id:f.id,action:'cancel'})).code,401);
 assert.equal((await run('',{action:'liff-config'})).code,200);
});
