import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup() {
  const html = fs.readFileSync(new URL('../backoffice.html', import.meta.url), 'utf8');
  const elements = new Map();
  const context = {
    BOI18n:{t:value=>value,formatDate:(value,method,options)=>new Date(value)[method]('th-TH-u-ca-gregory',options)},
    OV_RANGE: 'today',OV_DEMO:true,SALES:null,ORDERS_EXACT_SCOPE:null,SALES_RETURN_TO_REPORT:false, esc: String, dashboardMoney: String,
    currentDemoSalesData:()=>context.overviewDemoData(),
    overviewDemoData: () => ({ sampleData:true,mockOrders: [
      { id: 'R-001', product: 'MAC1', at: new Date(2026, 10, 12).getTime(), subtotal: 100, discount: 5, tax: 6.65, profit: 35 },
      { id: 'R-002', product: 'MAC1', at: new Date(2026, 10, 12, 23, 59, 59, 999).getTime(), subtotal: 200, discount: 0, tax: 14, profit: 70 },
      { id: 'R-003', product: 'Gelato', at: new Date(2026, 10, 13).getTime(), subtotal: 300, discount: 0, tax: 21, profit: 100 },
      { id: 'R-004', product: 'Gelato', at: new Date(2026, 10, 11, 23, 59).getTime(), subtotal: 50, discount: 0, tax: 3.5, profit: 20 },
    ] }),
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [2026, 10, 12, 13])); } },
    $: selector => {
      if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', value: '', hidden: true, focus() {}, setAttribute() {}, append() {} });
      return elements.get(selector);
    },
  };
  vm.createContext(context);
  vm.runInContext(html.match(/^const accordionChevron=.*$/m)[0], context);
  vm.runInContext(html.slice(html.indexOf('const ORDERS_PAGE_SIZE='), html.indexOf('function viewDirectory(')), context);
  return { context, elements, run: code => vm.runInContext(code, context) };
}

test('date presets use calendar boundaries and clamp month-end dates', () => {
  const { context } = setup();
  const key = context.orderDateKey;
  const range = preset => context.orderPresetRange(preset);
  assert.equal(key(range('yesterday').start), '2026-11-11');
  assert.equal(key(range('thisWeek').start), '2026-11-09');
  assert.equal(key(range('lastWeek').start), '2026-11-02');
  assert.equal(key(range('lastWeek').end), '2026-11-08');
  assert.equal(key(range('last7').start), '2026-11-06');
  assert.equal(key(range('lastMonth').start), '2026-10-01');
  assert.equal(key(range('lastMonth').end), '2026-10-31');
  assert.equal(key(range('thisYear').start), '2026-01-01');
  assert.equal(key(range('lastYear').end), '2025-12-31');
  assert.equal(key(context.orderPresetRange('lastMonths', new Date(2024, 2, 31), 1).start), '2024-02-29');
  assert.equal(context.orderPresetRange('lastMonths', new Date(), 0), null);
  assert.equal(context.parseOrderDate('31/02/2026'), null);
  assert.equal(key(context.parseOrderDate('29/02/2024')), '2024-02-29');
});

test('date, receipt search and product filters intersect with inclusive end dates', () => {
  const { context, run } = setup();
  context.ensureOrdersData();
  assert.deepEqual(Array.from(context.filteredOrders(), order => order.id), ['R-002', 'R-001']);
  run("ORDERS_SEARCH='r-002'");
  assert.deepEqual(Array.from(context.filteredOrders(), order => order.id), ['R-002']);
  run("ORDERS_PRODUCT_FILTER='Gelato'");
  assert.equal(context.filteredOrders().length, 0);
  run("ORDERS_SEARCH='';ORDERS_PRODUCT_FILTER='';ORDERS_DATE_RANGE=orderPresetRange('yesterday')");
  assert.deepEqual(Array.from(context.filteredOrders(), order => order.id), ['R-004']);
});

test('date picker cancel preserves filters and apply rejects invalid or reversed dates', () => {
  const { context, elements, run } = setup();
  context.ensureOrdersData();
  context.openOrdersDatePicker();
  assert.equal((elements.get('#ordersDatePanel').innerHTML.match(/data-act="orders-date-day"/g) || []).length, 42);
  context.chooseOrdersDatePreset('yesterday');
  context.closeOrdersDatePicker();
  assert.equal(context.filteredOrders().length, 2);
  context.openOrdersDatePicker();
  elements.get('#ordersDateStart').value = '13/11/2026';
  context.$('#ordersDateEnd').value = '12/11/2026';
  context.applyOrdersDateRange();
  assert(context.$('#ordersDateError').textContent.length > 0);
  assert.equal(context.filteredOrders().length, 2);
  run("ORDERS_DATE_DRAFT.preset='custom'");
  context.$('#ordersDateStart').value = '11/11/2026';
  context.$('#ordersDateEnd').value = '11/11/2026';
  context.applyOrdersDateRange();
  assert.deepEqual(Array.from(context.filteredOrders(), order => order.id), ['R-004']);
});

test('CSV contains filtered rows, Thai headings, decimal amounts and escaped cells', () => {
  const { context } = setup();
  const orders = Array.from(context.filteredOrders());
  orders[0].branch = '=SUM(1,2)';
  orders[0].employee = 'พนักงาน "หนึ่ง"';
  const csv = context.buildOrdersCSV(orders);
  assert(csv.startsWith('\uFEFF"เลขที่รายการ","วันที่ / เวลา","สาขา"'));
  assert.equal(csv.split('\r\n').length, 3);
  assert(csv.includes('"\'=SUM(1,2)"'));
  assert(csv.includes('"พนักงาน ""หนึ่ง"""'));
  assert(csv.includes('"200.00"'));
  assert.equal(csv.includes('R-003'), false);
  assert.equal(context.buildOrdersCSV([]).split('\r\n').length, 1);
});

test('branch selection filters CSV and cancelling preserves the applied selection', () => {
  const { context, run } = setup();
  context.ensureOrdersData();
  run("ORDERS_SOURCE_DATA.mockOrders[0].branch='Sathorn';ORDERS_SOURCE_DATA.mockOrders[1].branch='Phuket';ORDERS_BRANCHES=new Set(['Sathorn'])");
  assert.deepEqual(Array.from(context.filteredOrders(), order => order.id), ['R-001']);
  const csv=context.buildOrdersCSV(context.filteredOrders());
  assert(csv.includes('R-001'));
  assert.equal(csv.includes('R-002'), false);
  context.openOrdersBranches();
  run("ORDERS_BRANCH_DRAFT.clear()");
  context.closeOrdersBranches();
  assert.deepEqual(Array.from(context.filteredOrders(), order => order.id), ['R-001']);
  run('ORDERS_BRANCHES=new Set()');
  assert.equal(context.filteredOrders().length, 0);
  run('ORDERS_BRANCHES=null');
  assert.equal(context.filteredOrders().length, 2);
});
