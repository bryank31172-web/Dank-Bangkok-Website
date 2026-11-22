import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('mock order financial columns reconcile with dashboard sales for every period', () => {
  const html = fs.readFileSync(new URL('../backoffice.html', import.meta.url), 'utf8');
  const output = { innerHTML: '', focus() {}, scrollIntoView() {},append() {} };
  const storage = new Map();
  const context = {
    BOI18n:{t:value=>value,formatDate:(value,method,options)=>new Date(value)[method]('th-TH-u-ca-gregory',options)},
    OV_RANGE: 'today', OV_DEMO: true,
    STORE_DIRECTORY:[{id:'main',name:'DANK Pattanakarn (Main)'},{id:'sathorn',name:'DANK Sathorn'},{id:'deleted',name:'Deleted store',deletedAt:'2026-11-01'}],
    SALES:null,SALES_RETURN_TO_REPORT:false,ORDERS_EXACT_SCOPE:null,OV_LAST_DATA:null,
    currentDemoSalesData:()=>context.overviewDemoData(),
    OV_RANGES: ['today', 'week', 'month', 'year'].map(id => ({ id, label: id })),
    $: () => output, esc: value => String(value),
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    toast() {},
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [2026, 10, 12, 12])); } },
  };
  vm.createContext(context);
  vm.runInContext(html.match(/^const accordionChevron=.*$/m)[0], context);
  vm.runInContext(html.slice(html.indexOf('function overviewMockOrders('), html.indexOf('async function loadOverview(){')), context);
  vm.runInContext(html.slice(html.indexOf('const ORDERS_PAGE_SIZE='), html.indexOf('function viewDirectory(')), context);
  const cents = amount => Math.round(amount * 100);
  for (const range of ['today', 'week', 'month', 'year']) {
    context.OV_RANGE = range;
    const data = context.overviewDemoData();
    assert.equal(data.mockOrders.length, 12);
    for (const order of data.mockOrders) {
      assert(order.branch && order.employee && order.orderType);
      assert.equal(cents(order.subtotal) - cents(order.discount) + cents(order.tax), cents(order.total));
      assert.equal(cents(order.subtotal) - cents(order.discount) - cents(order.cost), cents(order.profit));
    }
    assert.equal(data.mockOrders.reduce((sum, order) => sum + cents(order.total), 0), cents(data.sales.total));
    context.viewOrders();
    const headings = [...output.innerHTML.matchAll(/<th>(.*?)<\/th>/g)].map(match => match[1].replace(/<details[\s\S]*?<\/details>/,'').trim());
    assert.deepEqual(headings, ['เลขที่รายการ', 'วันที่ / เวลา', 'สาขา', 'พนักงาน', 'ประเภทคำสั่งซื้อ', 'ราคาก่อนส่วนลด', 'ส่วนลด', 'ภาษี', 'ยอดรวม', 'ต้นทุน', 'กำไร']);
    assert.ok(data.mockOrders.every(order=>order.branch!=='Deleted store'));
    const body = output.innerHTML.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    assert.equal((body.match(/<tr>/g) || []).length, 12);
    assert(output.innerHTML.includes('แสดง 1-12 จาก 12 แถว'));
    const receiptIds = [...body.matchAll(/data-act="order-detail" data-id="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(receiptIds).size, 12);
    for (const id of receiptIds.slice(0, 2)) {
      const order = data.mockOrders.find(row => row.id === id);
      context.openOrderDetail(id);
      const markup = output.innerHTML;
      for (const value of [order.id, order.customer, order.branch, order.employee, order.product, order.orderType]) {
        assert(markup.includes(value));
      }
      const total = order.total.toLocaleString('en-US', { minimumFractionDigits: 2 });
      assert(markup.includes(`รวมทั้งสิ้น</th><td>${total}</td>`));
      assert(markup.includes(`*Added by ${order.employee}</p>`));
      context.openOrderDetail('unknown');
      assert.equal(output.innerHTML, markup);
    }
  }
  assert(context.summaryCard('ยอดขายทั้งหมด', 'THB 1,000.00', 10, true, true).includes('data-act="sales-report-from-home"'));
  context.OV_DEMO = false;
  assert(context.summaryCard('ยอดขายทั้งหมด', 'THB 1,000.00', 10, true, true).includes('data-tab="reports"'));
  context.OV_DEMO = true;

  const before = context.overviewDemoData();
  const [target, other] = before.mockOrders;
  context.confirm = () => false;
  context.cancelOrder(target.id);
  assert.equal(storage.size, 0);
  context.confirm = () => true;
  context.cancelOrder(target.id);
  assert(output.innerHTML.includes('ยกเลิกแล้ว'));
  assert.match(output.innerHTML, /data-act="order-cancel"[^>]* disabled>/);
  const after = context.overviewDemoData();
  assert(after.mockOrders.find(order => order.id === target.id).cancelledAt);
  assert.equal(after.mockOrders.find(order => order.id === other.id).cancelledAt, undefined);
  assert.equal(cents(after.sales.total), cents(before.sales.total) - cents(target.total));
  context.viewOrders();
  assert(output.innerHTML.includes('รวมทั้งหมด 11 รายการ'));
  context.OV_RANGE = 'today';
  assert.equal(context.overviewDemoData().mockOrders.find(order => order.id === target.id).cancelledAt, undefined);
});
