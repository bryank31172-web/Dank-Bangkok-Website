import test from 'node:test';
import assert from 'node:assert/strict';
import {createSetupHandler} from '../api/_delivery-setup.js';
import {PRODUCTS_CONFIG_KEY} from '../api/_delivery.js';
import {RIDERS_KEY} from '../api/_delivery-line.js';
function fixture(overrides={}){
 const db=new Map([[PRODUCTS_CONFIG_KEY,{ids:['food']}],[RIDERS_KEY,[{accountId:'rider',lineUserId:'U'+'a'.repeat(32),onShift:true}]]]);
 const handler=createSetupHandler({permission:(req,res)=>{if(req.allowed)return true;res.status(401).json({error:'denied'});return false},ready:()=>true,backend:()=> 'supabase',write:async(k,v)=>db.set(k,v),get:async k=>db.get(k),menu:async()=>({source:'pos',data:[{name:'Sandwich',category:'Food',shId:'food'}]}),accounts:async()=>[{id:'rider',role:'professional',active:true,phone:'0812345678'}],routeFor:async()=>({minutes:5}),fetch:async()=>({ok:true}),env:{LINE_CHANNEL_ACCESS_TOKEN:'private-token',LINE_CHANNEL_SECRET:'private-secret',LINE_TO:'C'+'a'.repeat(32)},...overrides});
 const call=async(allowed=true,method='POST')=>{const res={code:200,status(c){this.code=c;return this},json(j){this.data=j;return this}};await handler({allowed,method},res);return res};return {call,db};
}
test('setup verifies connections without exposing credentials or claiming phone test success',async()=>{
 const f=fixture(),r=await f.call();assert.equal(r.data.ready,true);assert.equal(r.data.phoneTestRequired,true);assert.equal(r.data.checks.length,6);assert.doesNotMatch(JSON.stringify(r.data),/private-token|private-secret/);assert.equal([...f.db].filter(([k,v])=>k.startsWith('delivery:setup-probe:')&&v!==null).length,0);
});
test('setup is manager-gated and POST-only',async()=>{const f=fixture();assert.equal((await f.call(false)).code,401);assert.equal((await f.call(true,'GET')).code,405)});
test('storage fallback or mismatched write never passes',async()=>{
 for(const opts of [{ready:()=>false},{write:async()=>{}}]){const r=await fixture(opts).call();assert.equal(r.data.ready,false);assert.equal(r.data.checks.find(c=>c.name==='Database').ok,false)}
});
test('missing routes, invalid LINE and off-shift riders report attention',async()=>{
 const f=fixture({routeFor:async()=>null,env:{}});f.db.set(RIDERS_KEY,[{accountId:'rider',lineUserId:'U'+'a'.repeat(32),onShift:false}]);const r=await f.call();for(const name of ['Google Routes','LINE configuration','LINE riders'])assert.equal(r.data.checks.find(c=>c.name===name).ok,false);
});
