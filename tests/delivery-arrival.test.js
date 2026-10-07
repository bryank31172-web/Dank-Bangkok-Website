import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../delivery.html',import.meta.url),'utf8');
const script=html.slice(html.indexOf('function riderHasArrived'),html.indexOf('async function poll'));
function label({distance=0,age=0,accuracy=5,destination={lat:13.7463,lng:100.5346}}={}){
 const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)};
 const last={status:'on_the_way',destination,location:{lat:13.7463+distance/111320,lng:100.5346,accuracy,capturedAt:Date.now()-age*1000,route:{minutes:1}}};
 const context=vm.createContext({last,el,Date,Intl,trackingMap:{error:()=>'',stale(){}}});vm.runInContext(script+';updateAge();',context);return el('arrivalTime').textContent;
}
test('fresh rider at destination shows Rider is here even when route ETA rounds to one minute',()=>assert.equal(label(),'Rider is here'));
test('one-minute ETA away from destination still shows minutes',()=>assert.equal(label({distance:200}),'1 min away'));
test('arrival requires destination and reasonably accurate GPS',()=>{assert.equal(label({destination:null}),'1 min away');assert.equal(label({accuracy:100}),'1 min away');});
test('90-second updates remain fresh but stale positions cannot claim arrival',()=>{assert.equal(label({age:95}),'Rider is here');assert.equal(label({age:211}),'ETA unavailable');});
