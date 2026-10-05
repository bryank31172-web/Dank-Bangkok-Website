import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/delivery.js';
import { key, terminalKey, locationKey, startedKey, pausedKey } from '../api/_delivery.js';
import { requireRate } from '../api/_ratelimit.js';

const N=20,indices=Array.from({length:N},(_,i)=>i);
let generation=0;
function fixture(overrides={}){
 const id='STRESS-'+(++generation),customer='a'.repeat(64),driver='b'.repeat(64),db=new Map();let storage=true,routeCalls=0;
 db.set(key(id),{orderId:id,customerToken:customer,expiresAt:Date.now()+86400000,destination:{lat:13.75,lng:100.53},driver:{name:'Simulated driver',phone:'0800000000',token:driver,photo:''}});
 db.set('order:'+id,{orderId:id,status:'new',total:100,items:[{name:'Test sandwich',qty:1}],delivery:{zone:'Simulated destination'}});
 const handler=createHandler({
  get:async k=>structuredClone(db.get(k)??null),ready:()=>storage,
  write:async(k,v)=>{if(!storage)throw new Error('Unavailable');db.set(k,structuredClone(v))},
  writeLocation:async(k,v)=>{if(!storage)throw new Error('Unavailable');if(db.get(k)?.capturedAt>=v.capturedAt)return false;db.set(k,structuredClone(v));return true},
  rate:async()=>true,permission:(req,res)=>{if(req.headers.authorization==='test-staff')return true;res.status(401).json({error:'Unauthorized'});return false},
  token:()=>('c'+generation).padEnd(64,'c'),
  routeFor:async()=>{routeCalls++;return {minutes:4,polyline:'test',at:Date.now()}},
  endDelivery:async(id,status)=>db.set(terminalKey(id),{status,at:Date.now()}),...overrides,
 });
 async function call(action,{role='driver',token=driver,body={},staff=false}={}){
  const req={method:action?'POST':'GET',headers:{'x-delivery-token':token,'x-forwarded-for':id,...(staff?{authorization:'test-staff'}:{})},query:{id,role},body:{id,role,action,...body}};
  const res={code:200,setHeader(){},status(c){this.code=c;return this},json(j){this.data=j;return this}};
  await handler(req,res);return res;
 }
 const gps=(i=0,at=Date.now())=>({lat:13.7+i/1000,lng:100.5+i/1000,accuracy:8,capturedAt:at});
 const seed=()=>{db.set(startedKey(id,driver),{at:Date.now()-45000});db.set(locationKey(id,driver),{...gps(0,Date.now()-45000),at:Date.now()-45000,route:null})};
 return {id,db,driver,customer,call,gps,seed,routeCalls:()=>routeCalls,setStorage:x=>storage=x,view:()=>call(null,{role:'',token:customer})};
}
async function burst(f,action='start',location=i=>f.gps(i)){
 return Promise.all(indices.map(i=>f.call(action,{body:{location:location(i)}})));
}
const codes=(results,code)=>results.forEach(r=>assert.equal(r.code,code));
function gate(){const pending=[];return {pending,routeFor:async()=>new Promise(resolve=>pending.push(resolve)),async wait(){for(let i=0;i<100&&pending.length<N;i++)await new Promise(r=>setImmediate(r));assert.equal(pending.length,N)},release(reverse=false){for(const resolve of reverse?pending.slice().reverse():pending)resolve(null)}}}

