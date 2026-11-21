import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import crypto from 'node:crypto';
let db;
test.before(async()=>{
  db=new PGlite();
  for(const file of ['0001_dank_backoffice.sql','0002_dank_backoffice_audit_import.sql','0004_inventory_workflows.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.exec("insert into bo_stores(id,name) values('a','A'),('b','B');");
});
test.after(async()=>db?.close());
async function command(action,payload,id=crypto.randomUUID()){
  const {rows}=await db.query('select bo_inventory_command($1,$2::uuid,$3::jsonb,$4) as result',[action,id,JSON.stringify(payload),'owner']);return rows[0].result;
}
async function register(key,unit='g',precision=3){return command('register',{item_type:'product',item_key:key,name:key,unit,precision});}
async function balance(key,store='a'){return (await db.query('select * from bo_inventory_ledger where item_key=$1 and store_id=$2 order by id desc limit 1',[key,store])).rows[0];}
async function count(key,qty,store='a'){
  const start=await command('count_start',{store_id:store,items:[{item_type:'product',item_key:key}]});
  await command('count_save',{id:start.id,lines:[{item_type:'product',item_key:key,counted_qty:qty}]});
  return {id:start.id,...await command('count_complete',{id:start.id})};
}
test('migration is repeatable and a zero initial count establishes a known balance',async()=>{
  await db.exec(await readFile(new URL('../supabase/migrations/0004_inventory_workflows.sql',import.meta.url),'utf8'));
  await register('zero');await count('zero',0);assert.equal(Number((await balance('zero')).balance_after),0);
});
test('adjustments are satang-independent fractional quantities, idempotent and reject stale previews',async()=>{
  await register('flower');await count('flower',10);
  const before=await balance('flower'),id=crypto.randomUUID();
  const payload={item_type:'product',item_key:'flower',store_id:'a',qty_delta:-3.5,reason:'manual_adjust',note:'verified adjustment',expected_ledger_id:before.id};
  const first=await command('adjust',payload,id);const repeated=await command('adjust',payload,id);
  assert.deepEqual(first,repeated);assert.equal(Number((await balance('flower')).balance_after),6.5);
  await assert.rejects(command('adjust',{...payload,qty_delta:-1}),/stock changed/);
  await assert.rejects(command('adjust',{...payload,qty_delta:-1},id),/reused/);
});
test('whole-unit stock cannot be fractional and recorded units cannot be silently changed',async()=>{
  await register('bottle','ขวด',0);await count('bottle',12);
  await assert.rejects(command('count_save',{id:(await command('count_start',{store_id:'a',items:[{item_type:'product',item_key:'bottle'}]})).id,lines:[{item_type:'product',item_key:'bottle',counted_qty:1.5}]}),/invalid count/);
  await assert.rejects(register('bottle','g',3),/cannot change/);
});
test('completing a count leaves uncounted items alone and refuses movements since the snapshot',async()=>{
  await register('count-a');await register('count-b');await count('count-a',10);await count('count-b',20);
  const start=await command('count_start',{store_id:'a',items:[{item_type:'product',item_key:'count-a'},{item_type:'product',item_key:'count-b'}]});
  await command('count_save',{id:start.id,lines:[{item_type:'product',item_key:'count-a',counted_qty:9}]});
  await command('count_complete',{id:start.id});await command('count_complete',{id:start.id});
  assert.equal(Number((await balance('count-a')).balance_after),9);assert.equal(Number((await balance('count-b')).balance_after),20);
  const stale=await command('count_start',{store_id:'a',items:[{item_type:'product',item_key:'count-a'}]});
  await command('count_save',{id:stale.id,lines:[{item_type:'product',item_key:'count-a',counted_qty:7}]});
  const row=await balance('count-a');await command('adjust',{item_type:'product',item_key:'count-a',store_id:'a',qty_delta:1,reason:'manual_adjust',note:'new movement',expected_ledger_id:row.id});
  await assert.rejects(command('count_complete',{id:stale.id}),/stock moved/);assert.equal(Number((await balance('count-a')).balance_after),10);
});
test('dispatch removes source stock, receiving adds destination stock exactly once',async()=>{
  await register('transfer');await count('transfer',10);
  const transfer=await command('transfer_start',{from_store_id:'a',to_store_id:'b',lines:[{item_type:'product',item_key:'transfer',qty:3.5}]});
  await assert.rejects(command('transfer_receive',{id:transfer.id}),/dispatch/);
  await command('transfer_dispatch',{id:transfer.id});await command('transfer_dispatch',{id:transfer.id});
  assert.equal(Number((await balance('transfer')).balance_after),6.5);assert.equal(await balance('transfer','b'),undefined);
  await command('transfer_receive',{id:transfer.id});await command('transfer_receive',{id:transfer.id});
  assert.equal(Number((await balance('transfer','b')).balance_after),3.5);
});
test('a failed multi-item dispatch rolls back every ledger entry',async()=>{
  await register('tx-a');await register('tx-b');await count('tx-a',10);await count('tx-b',1);
  const transfer=await command('transfer_start',{from_store_id:'a',to_store_id:'b',lines:[{item_type:'product',item_key:'tx-a',qty:2},{item_type:'product',item_key:'tx-b',qty:3}]});
  await assert.rejects(command('transfer_dispatch',{id:transfer.id}),/insufficient/);
  assert.equal(Number((await balance('tx-a')).balance_after),10);
  assert.equal((await db.query('select status from bo_stock_transfers where id=$1',[transfer.id])).rows[0].status,'pending');
});
