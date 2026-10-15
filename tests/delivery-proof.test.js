import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../api/delivery.js';
import {key,terminalKey,startedKey} from '../api/_delivery.js';
import {proofKey,proofRef} from '../api/_delivery-proof.js';
const photo='data:image/jpeg;base64,/9j/2Q==';
function fixture() {
  const id='PROOF-TEST',token='b'.repeat(64),customer='a'.repeat(64),db=new Map(),sent=[],counts=new Map();let push=true,storage=true;
  db.set(key(id),{expiresAt:Date.now()+60000,customerToken:customer,driver:{name:'Test rider',token}});
  db.set('order:'+id,{customer:{name:'Test customer',phone:'0812345678'},delivery:{zone:'Bangkok',address:'Test lobby'},items:[{name:'Sandwich',qty:2}],total:200});
  db.set(startedKey(id,token),{at:Date.now()});
  const handler=createHandler({get:async k=>structuredClone(db.get(k)),ready:()=>storage,rate:async()=>true,permission:(req,res)=>{if(req.headers.authorization==='staff')return true;res.status(401).json({error:'Unauthorized'});return false;},
    write:async(k,v)=>db.set(k,structuredClone(v)),claim:async k=>{const n=(counts.get(k)||0)+1;counts.set(k,n);return n;},
    endDelivery:async()=>db.set(terminalKey(id),{status:'completed',at:Date.now()}),
    send:async(to,messages,options)=>{sent.push({to,messages,options});return {ok:push};},group:()=> 'C'+'c'.repeat(32),origin:()=> 'https://preview.vercel.app'});
  async function call(body={},credential=token,method='POST') {
    const r={code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(v){this.data=v;return this},send(v){this.data=v;return this}};
    await handler({method,headers:{'x-delivery-token':credential,...(credential==='staff'?{authorization:'staff'}:{})},body:{id,role:'driver',action:'complete',...body},query:body},r);return r;
  }
  return {db,sent,id,token,customer,call,setPush:v=>push=v,setStorage:v=>storage=v};
}
test('delivery requires a photo and sends a green confirmation rich card with the order and hosted photo',async()=>{
  const f=fixture();assert.equal((await f.call()).code,400);assert.equal(f.db.has(terminalKey(f.id)),false);
  const r=await f.call({photo});assert.equal(r.code,200);assert.equal(r.data.notificationSent,true);
  const card=f.sent[0].messages[0];assert.equal(card.type,'flex');assert.equal(card.contents.header.backgroundColor,'#00B65B');
  assert.equal(card.contents.header.contents[0].text,'Delivery confirmed');assert.equal(card.contents.header.contents[0].color,'#FFFFFF');
  const json=JSON.stringify(card);for(const text of ['Test customer','Test lobby','0812345678','Sandwich','200'])assert.ok(json.includes(text));
  const url=card.contents.body.contents.at(-1).url;assert.match(url,/https:\/\/preview.vercel.app\/api\/delivery\?action=proof-image&photo=[a-f0-9]{64}$/);
  assert.ok(!url.includes(f.token));assert.equal(f.db.get(terminalKey(f.id)).status,'completed');
  const retry=await f.call({photo});assert.equal(retry.code,200);assert.equal(f.sent.length,1);
});
test('wrong credentials, malformed images, cancellation and reassignment cannot send a proof card',async()=>{
  const f=fixture();assert.equal((await f.call({photo},f.customer)).code,403);
  for(const photo of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,YWJjZA==','data:image/jpeg;base64,'+'A'.repeat(160001)])assert.equal((await f.call({photo})).code,400);
  f.db.set(terminalKey(f.id),{status:'cancelled'});assert.equal((await f.call({photo})).code,409);assert.equal(f.sent.length,0);
  f.db.delete(terminalKey(f.id));f.db.get(key(f.id)).driver.token='new';assert.equal((await f.call({photo})).code,403);
});
test('failed LINE notification retains proof and retries with the same idempotency key without overwriting the photo',async()=>{
  const f=fixture();f.setPush(false);assert.equal((await f.call({photo})).data.notificationSent,false);
  f.setPush(true);assert.equal((await f.call({photo:'different'})).data.notificationSent,true);
  assert.equal(f.sent[0].options.retryKey,f.sent[1].options.retryKey);assert.deepEqual(f.sent[0].messages,f.sent[1].messages);
  assert.equal(f.db.get(proofKey(proofRef(f.id,f.token))).photo,photo);
});
test('20 concurrent completion requests publish one proof card',async()=>{
  const f=fixture();await Promise.all(Array.from({length:20},()=>f.call({photo})));assert.equal(f.sent.length,1);
});
test('staff can retry an unsuccessful confirmation after completion; unauthorized callers cannot',async()=>{
  const f=fixture();f.setPush(false);await f.call({photo});f.setPush(true);
  assert.equal((await f.call({role:'staff',action:'resend-proof'},f.customer)).code,401);
  assert.equal((await f.call({role:'staff',action:'resend-proof'},'staff')).data.notificationSent,true);
  assert.equal(f.sent.length,2);assert.equal(f.sent[0].options.retryKey,f.sent[1].options.retryKey);
});
test('image capability serves only JPEG bytes, rejects expired or guessed links and fails closed on storage outage',async()=>{
  const f=fixture();await f.call({photo});const ref=proofRef(f.id,f.token);
  const r=await f.call({action:'proof-image',photo:ref},'', 'GET');assert.equal(r.code,200);assert.equal(r.headers['Content-Type'],'image/jpeg');assert.equal(r.headers['Cache-Control'],'private, no-store');assert.ok(Buffer.isBuffer(r.data));assert.equal(r.data.toString('base64'),'/9j/2Q==');
  assert.equal((await f.call({action:'proof-image',photo:'0'.repeat(64)},'', 'GET')).code,404);
  f.db.get(proofKey(ref)).expiresAt=0;assert.equal((await f.call({action:'proof-image',photo:ref},'', 'GET')).code,404);
  f.setStorage(false);assert.equal((await f.call({action:'proof-image',photo:ref},'', 'GET')).code,503);
});
