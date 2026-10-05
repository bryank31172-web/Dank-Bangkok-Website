import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://storage.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_test';
const {setJSONIfNewer}=await import('../api/_store.js');

test('Supabase GPS writes use conditional updates and cannot overwrite a newer timestamp',async()=>{
 const original=globalThis.fetch,rows=new Map();const calls=[];
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body),query=new URL(url).searchParams;calls.push({url,init});let result=[];
  if(init.method==='POST'){
   assert.equal(init.headers.Prefer,'resolution=ignore-duplicates,return=representation');
   if(!rows.has(body[0].key)){rows.set(body[0].key,body[0]);result=body;}
  }else{
   const key=query.get('key').slice(3),row=rows.get(key),condition=query.get('or');
   assert.match(condition,/value->capturedAt\.is\.null,value->capturedAt\.lt\.\d+/);
   const timestamp=Number(condition.match(/lt\.(\d+)/)[1]);
   if(row&&(!row.value?.capturedAt||row.value.capturedAt<timestamp)){Object.assign(row,body);result=[row]}
  }
  return {ok:true,text:async()=>JSON.stringify(result)};
 };
 try{
  assert.equal(await setJSONIfNewer('gps',{capturedAt:200,lat:2}),true);
  assert.equal(await setJSONIfNewer('gps',{capturedAt:100,lat:1}),false);
  assert.equal(rows.get('gps').value.lat,2);
  assert.equal(await setJSONIfNewer('gps',{capturedAt:300,lat:3}),true);
  assert.equal(rows.get('gps').value.lat,3);
  rows.get('gps').value=null;
  assert.equal(await setJSONIfNewer('gps',{capturedAt:400,lat:4}),true);
  assert.ok(calls.every(c=>c.init.headers.Authorization==='Bearer sb_secret_test'));
 }finally{globalThis.fetch=original}
});

test('GPS storage errors fail closed instead of silently writing process memory',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:503});
 try{await assert.rejects(setJSONIfNewer('gps-fail',{capturedAt:500}),/storage unavailable/)}finally{globalThis.fetch=original}
});
