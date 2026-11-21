import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createInventoryFixture} from './helpers/inventory-fixture.js';
process.env.SUPABASE_URL='https://inventory.test';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';process.env.ADMIN_SECRET='supply-test-signing';process.env.BACKOFFICE_PASSWORD='supply-test';
const {makeBackofficeToken}=await import('../api/_auth.js');
const handler=(await import('../api/backoffice/purchase-orders.js')).default;
const transfers=(await import('../api/backoffice/transfers.js')).default;
let fixture,supplier;
test.before(async()=>{fixture=await createInventoryFixture();supplier=(await fixture.db.query("insert into bo_suppliers(name) values('Fixture supplier') returning id")).rows[0].id;});
test.after(()=>fixture?.db.close());
const token=role=>{const data=Buffer.from(JSON.stringify({id:'staff-'+role,name:role,role,exp:Date.now()+3600000})).toString('base64url');return data+'.'+crypto.createHmac('sha256',process.env.ADMIN_SECRET).update(data).digest('base64url');};
async function call(context,{run=handler,method='GET',query={},body={},auth=makeBackofficeToken()}={}){context.mock.method(globalThis,'fetch',fixture.fetcher);const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await run({method,url:'/api/backoffice/'+(run===handler?'purchase-orders':'transfers'),query,body,headers:{authorization:'Bearer '+auth}},res);return res;}
const payload=()=>({request_id:crypto.randomUUID(),supplier_id:supplier,store_id:'b',lines:[{item_type:'product',item_key:'water',qty_ordered:10,unit_cost:5}]});
test('PO creation assigns distinct sequential numbers, requires request ID and uses a named actor',async t=>{
 const p=payload();assert.equal((await call(t,{method:'POST',body:{...p,request_id:null}})).code,400);
 const a=await call(t,{method:'POST',body:p,auth:token('manager')}),b=await call(t,{method:'POST',body:payload()});assert.equal(a.code,200);assert.notEqual(a.data.row.po_number,b.data.row.po_number);assert.match(a.data.row.po_number,/^PO\d{4,}$/);assert.equal(a.data.row.created_by,'staff-manager');
 assert.deepEqual((await call(t,{method:'POST',body:p,auth:token('manager')})).data,a.data);
});
test('API receives in two batches, rejects over-receipts and maintains transactional audit history',async t=>{
 const created=await call(t,{method:'POST',body:payload()}),id=created.data.id;
 const act=(action,expected_revision,extra={})=>call(t,{method:'POST',body:{id,action,expected_revision,request_id:crypto.randomUUID(),...extra}});
 assert.equal((await act('send',1)).code,200);
 let detail=await call(t,{query:{id}}),line=detail.data.rows[0].lines[0];
 assert.equal((await act('receive',2,{lines:[{line_id:line.id,qty_received:99}]})).code,409);
 assert.equal((await act('receive',2,{lines:[{line_id:line.id,qty_received:6}],note:'Delivery A'})).code,200);
 detail=await call(t,{query:{id}});assert.equal(detail.data.rows[0].status,'receiving');assert.equal(Number(detail.data.rows[0].lines[0].qty_received),6);
 assert.equal((await act('receive',2,{lines:[{line_id:line.id,qty_received:1}]})).code,409);
 assert.equal((await act('receive',3,{lines:[{line_id:line.id,qty_received:4}]})).code,200);
 const logs=(await fixture.db.query('select action,after from bo_audit_log where entity_id=$1 order by id',[id])).rows;assert.deepEqual(logs.map(l=>l.action),['create','status_change','status_change','status_change']);assert.equal(logs.at(-1).after.status,'completed');
 const events=(await call(t,{query:{id}})).data.events;assert.equal(events.filter(e=>e.action==='po_receive').length,2);
});
test('read-only inventory staff can inspect documents without purchasing costs, but cannot write',async t=>{
 const viewer=token('professional');const res=await call(t,{query:{view:'workspace'},auth:viewer});assert.equal(res.code,200);assert(res.data.items.length);assert(res.data.rows.every(p=>p.lines.every(l=>!Object.hasOwn(l,'unit_cost'))));
 assert.equal((await call(t,{method:'POST',body:payload(),auth:viewer})).code,403);assert.equal((await call(t,{auth:''})).code,401);
});
test('partial transfer receipts enforce current revision and shortage closure keeps stock unchanged',async t=>{
 const tr=await fixture.command('transfer_start',{from_store_id:'a',to_store_id:'b',lines:[{item_type:'product',item_key:'flower',qty:10}]});await fixture.command('transfer_dispatch',{id:tr.id});
 const act=(action,expected_revision,extra={})=>call(t,{run:transfers,method:'POST',body:{id:tr.id,action,expected_revision,request_id:crypto.randomUUID(),...extra}});
 assert.equal((await act('receive',0,{lines:[{item_type:'product',item_key:'flower',qty_received:6}]})).code,200);
 assert.equal((await act('receive',0,{lines:[{item_type:'product',item_key:'flower',qty_received:1}]})).code,409);
 assert.equal((await act('close',1,{note:'4 grams missing'})).code,200);
 const detail=(await call(t,{run:transfers,query:{id:tr.id}})).data;assert.equal(detail.rows[0].status,'completed');assert.equal(Number(detail.rows[0].lines[0].qty_missing),4);assert.equal(detail.events.length,2);
});
