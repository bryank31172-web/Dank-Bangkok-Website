import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../backoffice.html', import.meta.url), 'utf8');
function extract(start, end) {
  const begin = html.indexOf(start), finish = html.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `Cannot find ${start}`);
  return html.slice(begin, finish);
}
function element(value = '') {
  return {
    value, innerHTML:'', isConnected:true,
    classList:{add(){},remove(){}},
    setAttribute(){}, removeAttribute(){}, replaceChildren(){}, append(){}, remove(){},
  };
}
function createContext(values) {
  const context=vm.createContext({
    document:{createElement:()=>element()},
    matchMedia:()=>({matches:true}),
    ...values,
  });
  vm.runInContext(extract('const dataLoads=new WeakMap();','function beginDataLoad')+
    extract('function beginDataLoad','\n}\n')+'\n}',context);
  return context;
}

test('expense loading failure is shown instead of a false zero balance', async () => {
  const elements = {'#expList':element(), '#expMonthly':element(), '#expUpcoming':element()};
  const context = createContext({
    $:selector => elements[selector], esc:s=>String(s),
    boGet:async()=>{throw new Error('offline');}, renderExpenseList(){throw new Error('unexpected render');},
  });
  vm.runInContext(extract('async function refreshExpenses(){','function renderExpenseList(){'),context);
  await context.refreshExpenses();
  assert.match(elements['#expList'].innerHTML, /Could not load expenses: offline/);
  assert.match(elements['#expMonthly'].innerHTML, /unavailable/);
  assert.match(elements['#expUpcoming'].innerHTML, /unavailable/);
});

test('expense view shows monthly comparisons and the upcoming forecast', async () => {
  const elements = {'#expList':element(), '#expMonthly':element(), '#expUpcoming':element()};
  const now=new Date(), key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const current=key(now), previous=key(new Date(now.getFullYear(),now.getMonth()-1,1));
  const context=createContext({
    $:selector=>elements[selector], Date, Set, _expRows:[], _expTotal:0, _expSelected:new Set(),
    esc:s=>String(s), money:n=>`THB ${n}`, renderExpenseList(){},
    boGet:async()=>({rows:[],total:0,monthly:[
      {month:current,total:125,byCategory:{rent:125}}, {month:previous,total:100,byCategory:{rent:100}},
    ],upcomingAsOf:'2026-11-01',upcoming:[{date:'2026-11-08',category:'rent',vendor:'Landlord',amount:125,recurring:'monthly'}]}),
  });
  vm.runInContext(extract('async function refreshExpenses(){','function renderExpenseList(){'),context);
  await context.refreshExpenses();
  assert.match(elements['#expMonthly'].innerHTML,/This month/);
  assert.match(elements['#expMonthly'].innerHTML,/Difference:<\/b> THB 25/);
  assert.match(elements['#expUpcoming'].innerHTML,/2026-11-08/);
  assert.match(elements['#expUpcoming'].innerHTML,/Landlord/);
});

test('audit date inputs are sent with a staff filter and an exclusive end date', async () => {
  const elements={'#auditEntityType':element('expense'),'#auditActor':element('staff-1'),
    '#auditFrom':element('2026-11-01'),'#auditTo':element('2026-11-02'),'#auditLog':element()};
  let requested;
  const context=createContext({
    $:selector=>elements[selector], URLSearchParams, Date, encodeURIComponent, esc:s=>String(s),
    boGet:async url=>{ requested=url; return {rows:[]}; },
  });
  vm.runInContext(extract('async function renderAuditLog(){','async function renderStoreMgmt(){'),context);
  await context.renderAuditLog();
  const query=new URL(requested,'https://example.invalid').searchParams;
  assert.equal(query.get('actor'),'staff-1');
  assert.equal(query.get('entity_type'),'expense');
  assert.equal(query.get('from'),new Date('2026-11-01T00:00:00').toISOString());
  assert.equal(query.get('to'),new Date('2026-11-03T00:00:00').toISOString());
  assert.match(elements['#auditLog'].innerHTML,/No audit entries match/);
  requested=null; elements['#auditFrom'].value='2026-11-03';
  await context.renderAuditLog();
  assert.equal(requested,null);
  assert.match(elements['#auditLog'].innerHTML,/start date/);
});
