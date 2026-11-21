import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInventory,filterStock} from '../assets/inventory-model.js';
const snapshot={stores:[{id:'a',name:'A'},{id:'b',name:'B'}],items:[{item_type:'product',item_key:'flower',name:'MAC1',sku:'00001',unit:'g',precision:3}],balances:[{id:1,item_type:'product',item_key:'flower',store_id:'a',balance_after:0}],thresholds:[{product_key:'flower',store_id:'a',low_stock_threshold:50}],settings:[{product_key:'flower',cost_price:100}],transfers:[{status:'dispatched',to_store_id:'b',lines:[{item_type:'product',item_key:'flower',qty:3.5}]}]};
test('unknown differs from a counted zero, and in-transit stock is not available stock',()=>{
  const result=buildInventory(snapshot);
  assert.equal(result.rows.find(r=>r.store_id==='a').quantity,0);
  const b=result.rows.find(r=>r.store_id==='b');assert.equal(b.quantity,null);assert.equal(b.status,'unknown');assert.equal(b.in_transit,3.5);
  assert.equal(result.rows.find(r=>r.store_id==='a').status,'out');
});
test('flat POS quantities cannot be copied into branches, and legacy availability defaults are not trusted',()=>{
  const result=buildInventory(snapshot,[],{at:Date.now(),products:[{id:'flower',name:'MAC1',stock:99},{id:'water',name:'Water',stock:12,stockRecorded:true,inventoryUnit:'ขวด'}]});
  assert.equal(result.rows.find(r=>r.id==='pos:flower').quantity,null);
  assert.equal(result.rows.find(r=>r.id==='pos:water').quantity,12);
  assert.equal(result.rows.filter(r=>r.store_id==='a').length,1);
  assert(result.rows.find(r=>r.id==='pos:water').read_only);
});
test('only the unreceived portion remains in transit after partial receiving',()=>{
 const result=buildInventory({...snapshot,transfers:[{status:'dispatched',to_store_id:'b',lines:[{item_type:'product',item_key:'flower',qty:10,qty_received:6,qty_missing:0}]}]});
 assert.equal(result.rows.find(r=>r.store_id==='b').in_transit,4);
 const closed=buildInventory({...snapshot,transfers:[{status:'completed',to_store_id:'b',lines:[{item_type:'product',item_key:'flower',qty:10,qty_received:6,qty_missing:4}]}]});
 assert.equal(closed.rows.find(r=>r.store_id==='b').in_transit,0);
});
test('stock search preserves SKU zeroes and costs are stripped without explicit permission',()=>{
  const result=buildInventory(snapshot,[],null,{costs:false});
  assert.equal(filterStock(result.rows,{search:'00001',store:'a'}).length,1);
  assert(!Object.hasOwn(result.rows[0],'cost'));assert(!Object.hasOwn(result.rows[0],'value'));
  assert.equal(buildInventory(snapshot,[],null,{costs:true}).rows[0].cost,100);
});
test('duplicate SKUs and unmatched ledger keys are visible instead of silently merged',()=>{
  const result=buildInventory({...snapshot,balances:[...snapshot.balances,{id:2,item_type:'product',item_key:'orphan',store_id:'a',balance_after:2}]},[{id:'other',sku:'00001',name:'Different product'}]);
  assert(result.warnings.some(w=>w.includes('SKU')));assert(result.warnings.some(w=>w.includes('orphan')));
  assert(result.rows.some(r=>r.item_key==='other'));assert(result.rows.some(r=>r.item_key==='flower'));
});