test('stress 01: 20 locations at 45-second cadence follow the latest GPS',async()=>{
 const original=Date.now;let now=original();Date.now=()=>now;
 try{const f=fixture();for(const i of indices){now+=45000;assert.equal((await f.call(i?'location':'start',{body:{location:f.gps(i)}})).code,200);assert.equal((await f.view()).data.location.lat,f.gps(i).lat)}assert.equal(f.routeCalls(),N)}finally{Date.now=original}
});
test('stress 02: 20 rapid updates are throttled without moving GPS backward',async()=>{
 const f=fixture();await f.call('start',{body:{location:f.gps()}});codes(await burst(f,'location',i=>f.gps(i,Date.now()+i+1)),200);assert.equal(f.routeCalls(),1);
});
test('stress 03: 20 concurrent starts finishing in reverse preserve newest timestamp',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;
 const work=burst(f,'start',i=>f.gps(i,base+i));await g.wait();g.release(true);codes(await work,200);assert.equal((await f.view()).data.location.capturedAt,base+N-1);
});
test('stress 04: 20 concurrent location requests finishing in reverse preserve newest position',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;f.seed();
 const work=burst(f,'location',i=>f.gps(i,base+i));await g.wait();g.release(true);codes(await work,200);assert.equal((await f.view()).data.location.lat,f.gps(N-1).lat);
});
test('stress 05: 20 duplicate GPS requests leave one consistent location',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),point=f.gps();const work=burst(f,'start',()=>point);await g.wait();g.release();codes(await work,200);assert.equal((await f.view()).data.location.capturedAt,point.capturedAt);
});
test('stress 06: 20 stale fixes are rejected',async()=>{
 const f=fixture();codes(await burst(f,'start',i=>f.gps(i,Date.now()-180000)),400);assert.equal(f.routeCalls(),0);assert.equal((await f.view()).data.location,null);
});
test('stress 07: 20 inaccurate fixes are rejected',async()=>{
 const f=fixture();codes(await burst(f,'start',i=>({...f.gps(i),accuracy:501+i})),400);assert.equal(f.routeCalls(),0);
});
test('stress 08: 20 invalid coordinates are rejected',async()=>{
 const f=fixture();codes(await burst(f,'start',i=>({...f.gps(i),lat:91+i})),400);assert.equal(f.routeCalls(),0);
});
test('stress 09: 20 invalid driver tokens cannot update GPS',async()=>{
 const f=fixture();codes(await Promise.all(indices.map(i=>f.call('start',{token:'wrong',body:{location:f.gps(i)}}))),403);assert.equal(f.routeCalls(),0);
});
test('stress 10: 20 customer attempts cannot mutate GPS',async()=>{
 const f=fixture();codes(await Promise.all(indices.map(i=>f.call('start',{role:'',token:f.customer,body:{location:f.gps(i)}}))),403);assert.equal(f.routeCalls(),0);
});
test('stress 11: 20 location requests before Start are rejected',async()=>{
 const f=fixture();codes(await burst(f,'location'),409);assert.equal((await f.view()).data.status,'preparing');
});
test('stress 12: 20 location updates while paused stay hidden',async()=>{
 const f=fixture();f.seed();await f.call('pause');codes(await burst(f,'location'),409);assert.equal((await f.view()).data.location,null);
});
test('stress 13: pause defeats 20 in-flight route requests',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;const work=burst(f,'start',i=>f.gps(i,base+i));await g.wait();await f.call('pause');g.release();codes(await work,409);assert.equal((await f.view()).data.location,null);
});
test('stress 14: 20 fresh starts resume sharing after pause',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;f.seed();f.db.set(pausedKey(f.id,f.driver),{at:base-100});f.db.set(locationKey(f.id,f.driver),null);
 const work=burst(f,'start',i=>f.gps(i,base+i));await g.wait();g.release(true);codes(await work,200);assert.equal((await f.view()).data.location.capturedAt,base+N-1);
});
test('stress 15: reassignment invalidates 20 in-flight updates and old driver access',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;const work=burst(f,'start',i=>f.gps(i,base+i));await g.wait();assert.equal((await f.call('assign',{role:'staff',staff:true,body:{name:'New simulated driver',phone:'0800000001'}})).code,200);g.release();codes(await work,409);assert.equal((await f.call(null)).code,403);assert.equal((await f.view()).data.status,'preparing');
});
test('stress 16: completion defeats 20 in-flight updates and bypasses review',async()=>{
 const previous=process.env.GOOGLE_REVIEW_URL;process.env.GOOGLE_REVIEW_URL='https://g.page/test/review';
 try{const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;const work=burst(f,'start',i=>f.gps(i,base+i));await g.wait();await f.call('complete',{role:'staff',staff:true});g.release();codes(await work,409);const view=(await f.view()).data;assert.equal(view.status,'completed');assert.equal(view.location,null);assert.equal(view.driver,null);assert.equal(view.reviewUrl,'')}finally{if(previous===undefined)delete process.env.GOOGLE_REVIEW_URL;else process.env.GOOGLE_REVIEW_URL=previous}
});
test('stress 17: cancellation defeats 20 in-flight updates and hides GPS',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;const work=burst(f,'start',i=>f.gps(i,base+i));await g.wait();await f.call('cancel',{role:'staff',staff:true});g.release();codes(await work,409);const view=(await f.view()).data;assert.equal(view.status,'cancelled');assert.equal(view.location,null);assert.equal(view.destination,null);
});
test('stress 18: storage failure during 20 route lookups fails closed',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;const work=burst(f,'start',i=>f.gps(i,base+i));await g.wait();f.setStorage(false);g.release();codes(await work,503);assert.equal(f.db.get(locationKey(f.id,f.driver)),undefined);
});
test('stress 19: 20 route failures preserve GPS while making ETA unavailable',async()=>{
 const g=gate(),f=fixture({routeFor:g.routeFor}),base=Date.now()-1000;const work=burst(f,'start',i=>f.gps(i,base+i));await g.wait();g.release(true);codes(await work,200);const view=(await f.view()).data;assert.equal(view.location.route,null);assert.equal(view.location.lat,f.gps(N-1).lat);assert.equal(view.stale,false);
});
test('stress 20: actual rate limiter blocks excess location bursts before routing',async()=>{
 const f=fixture({rate:(req,res)=>requireRate(req,res,'stress-gps',5,300)});const results=await burst(f);assert.equal(results.filter(r=>r.code===429).length,15);assert.ok(f.routeCalls()<=5);
});
