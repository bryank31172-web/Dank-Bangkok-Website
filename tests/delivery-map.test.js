import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHandler} from '../api/delivery.js';
import {routeFor} from '../api/_delivery.js';
const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
function browser(defer=false){
 const nodes=new Map(),maps=[],markers=[],controls=[],protocols=[];
 const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:true,classList:{add(){nodes.get(id).hidden=true},remove(){nodes.get(id).hidden=false}}});return nodes.get(id)};
 const context=vm.createContext({console,document:{getElementById:el,createElement:()=>({setAttribute(){},addEventListener(event,fn){this.click=fn},remove(){}})},pmtiles:{Protocol:class{tile(){}}},maplibregl:{
 addProtocol(name){protocols.push(name)},AttributionControl:class{constructor(options){this.options=options}},NavigationControl:class{},
 Map:class{constructor(options){this.options=options;this.sources=new Map();this.layers=[];this.events={};maps.push(this)}isStyleLoaded(){return !defer||this.loaded}addControl(control,position){controls.push({control,position,node:control.onAdd?.()});return this}on(event,fn){this.events[event]=fn}once(event,fn){this.events[event]=fn;if(!defer&&event==='load'){this.loaded=true;fn()}}resize(){}getSource(id){return this.sources.get(id)}addSource(id,source){this.sources.set(id,{data:source.data,setData(data){this.data=data}})}addLayer(layer){this.layers.push(layer)}fitBounds(bounds){this.bounds=bounds}setCenter(){}setStyle(style){this.style=style;this.sources.clear();this.layers=[];this.events['style.load']?.()}},
 LngLatBounds:class{points=[];extend(p){this.points.push(p)}isEmpty(){return !this.points.length}},
 Marker:class{constructor(options){this.options=options;markers.push(this)}setLngLat(p){this.position=p;return this}addTo(map){this.map=map;return this}remove(){this.map=null}}
 }});context.window=context;vm.runInContext(readFileSync(new URL('../delivery-map.js',import.meta.url),'utf8'),context);
 const map=vm.runInContext("createDeliveryMap({map:'map',badge:'badge',label:'label',note:'note'})",context);
 const data=()=>({status:'on_the_way',destination:{lat:43.252,lng:-126.453},location:{lat:38.5,lng:-120.2,route:{polyline:encoded,minutes:8,km:5.4}},stale:false});
 return {map,maps,markers,controls,protocols,el,data,context,finish(){maps[0].loaded=true;maps[0].events.load()}};
}
test('MapLibre registers PMTiles, draws road geometry and keeps visible credits',async()=>{
 const f=browser();await f.map.update(f.data());const m=f.maps[0];assert.deepEqual(f.protocols,['pmtiles']);assert.match(m.options.style,/wayfinder\/style.json$/);assert.equal(m.layers.length,2);assert.equal(m.getSource('delivery-route').data.geometry.coordinates.length,3);assert.equal(f.el('badge').textContent,'On the way · 8 min · 5.4 km');assert.equal(m.bounds.points.length,5);assert.ok(f.controls.some(c=>c.position==='bottom-right'&&c.control.options.compact===false));assert.equal(f.controls.find(c=>c.position==='bottom-left').node.href,'https://elemnt.earth');
});
test('theme changes restore current route and paused maps stay empty',async()=>{
 const f=browser();await f.map.update(f.data());const toggle=f.controls.find(c=>c.node?.className.includes('delivery-theme')).node;toggle.click();assert.match(f.maps[0].style,/style.dark.json$/);assert.equal(f.maps[0].getSource('delivery-route').data.geometry.coordinates.length,3);f.map.clear();toggle.click();assert.equal(f.maps[0].getSource('delivery-route').data.features.length,0);assert.ok(f.markers.every(m=>m.map===null));
});
test('stale updates remove route and badge',async()=>{
 const f=browser();await f.map.update(f.data());f.map.stale();assert.equal(f.maps[0].getSource('delivery-route').data.features.length,0);assert.equal(f.el('badge').hidden,true);
});
test('completion during map loading cannot restore private position',async()=>{
 const f=browser(true),p=f.map.update(f.data());f.map.clear();f.finish();await p;assert.equal(f.markers.length,0);assert.equal(f.el('badge').hidden,true);
});
test('overlapping updates display only the newest position',async()=>{
 const f=browser(true),p=f.map.update(f.data()),q=f.map.update({...f.data(),location:{...f.data().location,lat:40.7}});f.finish();await Promise.all([p,q]);assert.equal(f.markers.find(m=>m.options.anchor==='center').position[1],40.7);
});
test('fixed demo route caches parallel requests and cannot read orders or accept supplied locations',async()=>{
  let calls=0;const route={polyline:encoded,minutes:8,km:5.4};const handler=createHandler({rate:async()=>true,get:async()=>{throw new Error('Must not read private storage')},routeFor:async(a,b)=>{calls++;assert.deepEqual(a,{lat:13.7108,lng:100.5375});assert.deepEqual(b,{lat:13.7463,lng:100.5346});return route;}});
  async function call(method='GET'){const r={code:200,setHeader(){},status(c){this.code=c;return this},json(j){this.data=j;return this}};await handler({method,query:{action:'demo-route',lat:90,lng:180},body:{action:'demo-route'}},r);return r;}
  const results=await Promise.all(Array.from({length:20},()=>call()));assert.equal(calls,1);assert.ok(results.every(r=>r.data.route===route));assert.equal((await call('POST')).code,405);
});
test('public demo rate limit stops route requests before provider access',async()=>{
  let calls=0;const handler=createHandler({rate:async(req,res,key)=>{if(key==='delivery-demo-route'){res.status(429).json({error:'rate'});return false}return true},routeFor:async()=>{calls++;return null}});
  const r={code:200,setHeader(){},status(c){this.code=c;return this},json(){}};await handler({method:'GET',query:{action:'demo-route'}},r);assert.equal(r.code,429);assert.equal(calls,0);
});
test('Google route distance is included, invalid durations fail without an invented ETA',async()=>{
  const previous=process.env.GOOGLE_MAPS_API_KEY,oldFetch=globalThis.fetch;process.env.GOOGLE_MAPS_API_KEY='test-key';
  try{globalThis.fetch=async()=>({ok:true,json:async()=>({routes:[{duration:'120s',distanceMeters:5420,polyline:{encodedPolyline:encoded}}]})});assert.equal((await routeFor({lat:13.7,lng:100.5},{lat:13.8,lng:100.6})).km,5.4);
    for(const duration of ['-20s','120oops','invalid']){globalThis.fetch=async()=>({ok:true,json:async()=>({routes:[{duration,polyline:{encodedPolyline:encoded}}]})});assert.equal(await routeFor({lat:13.7,lng:100.5},{lat:13.8,lng:100.6}),null);}
  }finally{globalThis.fetch=oldFetch;if(previous===undefined)delete process.env.GOOGLE_MAPS_API_KEY;else process.env.GOOGLE_MAPS_API_KEY=previous;}
});
