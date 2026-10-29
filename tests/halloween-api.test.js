import test from 'node:test';
import assert from 'node:assert/strict';
process.env.ADMIN_SECRET='test-only-secret-long-enough';
process.env.STAFF_KEY='staff-only-test';
process.env.UPSTASH_REDIS_REST_URL='https://storage.test';
process.env.UPSTASH_REDIS_REST_TOKEN='test';
const counters=new Map();let fail=false;
globalThis.fetch=async(_url,init)=>{if(fail)throw Error('offline');const [op,key]=JSON.parse(init.body);if(op==='INCR')counters.set(key,(counters.get(key)||0)+1);const result=op==='INCR'?counters.get(key):1;return {ok:true,json:async()=>({result})};};
const {default:handler}=await import('../api/halloween.js');
const realNow=Date.now;Date.now=()=>Date.parse('2026-10-31T12:00:00+07:00');
async function call(body,headers={},method='POST'){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};await handler({method,body,headers:{host:'giveaway.test',origin:'https://giveaway.test',...headers}},res);return res;}
test('entry, returning cookie, fixed result and atomic one-time collection',async()=>{const entry=await call({action:'enter'});assert.equal(entry.code,200);const token=entry.data.link.split('#')[1];const cookie=entry.headers['Set-Cookie'].split(';')[0];const again=await call({action:'enter'},{cookie});assert.equal(again.data.link,entry.data.link);const a=await call({action:'result',token});const b=await call({action:'result',token});assert.deepEqual(a.data,b.data);assert.equal((await call({action:'redeem',token})).code,401);const claims=await Promise.all([call({action:'redeem',token},{authorization:'Bearer staff-only-test'}),call({action:'redeem',token},{authorization:'Bearer staff-only-test'})]);assert.deepEqual(claims.map(x=>x.code).sort(),[200,409]);});
test('rejects cross-origin and invalid tokens',async()=>{assert.equal((await call({action:'enter'},{origin:'https://evil.test'})).code,403);assert.equal((await call({action:'result',token:'forged'})).code,400);assert.equal((await call({}, {},'DELETE')).code,405);});
test('campaign closes at midnight Bangkok',async()=>{Date.now=()=>Date.parse('2026-11-01T00:00:00+07:00');assert.equal((await call({action:'enter'})).code,410);Date.now=()=>Date.parse('2026-10-31T12:00:00+07:00');});
test('storage outage fails closed instead of issuing an in-memory entry',async()=>{fail=true;assert.equal((await call({action:'enter'})).code,503);Date.now=realNow;});
