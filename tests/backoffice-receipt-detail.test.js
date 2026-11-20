import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../backoffice.html',import.meta.url),'utf8');
function setup(){
  const output={innerHTML:'',focus(){},scrollIntoView(){}};
  const context={
    OV_DEMO:true,
    BOI18n:{formatDate:(value,method,options)=>new Date(value)[method]('en-GB',options)},
    $:()=>output,esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function createOrderReceiptSnapshot('),html.indexOf('function readOrderCancellations(')),context);
  vm.runInContext(html.slice(html.indexOf('function openOrderDetail('),html.indexOf('function cancelOrder(')),context);
  return {context,output};
}
const sample=()=>({id:'R-001',at:Date.UTC(2026,10,20,8),branch:'Original shop',customer:'Test customer',employee:'Test employee',
  subtotal:200,discount:20,tax:12.60,total:192.60,profit:80,
  items:[{name:'Product A',sku:'A-1',quantity:1,unitPrice:100,subtotal:100,discount:20,tax:5.60,total:85.60},
    {name:'Product B',sku:'B-1',quantity:2,unitPrice:50,subtotal:100,discount:0,tax:7,total:107}],
  payments:[{method:'Cash',amount:92.60,tendered:100,change:7.40},{method:'PromptPay',amount:100,tendered:100,change:0}]});

test('sale snapshot keeps original prices, names, tax and payments after source changes and JSON reload',()=>{
  const {context}=setup();const order=sample();
  const snapshot=context.createOrderReceiptSnapshot(order);
  order.items[0].name='Renamed';order.items[0].unitPrice=999;order.payments[0].amount=1;order.tax=99;order.branch='New shop';
  assert.equal(snapshot.items[0].name,'Product A');assert.equal(snapshot.items[0].unitPrice,100);
  assert.equal(snapshot.payments[0].amount,92.60);assert.equal(snapshot.tax,12.60);assert.equal(snapshot.branch,'Original shop');
  assert(Object.isFrozen(snapshot.items[0]));
  const saved=JSON.parse(JSON.stringify(snapshot));
  assert.equal(saved.items[0].unitPrice,100);assert.equal(saved.tax,12.60);
  assert.equal(saved.items.reduce((sum,item)=>sum+Math.round(item.total*100),0),Math.round(saved.total*100));
});

test('detail shows every original line, split payments, change and cancellation without changing the sale',()=>{
  const {context,output}=setup();const order=sample();order.receipt=context.createOrderReceiptSnapshot(order);
  order.items[0].unitPrice=999;order.branch='Changed shop';order.total=1;
  order.cancelledAt=Date.UTC(2026,10,20,9);order.cancelledBy='Manager';order.cancelReason='<script>bad</script>';
  context.ORDERS_SOURCE_DATA={mockOrders:[order]};context.openOrderDetail('R-001');
  const markup=output.innerHTML;
  for(const value of ['Product A','Product B','A-1','B-1','Original shop','Cash','PromptPay','192.60','7.40','Transaction cancelled','Manager','15:00'])assert(markup.includes(value),value);
  assert(!markup.includes('Changed shop'));assert(!markup.includes('<script>bad'));
  assert(markup.includes('&lt;script>bad'));assert.equal(order.receipt.total,192.60);
  context.openOrderDetail('missing');assert.equal(output.innerHTML,markup);
});

test('legacy receipts show missing payment data without inventing a method or tax',()=>{
  const {context,output}=setup();const order={id:'OLD-1',product:'Legacy product',qty:2,subtotal:80,discount:0,total:80};
  context.ORDERS_SOURCE_DATA={mockOrders:[order]};context.openOrderDetail(order.id);
  assert(output.innerHTML.includes('Payment details were not recorded.'));
  assert(output.innerHTML.includes('Legacy product'));assert.equal(order.receipt.items[0].unitPrice,40);
  assert.equal(order.receipt.tax,undefined);assert.equal(order.receipt.payments.length,0);
});
