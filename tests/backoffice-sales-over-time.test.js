import test from 'node:test';
import assert from 'node:assert/strict';
import {setJSON} from '../api/_store.js';
import {makeBackofficeToken} from '../api/_auth.js';
import salesHandler from '../api/backoffice/sales.js';
import dashboardHandler from '../api/backoffice/dashboard.js';
import {normalizeOrder,buildReport,dateBounds,presetWindow,previousWindow} from '../assets/backoffice-sales.js';
import {validateDelivery,dueWindow} from '../api/_bo-report-delivery.js';
import deliveryRun from '../api/backoffice/report-delivery-run.js';

async function call(handler,query={},authorized=true){
  const req={method:'GET',url:'/api/backoffice/sales',query,headers:authorized?{authorization:'Bearer '+makeBackofficeToken()}:{}};
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await handler(req,res);return res;
}
test('all archived receipts beyond 500 reconcile Home, report buckets and receipt drill-down to the satang',async context=>{
  process.env.BACKOFFICE_PASSWORD='test-local-password';process.env.ADMIN_SECRET='test-local-secret';
  context.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T12:00:00+07:00').getTime()});
  const rows=Array.from({length:530},(_,i)=>({
    orderId:String(i).padStart(6,'0'),at:+new Date('2026-11-20T00:15:00+07:00')+i*1000,
    storeId:i<520?'a':'b',storeName:i<520?'สาขา A':'สาขา B',employee:'staff-a',channel:'web',fulfilment:'delivery',
    total:10.71,subtotal:11,discount:1,tax:.70,deliveryFee:.01,cost:4,
    customerId:i%2?'member-a':'member-b',items:[{name:'MAC1',qty:1,lineTotal:11}],payments:[{method:'Cash',amount:10.71}]
  }));
  rows.push({orderId:'cancelled',at:rows[0].at,storeId:'a',status:'cancelled',total:999,tax:0});
  rows.push({orderId:'return-1',at:rows[0].at,storeId:'a',type:'return',total:10.71,tax:.70,deliveryFee:.01,cost:4});
  rows.push({orderId:'future',at:+new Date('2026-11-21T00:00:00+07:00'),storeId:'a',total:1000});
  // A later edit to raw values must not replace the original sale snapshot.
  rows[0].receipt={total:rows[0].total,tax:rows[0].tax,discount:rows[0].discount,at:rows[0].at,items:rows[0].items};
  rows[0].total=999;
  await setJSON('orders:index',rows.slice(0,500).map(o=>o.orderId));
  await setJSON('orders:index:archive',rows.slice(500).map(o=>o.orderId));
  for(const row of rows)await setJSON('order:'+row.orderId,row);
  const scope={...presetWindow('today'),store:'a',group:'hour'};
  const report=await call(salesHandler,scope),home=await call(dashboardHandler,{range:'today',store:'a'});
  assert.equal(report.code,200);assert.equal(home.code,200);
  assert.equal(report.data.coverage.indexed,533);assert.equal(report.data.coverage.complete,true);
  assert.equal(report.data.totals.orders,520);
  assert.equal(report.data.totals.total,5558.49);
  assert.equal(report.data.totals.total,home.data.sales.total);
  assert.equal(report.data.totals.total,report.data.rows.reduce((sum,row)=>Math.round((sum+row.total)*100)/100,0));
  assert.equal(report.data.orders[0].id,'000000');
  assert.equal(report.data.totals.cancelled,1);assert.equal(report.data.totals.returns,10.71);
  assert.equal(report.data.totals.customers,2);
  const bucket=report.data.rows.find(row=>row.orders);
  const drill=await call(salesHandler,{...scope,start:bucket.start,end:bucket.end,payment:'Cash'});
  assert.equal(drill.data.totals.orders,520);
  // Split-tender filtering selects matching receipts, and retains each whole receipt.
  assert.equal(drill.data.totals.total,5569.20);
  const noMatch=await call(salesHandler,{...scope,employee:'missing'});
  assert.equal(noMatch.data.totals.total,0);
  const invalid=await call(salesHandler,{start:'bad',end:scope.end});assert.equal(invalid.code,400);
  assert.equal((await call(salesHandler,scope,false)).code,401);
});

test('Bangkok buckets cross UTC midnight correctly and month comparisons clamp to calendar boundaries',()=>{
  const bounds=dateBounds('2026-11-20','2026-11-20');
  assert.equal(bounds.start,'2026-11-19T17:00:00.000Z');
  assert.equal(bounds.end,'2026-11-20T17:00:00.000Z');
  assert.throws(()=>dateBounds('2026-02-30','2026-03-01'));
  const orders=[normalizeOrder({id:'early',at:+new Date('2026-11-19T17:01:00Z'),total:.10,tax:0}),normalizeOrder({id:'late',at:+new Date('2026-11-20T16:59:59Z'),total:.20,tax:0}),normalizeOrder({id:'next-day',at:+new Date(bounds.end),total:99,tax:0})];
  const report=buildReport(orders,bounds,'hour');
  assert.equal(report.rows.length,24);assert.equal(report.rows[0].total,.10);assert.equal(report.rows.at(-1).total,.20);assert.equal(report.totals.total,.30);
  const month=presetWindow('month',+new Date('2026-03-31T12:00:00+07:00'));
  assert.equal(previousWindow(month,'month').end,'2026-02-28T17:00:00.000Z');
});

test('missing tax and historical costs stay unavailable, and cancellations never become returns',()=>{
  const orders=[normalizeOrder({id:'legacy',at:1,total:100,customer:'Same Name'}),normalizeOrder({id:'cancel',at:2,status:'cancelled',total:999})];
  const report=buildReport(orders,{start:new Date(0).toISOString(),end:new Date(10).toISOString()},'day');
  assert.equal(report.totals.total,100);assert.equal(report.totals.net,null);assert.equal(report.totals.tax,null);assert.equal(report.totals.profit,null);assert.equal(report.totals.returns,0);assert.equal(report.totals.customers,0);
  const negativeReturn=normalizeOrder({id:'negative-refund',at:3,type:'refund',total:-10,tax:-1,cost:-4});
  const withReturn=buildReport([...orders,negativeReturn],{start:new Date(0).toISOString(),end:new Date(10).toISOString()},'day');
  assert.equal(withReturn.totals.total,90);assert.equal(withReturn.totals.returns,10);
});

test('scheduled reports validate recipients, use completed Bangkok periods and reject unsigned runs without sending',async()=>{
  assert.throws(()=>validateDelivery({recipients:'bad',frequency:'daily',hour:8}));
  const schedule=validateDelivery({recipients:'owner@example.com, manager@example.com',frequency:'weekly',hour:8});
  assert.equal(schedule.recipients.length,2);
  assert.equal(dueWindow(schedule,+new Date('2026-11-23T07:59:00+07:00')),null);
  const week=dueWindow(schedule,+new Date('2026-11-23T08:00:00+07:00'));
  assert.equal(week.start,'2026-11-15T17:00:00.000Z');assert.equal(week.end,'2026-11-22T17:00:00.000Z');
  const month=dueWindow({...schedule,frequency:'monthly'},+new Date('2026-03-01T08:00:00+07:00'));
  assert.equal(month.start,'2026-01-31T17:00:00.000Z');assert.equal(month.end,'2026-02-28T17:00:00.000Z');
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await deliveryRun({method:'GET',headers:{}},res);assert.equal(res.code,401);
});
