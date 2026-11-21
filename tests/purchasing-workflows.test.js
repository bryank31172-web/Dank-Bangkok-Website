import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createInventoryFixture} from './helpers/inventory-fixture.js';
let fixture,supplier;
test.before(async()=>{fixture=await createInventoryFixture();supplier=(await fixture.db.query("insert into bo_suppliers(name) values('Supplier A') returning id")).rows[0].id;});
test.after(()=>fixture?.db.close());
async function command(action,payload,id=crypto.randomUUID()){return (await fixture.db.query('select bo_supply_command($1,$2::uuid,$3::jsonb,$4) as result',[action,id,JSON.stringify(payload),'owner'])).rows[0].result;}
const line=(key,qty=10)=>({item_type:'product',item_key:key,qty_ordered:qty,unit_cost:5});
async function create(lines=[line('water')]){const r=await command('po_create',{supplier_id:supplier,store_id:'b',lines});return r.row;}
const get=async id=>(await fixture.db.query('select * from bo_purchase_orders where id=$1',[id])).rows[0];
const lines=async id=>(await fixture.db.query('select * from bo_purchase_order_lines where po_id=$1 order by item_key',[id])).rows;
const balance=async(key,store='b')=>Number((await fixture.db.query('select balance_after from bo_inventory_ledger where item_key=$1 and store_id=$2 order by id desc limit 1',[key,store])).rows[0].balance_after);
test('migration repeats safely; creation is idempotent and unit-aware',async()=>{
 await fixture.db.exec(await readFile(new URL('../supabase/migrations/0005_purchasing_receiving.sql',import.meta.url),'utf8'));
 const id=crypto.randomUUID(),p={supplier_id:supplier,store_id:'a',lines:[line('water')]};
 const a=await command('po_create',p,id);assert.deepEqual(await command('po_create',p,id),a);
 assert.equal((await lines(a.id))[0].unit,'ขวด');
 await assert.rejects(command('po_create',{...p,lines:[line('water',1.5)]}),/precision/);
 await assert.rejects(command('po_create',{...p,lines:[line('water'),line('water')]}),/duplicate/);
});
test('partial receipt changes only received stock, is retry safe, and blocks a stale second receiver',async()=>{
 const po=await create();await command('po_send',{id:po.id,expected_revision:po.revision});
 const l=(await lines(po.id))[0],before=await balance('water'),key=crypto.randomUUID();
 const payload={id:po.id,expected_revision:2,lines:[{line_id:l.id,qty_received:6}],note:'delivery 1'};
 await command('po_receive',payload,key);await command('po_receive',payload,key);
 assert.equal(await balance('water'),before+6);assert.equal((await get(po.id)).status,'receiving');
 await assert.rejects(command('po_receive',payload),/document changed/);
 await command('po_receive',{id:po.id,expected_revision:3,lines:[{line_id:l.id,qty_received:4}]});
 assert.equal((await get(po.id)).status,'completed');assert.equal(await balance('water'),before+10);
 const ev=(await fixture.db.query("select * from bo_supply_events where entity_id=$1 and action='po_receive'",[po.id])).rows;assert.equal(ev.length,2);
});
test('invalid later receipt line rolls back the whole receipt; drafts edit with revision and cancel is audited',async()=>{
 const po=await create([line('water'),line('flower')]);
 await command('po_edit',{id:po.id,expected_revision:1,supplier_id:supplier,store_id:'b',lines:[line('water',20),line('flower',3.5)]});
 await assert.rejects(command('po_edit',{id:po.id,expected_revision:1,supplier_id:supplier,store_id:'b',lines:[line('water')]}),/document changed/);
 await command('po_send',{id:po.id,expected_revision:2});
 const ls=await lines(po.id),before=await balance('water');
 await assert.rejects(command('po_receive',{id:po.id,expected_revision:3,lines:ls.map(l=>({line_id:l.id,qty_received:l.item_key==='water'?1:99}))}),/exceeds/);
 assert.equal(await balance('water'),before);assert((await lines(po.id)).every(l=>Number(l.qty_received)===0));
 await command('po_cancel',{id:po.id,expected_revision:3,note:'supplier unavailable'});assert.equal((await get(po.id)).status,'cancelled');
});
test('transfer partial receipt leaves only the remainder in transit; shortage closure adds no stock',async()=>{
 const start=await fixture.command('transfer_start',{from_store_id:'a',to_store_id:'b',lines:[{item_type:'product',item_key:'flower',qty:10}]});
 await fixture.command('transfer_dispatch',{id:start.id});const before=await balance('flower');
 const payload={id:start.id,expected_revision:0,lines:[{item_type:'product',item_key:'flower',qty_received:6}]},key=crypto.randomUUID();
 await command('transfer_receive',payload,key);await command('transfer_receive',payload,key);assert.equal(await balance('flower'),before+6);
 let l=(await fixture.db.query('select * from bo_stock_transfer_lines where transfer_id=$1',[start.id])).rows[0];assert.equal(Number(l.qty)-Number(l.qty_received),4);
 await assert.rejects(command('transfer_receive',payload),/document changed/);
 await assert.rejects(command('transfer_close',{id:start.id,expected_revision:1,note:''}),/explanation/);
 await command('transfer_close',{id:start.id,expected_revision:1,note:'4 grams missing in delivery'});
 assert.equal(await balance('flower'),before+6);l=(await fixture.db.query('select * from bo_stock_transfer_lines where transfer_id=$1',[start.id])).rows[0];assert.equal(Number(l.qty_missing),4);
 await fixture.db.exec(await readFile(new URL('../supabase/migrations/0005_purchasing_receiving.sql',import.meta.url),'utf8'));
 assert.equal(Number((await fixture.db.query('select qty_received from bo_stock_transfer_lines where transfer_id=$1',[start.id])).rows[0].qty_received),6);
});
test('closing an unfulfilled PO keeps actual receipts and stock unchanged',async()=>{
 const po=await create();await command('po_send',{id:po.id,expected_revision:1});const l=(await lines(po.id))[0];
 await command('po_receive',{id:po.id,expected_revision:2,lines:[{line_id:l.id,qty_received:6}]});const before=await balance('water');
 await command('po_close',{id:po.id,expected_revision:3,note:'supplier cannot deliver remaining 4'});
 assert.equal((await get(po.id)).status,'closed');assert.equal(Number((await lines(po.id))[0].qty_cancelled),4);assert.equal(await balance('water'),before);
 await assert.rejects(command('po_receive',{id:po.id,expected_revision:4,lines:[{line_id:l.id,qty_received:1}]}),/not open/);
});
test('receiving cannot turn an unknown branch balance into an assumed zero',async()=>{
 const po=await create([line('unknown')]);await command('po_send',{id:po.id,expected_revision:1});const l=(await lines(po.id))[0];
 await assert.rejects(command('po_receive',{id:po.id,expected_revision:2,lines:[{line_id:l.id,qty_received:1}]}),/initial stock count/);
 assert.equal(Number((await lines(po.id))[0].qty_received),0);
});
