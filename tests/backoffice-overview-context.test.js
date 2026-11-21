import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../backoffice.html',import.meta.url),'utf8');
function context(){
  const ctx={esc:String,BOI18n:{formatDate:(value,method,options)=>new Date(value)[method]('th-TH-u-ca-gregory',options)}};
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('function overviewDemoPeriods('),html.indexOf('function dashboardMoney(')),ctx);
  return ctx;
}
test('dashboard timestamps display in Bangkok even when the browser uses another timezone',()=>{
  const ctx=context();
  const timestamp='2026-11-20T18:30:00.000Z';
  const text=ctx.overviewPeriodText({start:timestamp,end:timestamp});
  assert.match(text,/21/);
  assert.match(text,/2026/);
  assert.match(text,/01:30/);
  assert.equal(ctx.overviewPeriodText({}),'—');
});
test('sample and failed dashboard loads do not claim a successful sync',()=>{
  const ctx=context();
  const sample=ctx.overviewDemoPeriods('month',new Date(2026,2,31,12));
  assert.equal(sample.lastSyncedAt,null);
  assert.equal(sample.comparisonPeriod.end,new Date(2026,2,1).toISOString());
  assert.match(ctx.overviewContext(sample,false),/ข้อมูลตัวอย่าง — ไม่มีการซิงก์/);
  assert.match(ctx.overviewContext({},true),/ยังไม่มีการซิงก์สำเร็จ/);
  assert.match(ctx.overviewContext({lastSyncedAt:'2026-11-20T08:35:00Z'},false),/15:35/);
  assert.doesNotMatch(ctx.overviewContext({lastSyncedAt:'2026-11-20T08:35:00Z'},true),/15:35/);
});
