import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createInventoryFixture} from './helpers/inventory-fixture.js';
process.env.SUPABASE_URL='https://inventory.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-role';
process.env.BACKOFFICE_PASSWORD='test-inventory-password';process.env.ADMIN_SECRET='test-inventory-secret';
const {makeBackofficeToken}=await import('../api/_auth.js');
const handler=(await import('../api/backoffice/inventory.js')).default;
const counts=(await import('../api/backoffice/stocktakes.js')).default;
const transfers=(await import('../api/backoffice/transfers.js')).default;
const settings=(await import('../api/backoffice/product-settings.js')).default;
const dashboard=(await import('../api/backoffice/dashboard.js')).default;
let fixture;
test.before(async()=>fixture=await createInventoryFixture());test.after(async()=>fixture?.db.close());
function staffToken(role){const data=Buffer.from(JSON.stringify({id:'person-'+role,name:role,role,exp:Date.now()+3600000})).toString('base64url');return data+'.'+crypto.createHmac('sha256',process.env.ADMIN_SECRET).update(data).digest('base64url');}
async function call(context,run,method='GET',query={},body={},token=makeBackofficeToken()){
  context.mock.method(globalThis,'fetch',fixture.fetcher);
  const path=run===handler?'inventory':run===counts?'stocktakes':run===settings?'product-settings':run===dashboard?'dashboard':'transfers';
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await run({method,url:'/api/backoffice/'+path,query,body,headers:{authorization:token?'Bearer '+token:''}},res);return res;
}
test('overview uses exact branch balances, nulls, thresholds and explicitly unallocated POS data',async context=>{
  const res=await call(context,handler,'GET',{view:'overview'});assert.equal(res.code,200);assert(res.data.available);
  assert.equal(res.data.rows.find(r=>r.item_key==='flower'&&r.store_id==='a').quantity,120.5);
  assert.equal(res.data.rows.find(r=>r.item_key==='water'&&r.store_id==='b').quantity,0);
  assert.equal(res.data.rows.find(r=>r.item_key==='unknown'&&r.store_id==='a').quantity,null);
  assert.equal(res.data.rows.find(r=>r.id==='pos:flower').quantity,76.5);
  assert.equal(res.data.rows.find(r=>r.id==='pos:unknown').quantity,null);
});
test('view-only staff cannot see cost data or mutate inventory; an anonymous request is rejected',async context=>{
  const viewer=staffToken('professional');const res=await call(context,handler,'GET',{view:'overview'},{},viewer);
  assert.equal(res.code,200);assert(!res.data.permissions.costs);assert(!res.data.permissions.adjust);assert(res.data.rows.every(row=>!Object.hasOwn(row,'cost')));
  assert.equal((await call(context,handler,'POST',{}, {qty_delta:1},viewer)).code,403);
  assert.equal((await call(context,handler,'GET',{view:'overview'},{},'')).code,401);
  assert.equal((await call(context,handler,'GET',{view:'overview'},{},staffToken('kitchen'))).code,403);
});
test('manual adjustments require an idempotency key, preserve their actor and reject a stale preview',async context=>{
  const row=(await call(context,handler,'GET',{view:'overview'})).data.rows.find(r=>r.item_key==='flower'&&r.store_id==='a');
  const body={item_type:'product',item_key:'flower',store_id:'a',qty_delta:-3.5,reason:'manual_adjust',note:'verified amount',expected_ledger_id:row.ledger_id};
  assert.equal((await call(context,handler,'POST',{},body)).code,400);
  const key=crypto.randomUUID();const first=await call(context,handler,'POST',{}, {...body,request_id:key},staffToken('manager'));
  assert.equal(first.code,200);assert.equal(first.data.row.staff_id,'person-manager');
  const again=await call(context,handler,'POST',{}, {...body,request_id:key},staffToken('manager'));assert.deepEqual(first.data,again.data);
  assert.equal((await call(context,handler,'POST',{}, {...body,request_id:crypto.randomUUID()})).code,409);
});
test('read-only accounts can inspect transfer documents and counts, but cannot confirm them',async context=>{
  const viewer=staffToken('professional');
  assert.equal((await call(context,transfers,'GET',{},{},viewer)).code,200);
  assert.equal((await call(context,counts,'GET',{},{},viewer)).code,200);
  assert.equal((await call(context,transfers,'POST',{}, {action:'receive'},viewer)).code,403);
});
test('threshold updates preserve ideal stock and reject negative values',async context=>{
  const res=await call(context,settings,'POST',{}, {product_key:'water',store_id:'b',low_stock_threshold:10});assert.equal(res.code,200);assert.equal(Number(res.data.row.ideal_stock),48);
  assert.equal((await call(context,settings,'POST',{}, {product_key:'water',store_id:'b',low_stock_threshold:-1})).code,400);
});

test('Home alerts use the same branch thresholds and include bottle units',async context=>{
  const res=await call(context,dashboard);assert.equal(res.code,200);
  assert.equal(res.data.lowStock.policy,'per-product-per-store');
  const water=res.data.lowStock.rows.find(row=>row.product_key==='water'&&row.store_id==='b');
  assert(water);assert.equal(water.balance,0);assert.equal(water.threshold,10);assert.equal(water.unit,'ขวด');
  assert(!res.data.lowStock.rows.some(row=>row.product_key==='unknown'));
});

test('missing migration disables stock workflows without fabricating balances',async context=>{
  context.mock.method(globalThis,'fetch',(input,init)=>String(input).includes('/rpc/bo_inventory_snapshot')
    ? Promise.resolve(new Response(JSON.stringify({code:'PGRST202',message:'function not found'}),{status:404}))
    : fixture.fetcher(input,init));
  const req={method:'GET',url:'/api/backoffice/inventory',query:{view:'overview'},headers:{authorization:'Bearer '+makeBackofficeToken()}};
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await handler(req,res);assert.equal(res.code,200);assert(!res.data.available);assert(res.data.migrationRequired);
  assert(res.data.rows.filter(row=>!row.read_only).every(row=>row.quantity===null));
});
