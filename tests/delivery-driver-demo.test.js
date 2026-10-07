import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createDemoHandler} from '../api/delivery-demo.js';
test('rider page demo exercises sample photo, start, move, pause, resume and completion without real GPS or order API',async()=>{
 const db=new Map(),requests=[],nodes=new Map(),created=[];let n=0;
 const api=createDemoHandler({ready:()=>true,rate:async()=>true,random:()=>String(++n).padStart(48,'a'),get:async k=>structuredClone(db.get(k)),write:async(k,v)=>db.set(k,structuredClone(v))});
 class Element{constructor(){this.events={};this.classList={add(){},remove(){}};this.disabled=false}addEventListener(e,fn){this.events[e]=fn}prepend(){}appendChild(){}after(){}removeAttribute(){}click(){if(!this.disabled)return this.events.click?.()}}
 const el=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)};
 const c=vm.createContext({console,URLSearchParams,AbortSignal,Date,Image:Element,location:{search:'?demo=1',hash:''},history:{replaceState(){}},navigator:{get geolocation(){throw Error('Demo must not use GPS')}},document:{getElementById:el,querySelector:el,createElement(){const e=new Element();created.push(e);return e},addEventListener(){}},confirm:()=>true,setInterval:()=>1,clearInterval(){},createDeliveryMap:()=>({update(){},clear(){},fit(){}}),decodeDeliveryRoute:()=>[],encodeDeliveryRoute:()=>'',fetch:async(url,o={})=>{requests.push(url);if(url==='/api/delivery?action=demo-route')return {ok:true,json:async()=>({destination:{lat:13.7463,lng:100.5346},route:null})};assert.match(url,/^\/api\/delivery-demo/);const q=Object.fromEntries(new URLSearchParams(url.split('?')[1]));const r={code:200,setHeader(){},status(s){this.code=s;return this},json(data){this.data=data}};await api({method:o.method||'GET',query:q,body:o.body?JSON.parse(o.body):{},headers:{'x-demo-token':o.headers?.['X-Demo-Token']}},r);return {ok:r.code===200,json:async()=>r.data};}});c.window=c;c.addEventListener=()=>{};
 vm.runInContext(readFileSync(new URL('../driver-demo.js',import.meta.url),'utf8'),c);
 const html=readFileSync(new URL('../driver-delivery.html',import.meta.url),'utf8');vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],c);
 const drain=()=>new Promise(resolve=>setImmediate(resolve));await drain();assert.equal(el('start').disabled,true);
 created.find(e=>e.textContent==='Use sample departure photo').click();await el('saveDeparture').click();assert.equal(el('start').disabled,false);el('start').click();await drain();assert.equal(vm.runInContext('started',c),true);assert.equal(el('pause').disabled,false);
 created.find(e=>e.textContent==='Move to next sample location').click();await drain();await el('pause').click();assert.equal(vm.runInContext('active',c),false);el('start').click();await drain();await el('complete').click();assert.equal(vm.runInContext('ended',c),true);assert.equal(el('start').disabled,true);assert.ok(created.some(e=>e.textContent==='Open linked customer demo'&&e.href.includes('session=')));assert.ok(requests.every(u=>u.startsWith('/api/delivery-demo')||u==='/api/delivery?action=demo-route'));
});
