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
  const handler=createHandler({get,write,writeLocation:async(k,v)=>{const old=db.get(k);if(old?.capturedAt>=v.capturedAt)return false;await write(k,v);return true},ready:()=>storage,rate:async()=>true,permission:(req,res)=>{if(req.headers.authorization==='staff')return true;res.status(401).json({error:'bad key'});return false},token:()=>String(++generation).repeat(64),routeFor:async()=>({polyline:'abc',minutes:4,at:Date.now()}),endDelivery:async(id,status)=>{await write(terminalKey(id),{status,at:Date.now()})},...overrides});
  async function call({role='',action,token=customerToken,body={},method,staff=false}={}){
    const req={method:method||(action?'POST':'GET'),headers:{'x-delivery-token':token,...(staff?{authorization:'staff'}:{})},query:{id,role},body:{id,role,action,...body}};
    const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(j){this.data=j;return this}};
    await handler(req,res);return res;
  }
  return {db,id,customerToken,driverToken,call,setStorage:v=>storage=v};
}
const gps=()=>({location:{lat:13.71,lng:100.51,accuracy:8,capturedAt:Date.now()}});

test('eligibility is authoritative, opt-in and rejects mixed/restricted carts',()=>{
 const menu=[{shId:'food',name:'Sandwich',category:'Food'},{shId:'restricted',name:'THC brownie',category:'Edibles'}];
 const order={fulfilment:'delivery',items:[{shId:'food'}]};
 assert.equal(eligible(order,menu,'food'),true);
 assert.equal(eligible(order,menu,''),false);
 assert.equal(eligible({...order,items:[{shId:'food'},{shId:'restricted',name:'Sandwich',category:'Food'}]},menu,'food,restricted'),false);
 assert.equal(eligible({...order,items:[{shId:'invented'}]},menu,'invented'),false);
 assert.equal(eligible({...order,fulfilment:'table'},menu,'food'),false);
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
 const loc=f.db.get(locationKey(f.id,f.driverToken));loc.capturedAt=Date.now()-100000;
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
 const f=fixture();assert.equal((await f.call({role:'driver',action:'complete',token:f.driverToken})).code,409);
 await f.call({role:'driver',action:'start',token:f.driverToken,body:gps()});assert.equal((await f.call({role:'driver',action:'complete',token:f.driverToken})).code,200);
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
