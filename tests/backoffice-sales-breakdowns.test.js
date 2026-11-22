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

test('category filter selects matching receipts and supports empty and multiple selections',()=>{
  const sale=receipt();
  assert.equal(buildReport([sale],{...scope,categories:JSON.stringify(['Flowers'])},'day').totals.total,107);
  assert.equal(buildReport([sale],{...scope,categories:JSON.stringify(['Other'])},'day').totals.total,0);
  assert.equal(matches(sale,{...scope,categories:'[]'}),false);
  assert.equal(matches(sale,{...scope,categories:JSON.stringify(['Flowers','Accessories'])}),true);
});

test('shift sessions use recorded boundaries and keep unassigned receipts explicit',()=>{
  const first=receipt({shiftId:'s1',shiftStartedAt:'2026-11-20T08:00:00+07:00',shiftEndedAt:'2026-11-20T16:00:00+07:00',posNumber:'01',preorderDeposit:10}),
    second=receipt({id:'two',shiftId:'s1',shiftStartedAt:first.shiftStartedAt,shiftEndedAt:first.shiftEndedAt,posNumber:'01',preorderDeposit:20}),
    unknown=receipt({id:'unknown'});
  const report=buildReport([first,second,unknown],scope,'shift');
  assert.equal(report.rows.length,2);
  const session=report.rows.find(row=>row.posNumber==='01');
  assert.equal(session.transactions,2);
  assert.equal(session.total,214);
  assert.equal(session.deposits,30);
  assert.equal(session.shiftStartedAt,first.shiftStartedAt);
  assert.equal(report.rows.find(row=>row.orderIds.includes('unknown')).shiftStartedAt,null);
  assert.equal(report.totals.deposits,null);
  assert.equal(matches(unknown,{...scope,itemGroup:'shift',itemKey:session.key}),false);
  assert.equal(matches(first,{...scope,itemGroup:'shift',itemKey:session.key}),true);
});

test('channel fees, refunds and transactions reconcile without inventing rounding',()=>{
  const sale=receipt({channel:'website',deliveryFee:20,serviceCharge:5,total:132,rounding:0.25}),
    refund=receipt({id:'refund',type:'refund',channel:'website',total:22,tax:0,deliveryFee:2,serviceCharge:0,rounding:0.05}),
    cancelled=receipt({id:'cancelled',status:'cancelled',deliveryFee:999});
  const report=buildReport([sale,refund,cancelled],scope,'channel');
  assert.equal(report.rows.length,1);
  assert.equal(report.rows[0].transactions,2);
  assert.equal(report.rows[0].total,110);
  assert.equal(report.rows[0].deliveryFee,18);
  assert.equal(report.rows[0].serviceCharge,5);
  assert.equal(report.rows[0].rounding,0.2);
  assert.equal(report.rows[0].net,80);
  assert.equal(buildReport([receipt()],scope,'channel').rows[0].rounding,null);
});

test('product report metadata, quantities, values and weighted averages reconcile to receipts',()=>{
  const sale=receipt(),refund=receipt({id:'refund',type:'refund',tax:1.4,total:21.4,discount:0,cost:10,items:[{productKey:'p1',name:'Same name',sku:'001',category:'Flowers',qty:1,lineTotal:20}]}),
    cancelled=receipt({id:'cancelled',status:'cancelled'});
  const report=buildReport([sale,refund,cancelled],scope,'product');
  assert.equal(report.totals.soldQty,3);
  assert.equal(report.totals.productValue,107);
  assert.equal(report.totals.returnedValue,21.4);
  assert.equal(report.totals.averageCost,20);
  assert.equal(report.totals.averageNet,40);
  assert.equal(report.rows.find(row=>row.sku==='001').category,'Flowers');
  const skus=buildReport([sale,refund,cancelled],scope,'sku');
  const firstSku=skus.rows.find(row=>row.sku==='001');
  assert.equal(firstSku.productName,'Same name');
  assert.equal(firstSku.skuName,'Same name');
  assert.equal(firstSku.category,'Flowers');
  for(const key of ['soldQty','productValue','discount','net','cost','profit']){
    assert.equal(Math.round(skus.rows.reduce((sum,row)=>sum+row[key],0)*100),Math.round(report.totals[key]*100),key);
  }
  const categories=buildReport([sale,refund,cancelled],scope,'category');
  for(const key of ['soldQty','productValue','discount','net','cost','profit']){
    assert.equal(Math.round(categories.rows.reduce((sum,row)=>sum+row[key],0)*100),Math.round(report.totals[key]*100),key);
  }
  assert.equal(categories.totals.averageCost,report.totals.averageCost);
  assert.equal(categories.totals.averageNet,report.totals.averageNet);
  for(const key of ['soldQty','productValue','returnedValue','discount','net','cost','profit']){
    assert.equal(Math.round(report.rows.reduce((sum,row)=>sum+row[key],0)*100),Math.round(report.totals[key]*100),key);
  }
  for(const row of report.rows){
    const receipts=[sale,refund,cancelled].filter(order=>matches(order,{...scope,itemGroup:'product',itemKey:row.key}));
    assert.ok(row.orderIds.every(id=>receipts.some(order=>order.id===id)));
  }
  const unknown=buildReport([receipt({cost:null,items:[{name:'Unknown',qty:1,lineTotal:110}]})],scope,'product');
  assert.equal(unknown.rows[0].averageCost,null);
  assert.equal(unknown.rows[0].profit,null);
});

