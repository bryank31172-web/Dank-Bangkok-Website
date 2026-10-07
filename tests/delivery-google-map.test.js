import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture({overlays=false,animate=false}={}){
 const nodes=new Map(),maps=[],markers=[],lines=[],traffic=[],overlayMarkers=[],children=[],frames=new Map();let frameId=0;
 const element=()=>({style:{},setAttribute(){},remove(){this.removed=true},querySelector(){return this.child||(this.child={style:{}})},classList:{hidden:true,add(){this.hidden=true},remove(){this.hidden=false}},addEventListener(){}});
 const el=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
 const context=vm.createContext({console,URLSearchParams,document:{getElementById:el,createElement:element},google:{maps:{
  Map:class{constructor(node,o){this.options=o;this.events={};maps.push(this)}addListener(e,f){this.events[e]=f}panTo(p){this.position=p}getZoom(){return this.zoom||this.options.zoom}setZoom(z){this.zoom=z;this.events.zoom_changed?.();overlayMarkers.forEach(o=>o.map&&o.draw())}},
  Marker:class{constructor(o){Object.assign(this,o);markers.push(this)}setMap(map){this.map=map}setPosition(p){this.position=p}},
  Polyline:class{constructor(o){Object.assign(this,o);lines.push(this)}setMap(map){this.map=map}},
  TrafficLayer:class{constructor(){traffic.push(this)}setMap(map){this.map=map}},Size:class{},Point:class{}
 }}});context.window=context;
 if(overlays){context.google.maps.LatLng=class{constructor(lat,lng){this.lat=lat;this.lng=lng}};context.google.maps.OverlayView=class{
 constructor(){overlayMarkers.push(this)}setMap(map){this.map=map;if(map){this.onAdd();this.draw()}else this.onRemove()}
 getPanes(){return {overlayMouseTarget:{appendChild(e){children.push(e)}}}}
 getProjection(){return {fromLatLngToDivPixel:p=>({x:p.lng*this.map.getZoom(),y:p.lat*this.map.getZoom()})}}
 };}
 if(animate){context.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId};context.cancelAnimationFrame=id=>frames.delete(id);context.matchMedia=()=>({matches:false});}
 vm.runInContext(readFileSync(new URL('../delivery-map.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../rider-google-map.js',import.meta.url),'utf8'),context);
 const controller=vm.runInContext("createRiderGoogleMap({google:'google',fallback:'fallback'})",context);
 const polyline=vm.runInContext("encodeDeliveryRoute([{lat:13,lng:100},{lat:13,lng:100.001},{lat:13,lng:100.002}])",context);
 const data={status:'on_the_way',stale:false,address:'Customer',destination:{lat:13,lng:100.002},location:{lat:13,lng:100,route:{polyline,traffic:[{start:0,end:1,speed:'NORMAL'},{start:1,end:2,speed:'TRAFFIC_JAM'}]}}};
 return {controller,context,maps,markers,lines,traffic,el,data,children,overlayMarkers,frames,frame(now){const next=[...frames.values()];frames.clear();next.forEach(fn=>fn(now));}};
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


test('rider Google overlays match customer pins and labels, keep addresses anchored on zoom, and resize the scooter',async()=>{
 const f=fixture({overlays:true});await f.controller.update(f.data);assert.equal(f.children.length,4);
 const shops=f.children.filter(e=>e.className==='delivery-origin-pin');assert.equal(shops.length,2);assert.deepEqual(shops.map(e=>e.child.textContent),['DANK Phatthanakan','DANK Sathorn']);
 const destination=f.children.find(e=>e.className==='delivery-destination-pin'),scooter=f.children.find(e=>e.className==='delivery-moving-rider');assert.equal(destination.child.textContent,'Customer');assert.match(destination.innerHTML,/#ef5544/);
 assert.match(scooter.innerHTML,/delivery-rider.svg/);const initial=parseFloat(scooter.style.width);
 for(const zoom of [12,18,14]){f.maps[0].setZoom(zoom);assert.ok(Math.abs(parseFloat(destination.style.left)+17.6-f.data.destination.lng*zoom)<1e-8);assert.ok(Math.abs(parseFloat(destination.style.top)+42-f.data.destination.lat*zoom)<1e-8);}
 assert.equal(parseFloat(scooter.style.width),47.88);assert.notEqual(initial,parseFloat(scooter.style.width));await f.controller.update({...f.data,status:'completed'});assert.ok(f.children.every(e=>e.removed));
});
test('Google scooter eases between fixes, faces movement and clips passed road during animation; clear cancels frames',async()=>{
 const f=fixture({overlays:true,animate:true});await f.controller.update(f.data);const scooter=f.children.find(e=>e.className==='delivery-moving-rider');const initialLeft=parseFloat(scooter.style.left);
 await f.controller.update({...f.data,location:{...f.data.location,lng:100.001}});assert.equal(parseFloat(scooter.style.left),initialLeft);assert.equal(f.frames.size,1);assert.equal(scooter.child.style.transform,'rotate(90deg)');
 f.frame(0);f.frame(600);assert.ok(parseFloat(scooter.style.left)>initialLeft);assert.ok(f.lines.filter(l=>l.map)[1].path[0].lng>100);
 f.frame(1200);assert.equal(f.lines.filter(l=>l.map).length,2);assert.equal(f.lines.at(-1).strokeColor,'#e84d43');
 await f.controller.update({...f.data,location:{...f.data.location,lng:100.002}});assert.equal(f.frames.size,1);f.controller.clear();assert.equal(f.frames.size,0);f.frame(2400);assert.ok(f.children.every(e=>e.removed));assert.ok(f.lines.every(l=>!l.map));
});
