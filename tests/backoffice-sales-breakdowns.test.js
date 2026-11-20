import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOrder,buildReport,matches} from '../assets/backoffice-sales.js';

const scope={start:'2026-11-01T00:00:00+07:00',end:'2026-12-01T00:00:00+07:00'};
function receipt(extra={}){
  return normalizeOrder({
    id:'one',at:'2026-11-20T12:00:00+07:00',storeId:'main',tax:7,discount:10,
    total:107,customerId:'customer-a',cost:50,
    items:[
      {productKey:'p1',name:'Same name',sku:'001',category:'Flowers',qty:1,lineTotal:66},
      {productKey:'p2',name:'Same name',sku:'002',category:'Accessories',qty:2,lineTotal:44}
    ],...extra
  });
}
const moneyFields=['gross','discount','returns','net','tax','charges','total','cost','profit'];

test('product, category and SKU rows reconcile with receipt totals including returns and cancellations',()=>{
  const sale=receipt(),refund=receipt({id:'refund',type:'refund',tax:1.4,discount:0,total:21.4,cost:10,items:[{productKey:'p1',name:'Same name',sku:'001',category:'Flowers',qty:1,lineTotal:20}]}),
    cancelled=receipt({id:'cancelled',status:'cancelled'}),outside=receipt({id:'outside',at:scope.end});
  for(const group of ['product','category','sku']){
    const report=buildReport([sale,refund,cancelled,outside],scope,group);
    assert.equal(report.totals.total,85.6);
    assert.equal(report.totals.orders,1);
    assert.equal(report.totals.qty,2);
    assert.equal(report.rows.length,2);
    for(const field of moneyFields){
      const total=report.rows.reduce((sum,row)=>sum+Math.round(row[field]*100),0)/100;
      assert.equal(total,report.totals[field],group+' '+field);
    }
    for(const row of report.rows){
      const drilled=report.orders.filter(order=>matches(order,{...scope,itemGroup:group,itemKey:row.key}));
      assert.deepEqual(drilled.filter(order=>!order.cancelledAt).map(order=>order.id).sort(),row.orderIds.slice().sort());
    }
  }
});

test('same product names remain separate by product identity and SKU preserves leading zeroes',()=>{
  const report=buildReport([receipt()],scope,'product');
  assert.equal(report.rows.length,2);
  assert.equal(report.rows[0].label,report.rows[1].label);
  assert.notEqual(report.rows[0].key,report.rows[1].key);
  const skus=buildReport([receipt()],scope,'sku').rows.map(row=>row.label).sort();
  assert.deepEqual(skus,['001','002']);
});

test('repeated product lines count the receipt once and zero quantity is retained',()=>{
  const order=receipt({items:[
    {productKey:'p1',name:'A',sku:'001',qty:0,lineTotal:0},
    {productKey:'p1',name:'A',sku:'001',qty:2,lineTotal:110}
  ]});
  const report=buildReport([order],scope,'product');
  assert.equal(report.rows[0].orders,1);
  assert.equal(report.rows[0].qty,2);
  assert.equal(report.rows[0].total,107);
});

test('penny allocations never create negative sale amounts and preserve the recorded total',()=>{
  const order=receipt({total:.02,tax:0,discount:0,cost:0,items:Array.from({length:4},(_,i)=>({name:'Item '+i,sku:String(i),qty:1,lineTotal:1}))});
  const report=buildReport([order],scope,'sku');
  assert.equal(report.rows.reduce((sum,row)=>sum+Math.round(row.total*100),0),2);
  assert.ok(report.rows.every(row=>row.total>=0));
});

test('missing historical metadata stays visible and missing taxes and costs remain unknown',()=>{
  const order=receipt({tax:null,cost:null,items:[{name:'Old product',qty:1,lineTotal:107}]});
  for(const group of ['sku','category']){
    const report=buildReport([order],scope,group);
    assert.equal(report.rows.length,1);
    assert.equal(report.rows[0].missing,true);
    assert.equal(report.rows[0].total,107);
    assert.equal(report.rows[0].tax,null);
    assert.equal(report.rows[0].profit,null);
  }
});

test('unallocatable money remains in an explicit row and branch filters affect all views',()=>{
  const order=receipt({items:[{name:'No price',qty:1}]});
  const report=buildReport([order],scope,'product');
  assert.equal(report.allocation.unallocatedOrders,1);
  assert.equal(report.rows.reduce((sum,row)=>sum+row.total,0),107);
  assert.ok(report.rows.some(row=>row.key===JSON.stringify(['unallocated','product'])));
  assert.equal(buildReport([order],{...scope,store:'other'},'sku').rows.length,0);
});

test('receipt snapshot SKU and category take precedence over later raw metadata',()=>{
  const raw={id:'snapshot',at:'2026-11-20',items:[{name:'Renamed',sku:'NEW',category:'New'}],
    receipt:{id:'snapshot',at:'2026-11-20',total:10,tax:0,items:[{name:'Original',sku:'OLD',category:'Old',quantity:1,subtotal:10}]}};
  assert.equal(buildReport([normalizeOrder(raw)],scope,'sku').rows[0].label,'OLD');
  assert.equal(buildReport([normalizeOrder(raw)],scope,'category').rows[0].label,'Old');
});

test('saved report schedules accept each supported breakdown and reject variants',async()=>{
  const {validateDelivery}=await import('../api/_bo-report-delivery.js');
  for(const group of ['product','category','sku']){
    const schedule=validateDelivery({recipients:'test@example.com',frequency:'daily',hour:8,group});
    assert.equal(schedule.group,group);
  }
  assert.throws(()=>validateDelivery({recipients:'test@example.com',frequency:'daily',hour:8,group:'variant'}));
});

test('recorded-data endpoint uses the same group calculations and exact receipt drill filters',async()=>{
  process.env.STAFF_KEY='test-sales-breakdowns';
  const {setJSON,indexAdd}=await import('../api/_store.js');
  const {default:handler}=await import('../api/backoffice/sales.js');
  const raw={id:'breakdown-api-test',orderId:'breakdown-api-test',at:'2026-11-20T12:00:00+07:00',storeId:'group-test',
    total:107,tax:7,discount:10,cost:50,items:[{productKey:'p1',sku:'0007',category:'Flowers',name:'Recorded product',qty:1,lineTotal:110}]};
  await setJSON('order:'+raw.id,raw);
  await indexAdd(raw.id,'orders:index');
  async function call(query,headers={authorization:'Bearer test-sales-breakdowns'}){
    const response={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};
    await handler({method:'GET',headers,query:{...scope,store:'group-test',...query}},response);
    return response;
  }
  for(const group of ['product','category','sku']){
    const response=await call({group});
    assert.equal(response.statusCode,200);
    assert.equal(response.data.source,'recorded');
    assert.equal(response.data.rows[0].total,107);
    const drill=await call({itemGroup:group,itemKey:response.data.rows[0].key});
    assert.deepEqual(drill.data.orders.map(order=>order.id),[raw.id]);
    assert.equal((await call({itemGroup:group,itemKey:'missing'})).data.orders.length,0);
  }
  assert.equal((await call({group:'variant'})).statusCode,400);
  assert.equal((await call({group:'sku'},{})).statusCode,401);
});
