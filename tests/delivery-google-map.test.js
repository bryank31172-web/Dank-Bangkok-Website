import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){
 const nodes=new Map(),maps=[],markers=[],lines=[],traffic=[];
 const element=()=>({classList:{hidden:true,add(){this.hidden=true},remove(){this.hidden=false}},addEventListener(){}});
 const el=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
 const context=vm.createContext({console,URLSearchParams,document:{getElementById:el},google:{maps:{
  Map:class{constructor(node,o){this.options=o;this.events={};maps.push(this)}addListener(e,f){this.events[e]=f}panTo(p){this.position=p}setZoom(z){this.zoom=z}},
  Marker:class{constructor(o){Object.assign(this,o);markers.push(this)}setMap(map){this.map=map}setPosition(p){this.position=p}},
  Polyline:class{constructor(o){Object.assign(this,o);lines.push(this)}setMap(map){this.map=map}},
  TrafficLayer:class{constructor(){traffic.push(this)}setMap(map){this.map=map}},Size:class{},Point:class{}
 }}});context.window=context;
 vm.runInContext(readFileSync(new URL('../delivery-map.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../rider-google-map.js',import.meta.url),'utf8'),context);
 const controller=vm.runInContext("createRiderGoogleMap({google:'google',fallback:'fallback'})",context);
 const polyline=vm.runInContext("encodeDeliveryRoute([{lat:13,lng:100},{lat:13,lng:100.001},{lat:13,lng:100.002}])",context);
 const data={status:'on_the_way',stale:false,address:'Customer',destination:{lat:13,lng:100.002},location:{lat:13,lng:100,route:{polyline,traffic:[{start:0,end:1,speed:'NORMAL'},{start:1,end:2,speed:'TRAFFIC_JAM'}]}}};
 return {controller,context,maps,markers,lines,traffic,el,data};
}
test('Google Maps starts only with an active fresh rider, shows traffic and remaining route, and respects manual panning',async()=>{
 const f=fixture();assert.equal(await f.controller.update({...f.data,status:'preparing'}),false);assert.equal(f.maps.length,0);
 assert.equal(await f.controller.update(f.data),true);assert.equal(f.maps.length,1);assert.equal(f.traffic[0].map,f.maps[0]);assert.equal(f.el('google').classList.hidden,false);assert.equal(f.lines.filter(l=>l.map).length,4);
 f.maps[0].events.dragstart();const initial=f.maps[0].position;
 await f.controller.update({...f.data,location:{...f.data.location,lng:100.001}});assert.equal(f.maps[0].position,initial);assert.equal(f.lines.filter(l=>l.map).length,2);assert.equal(f.lines.at(-1).strokeColor,'#e84d43');f.controller.fit();assert.equal(f.maps[0].position.lng,100.001);
});
test('pause, stale GPS and completion clear Google overlays and restore fallback',async()=>{
 for(const patch of [{location:null},{stale:true},{status:'completed'}]){const f=fixture();await f.controller.update(f.data);await f.controller.update({...f.data,...patch});assert.ok(f.lines.every(l=>!l.map));assert.ok(f.markers.every(m=>!m.map));assert.equal(f.traffic[0].map,null);assert.equal(f.el('google').classList.hidden,true);}
});
test('completion during Google loading cannot restore customer address or rider position',async()=>{
 const f=fixture();let release;f.context.loadRiderGoogleMaps=()=>new Promise(r=>release=r);
 const pending=f.controller.update(f.data);f.controller.clear();release();assert.equal(await pending,false);assert.equal(f.maps.length,0);assert.equal(f.markers.length,0);
});
test('Google Maps loading failure leaves delivery controls with the existing map fallback',async()=>{
 const f=fixture();f.context.loadRiderGoogleMaps=async()=>{throw Error('blocked browser key')};assert.equal(await f.controller.update(f.data),false);assert.equal(f.el('fallback').classList.hidden,false);
});

test('a rejected Google referrer immediately clears the broken map and does not retry the same key',async()=>{
 const f=fixture();await f.controller.update(f.data);f.context.gm_authFailure();assert.equal(f.el('google').classList.hidden,true);assert.equal(f.el('fallback').classList.hidden,false);assert.ok(f.markers.every(m=>!m.map));assert.equal(await f.controller.update(f.data),false);assert.equal(f.maps.length,1);
});
