import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/eta.js';
import {computeEta} from '../api/_route.js';
process.env.GOOGLE_MAPS_API_KEY='test-key';
process.env.SHOP_BRANCHES=JSON.stringify([{id:'test',name:'Test branch',origin:'13.7,100.5'}]);
const call=async(body)=>{const res={code:200,setHeader(){},status(c){this.code=c;return this},json(j){this.data=j;return this}};await handler({method:'POST',headers:{'x-forwarded-for':'eta-tests'},body},res);return res;};
test('ETA validates coordinates and caps public requests before route calls',async()=>{
 const original=globalThis.fetch;let count=0;
 globalThis.fetch=async(url,init)=>{count++;assert.ok(init.signal instanceof AbortSignal);return {ok:true,json:async()=>({routes:[{duration:'600s',distanceMeters:2000}]})}};
 try{
  assert.equal((await call({destLat:91,destLng:100})).code,400);
  assert.equal((await call({destLat:13.7})).code,400);
  const valid=await call({destLat:13.7,destLng:100.5});assert.equal(valid.data.minutes,25);
  for(let i=0;i<9;i++)await call({destLat:13.7,destLng:100.5});
  assert.equal((await call({destLat:13.7,destLng:100.5})).code,429);
  assert.equal(count,10);
 }finally{globalThis.fetch=original}
});
test('route failures and malformed durations produce unavailable ETA',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({routes:[{duration:'invalid'}]})});assert.equal((await computeEta({destLat:13.7,destLng:100.5})).ok,false);
  globalThis.fetch=async()=>{throw new DOMException('Timed out','TimeoutError')};assert.equal((await computeEta({destLat:13.7,destLng:100.5})).ok,false);
 }finally{globalThis.fetch=original}
});