test('time report percentages use gross sales and preserve unknown manual discounts',()=>{
  const sale=receipt({manualDiscount:5}),refund=receipt({id:'refund',type:'refund',total:20,tax:0,cost:5});
  const totals=buildReport([sale,refund],scope,'day').totals;
  assert.equal(totals.transactions,2);
  assert.equal(totals.discountPct,9.09);
  assert.equal(totals.manualDiscountPct,4.55);
  assert.equal(totals.manualDiscount,5);
  assert.equal(buildReport([receipt()],scope,'day').totals.manualDiscount,null);
  assert.equal(buildReport([receipt()],scope,'day').totals.manualDiscountPct,null);
  assert.equal(buildReport([],scope,'day').totals.manualDiscountPct,0);
});

test('transaction reports reconcile and drill down without duplicating split payments',()=>{
  const sale=receipt({channel:'website',shiftName:'Morning',promoCode:'SAVE',payments:[{method:'Cash',amount:50},{method:'PromptPay',amount:57}]}),
    refund=receipt({id:'refund',type:'refund',total:20,tax:0,cost:5,channel:'website'}),
    cancelled=receipt({id:'cancelled',status:'cancelled'});
  for(const group of ['channel','shift','promotion']){
    const report=buildReport([sale,refund,cancelled],scope,group);
    assert.equal(report.totals.total,87);
    assert.equal(report.rows.reduce((sum,row)=>sum+row.total,0),87);
    for(const row of report.rows){
      assert.deepEqual([sale,refund].filter(order=>matches(order,{...scope,itemGroup:group,itemKey:row.key})).map(o=>o.id).sort(),row.orderIds.slice().sort());
    }
  }
  const paymentReport=buildReport([sale],scope,'payment');
  assert.deepEqual(paymentReport.rows.map(row=>[row.label,row.charged]),[['Cash',50],['PromptPay',57]]);
  assert.equal(paymentReport.totals.transactions,1);
  assert.equal(paymentReport.totals.charged,107);
  for(const row of paymentReport.rows)assert.ok(matches(sale,{...scope,itemGroup:'payment',itemKey:row.key}));
});

test('payment report separates channels, reconciles refunds and preserves unknown split amounts',()=>{
  const first=receipt({channel:'website',payments:[{method:'Cash',amount:107}]}),
    second=receipt({id:'two',channel:'store',payments:[{method:'Cash',amount:107}]}),
    refund=receipt({id:'refund',type:'refund',channel:'website',total:20,tax:0,payments:[{method:'Cash',amount:20}]});
  const report=buildReport([first,second,refund],scope,'payment');
  assert.equal(report.rows.length,2);
  assert.equal(report.totals.charged,214);
  assert.equal(report.totals.refunded,20);
  assert.equal(report.totals.paymentNet,194);
  assert.equal(report.rows.find(row=>row.channel==='website').paymentNet,87);
  assert.equal(matches(second,{...scope,itemGroup:'payment',itemKey:report.rows.find(row=>row.channel==='website').key}),false);
  const unknown=buildReport([receipt({payments:[{method:'Cash'},{method:'Card'}]})],scope,'payment');
  assert.equal(unknown.totals.charged,null);
  assert.equal(unknown.rows[0].preorderDeposit,null);
});

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
