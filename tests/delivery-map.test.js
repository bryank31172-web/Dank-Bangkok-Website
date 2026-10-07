import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHandler} from '../api/delivery.js';
import {routeFor} from '../api/_delivery.js';
const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
function browser(defer=false){
 const nodes=new Map(),maps=[],markers=[],controls=[],protocols=[],frames=new Map();let nextFrame=0;
 const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:true,classList:{add(){nodes.get(id).hidden=true},remove(){nodes.get(id).hidden=false}}});return nodes.get(id)};
 const context=vm.createContext({console,requestAnimationFrame(fn){const id=++nextFrame;frames.set(id,fn);return id},cancelAnimationFrame(id){frames.delete(id)},document:{getElementById:el,createElement:()=>({style:{},querySelector(){return {textContent:''}},setAttribute(){},addEventListener(event,fn){this.click=fn},remove(){}})},pmtiles:{Protocol:class{tile(){}}},maplibregl:{
 addProtocol(name){protocols.push(name)},AttributionControl:class{constructor(options){this.options=options}},NavigationControl:class{},
 Map:class{constructor(options){this.options=options;this.sources=new Map();this.layers=[];this.events={};maps.push(this)}isStyleLoaded(){return !defer||this.loaded}addControl(control,position){controls.push({control,position,node:control.onAdd?.()});return this}on(event,fn){this.events[event]=fn}once(event,fn){this.events[event]=fn;if(!defer&&event==='load'){this.loaded=true;fn()}}resize(){}getZoom(){return this.zoom??this.options.zoom}getSource(id){return this.sources.get(id)}addSource(id,source){this.sources.set(id,{data:source.data,setData(data){this.data=data}})}addLayer(layer){this.layers.push(layer)}fitBounds(bounds){this.bounds=bounds}setCenter(){}setStyle(style){this.style=style;this.sources.clear();this.layers=[];this.events['style.load']?.()}},
 LngLatBounds:class{points=[];extend(p){this.points.push(p)}isEmpty(){return !this.points.length}},
 Marker:class{constructor(options){this.options=options;markers.push(this)}setLngLat(p){this.position=p;return this}setRotation(degrees){this.rotation=degrees;return this}getElement(){return this.options.element}addTo(map){this.map=map;return this}remove(){this.map=null}}
 }});context.window=context;vm.runInContext(readFileSync(new URL('../delivery-map.js',import.meta.url),'utf8'),context);
 const map=vm.runInContext("createDeliveryMap({map:'map',badge:'badge',label:'label',note:'note'})",context);
 const data=()=>({status:'on_the_way',destination:{lat:43.252,lng:-126.453},location:{lat:38.5,lng:-120.2,route:{polyline:encoded,minutes:8,km:5.4}},stale:false});
 return {map,maps,markers,controls,protocols,el,data,context,frames,tick(time){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(time))},finish(){maps[0].loaded=true;maps[0].events.load()}};
}
test('MapLibre registers PMTiles, draws road geometry and keeps visible credits',async()=>{
 const f=browser();await f.map.update(f.data());const m=f.maps[0];assert.deepEqual(f.protocols,['pmtiles']);assert.match(m.options.style,/wayfinder\/style.json$/);assert.equal(m.layers.length,2);assert.equal(m.getSource('delivery-route').data.features.length,2);assert.equal(f.el('badge').textContent,'Best route · 8 min · 5.4 km');assert.equal(m.bounds.points.length,7);assert.ok(f.controls.some(c=>c.position==='bottom-right'&&c.control.options.compact===false));assert.equal(f.controls.find(c=>c.position==='bottom-left').node.href,'https://elemnt.earth');
});
test('theme changes restore current route and paused maps stay empty',async()=>{
 const f=browser();await f.map.update(f.data());const toggle=f.controls.find(c=>c.node?.className.includes('delivery-theme')).node;toggle.click();assert.match(f.maps[0].style,/style.dark.json$/);assert.equal(f.maps[0].getSource('delivery-route').data.features.length,2);f.map.clear();toggle.click();assert.equal(f.maps[0].getSource('delivery-route').data.features.length,0);assert.ok(f.markers.every(m=>m.map===null));
});
test('route remains visible while basemap tiles and GeoJSON workers are loading',async()=>{
 const f=browser();await f.map.update(f.data());const m=f.maps[0];
 m.isStyleLoaded=()=>false;
 const next={...f.data(),location:{...f.data().location,route:{polyline:encoded,minutes:8,traffic:[{start:0,end:1,speed:'SLOW'},{start:1,end:2,speed:'TRAFFIC_JAM'}]}}};
 await f.map.update(next);
 assert.deepEqual(Array.from(m.getSource('delivery-route').data.features,f=>f.properties.color),['#efad23','#e84d43']);
 const toggle=f.controls.find(c=>c.node?.className.includes('delivery-theme')).node;toggle.click();
 assert.equal(m.layers.length,2);assert.equal(m.getSource('delivery-route').data.features.length,2);
 f.map.clear();assert.equal(m.getSource('delivery-route').data.features.length,0);
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

test('unavailable WebGL shows a readable fallback rather than renderer internals',async()=>{const f=browser();f.context.maplibregl.Map=class{constructor(){throw new Error('WebGL renderer error {private internals}')}};await f.map.update(f.data());assert.match(f.map.error(),/This browser cannot display the map/);assert.doesNotMatch(f.map.error(),/internals/);});

// Lifecycle and interpolation tests ensure an ended assignment cannot keep moving.
test('start replaces the location pin with one scooter and keeps the destination',async()=>{
 const f=browser();await f.map.update({...f.data(),status:'preparing'});const pin=f.markers.find(m=>m.options.anchor==='center'),destination=f.markers.find(m=>m.options.element.className==='delivery-destination-pin');
 await f.map.update(f.data());assert.equal(pin.map,null);assert.equal(destination.map,f.maps[0]);const scooter=f.markers.at(-1);assert.equal(scooter.options.element.className,'delivery-moving-rider');assert.match(scooter.options.element.innerHTML,/delivery-rider.svg/);assert.equal(f.markers.filter(m=>m.map).length,4);
});
test('scooter eases between real fixes, faces movement, and freezes at the latest stale fix',async()=>{
 const f=browser();await f.map.update(f.data());const scooter=f.markers.at(-1),next={...f.data(),location:{lat:38.5,lng:-120.19}};await f.map.update(next);
 assert.equal(scooter.position[0],-120.2);assert.equal(scooter.rotation,90);f.tick(0);f.tick(600);assert.ok(scooter.position[0]>-120.2&&scooter.position[0]<-120.19);f.tick(1200);assert.equal(scooter.position[0],-120.19);assert.equal(f.frames.size,0);
 await f.map.update({...next,location:{lat:38.51,lng:-120.19}});f.tick(2000);f.tick(2300);f.map.stale();assert.equal(f.frames.size,0);assert.equal(scooter.position[1],38.51);
});
test('completion and pause cancel pending scooter movement without restoring it on theme change',async()=>{
 for(const ended of [true,false]){const f=browser();await f.map.update(f.data());await f.map.update({...f.data(),location:{lat:39,lng:-120}});assert.equal(f.frames.size,1);
 await f.map.update(ended?{status:'completed'}:{...f.data(),location:null});assert.equal(f.frames.size,0);assert.equal(f.markers.find(m=>m.options.element.className==='delivery-moving-rider').map,null);f.controls.find(c=>c.node?.className.includes('delivery-theme')).node.click();f.tick(9999);assert.equal(f.markers.filter(m=>m.map&&m.options.anchor==='center').length,0);}
});
test('reduced motion places the scooter directly at each received fix',async()=>{const f=browser();f.context.matchMedia=()=>({matches:true});await f.map.update(f.data());await f.map.update({...f.data(),location:{lat:39,lng:-120}});assert.equal(f.frames.size,0);assert.equal(f.markers.at(-1).position[1],39);});

test('zoom resizes the active scooter within readable limits without changing its position',async()=>{
 const f=browser();await f.map.update(f.data());const m=f.maps[0],scooter=f.markers.at(-1),content=scooter.getElement(),position=[...scooter.position];assert.equal(parseFloat(content.style.width),47.88);
 m.zoom=16;m.events.zoom();assert.ok(parseFloat(content.style.width)>47.88);m.zoom=12;m.events.zoom();assert.ok(parseFloat(content.style.width)<47.88);
 m.zoom=22;m.events.zoom();assert.equal(parseFloat(content.style.width),68.4);m.zoom=0;m.events.zoom();assert.equal(parseFloat(content.style.width),32.4);assert.deepEqual([...scooter.position],position);f.map.clear();m.events.zoom();assert.equal(scooter.map,null);
});

test('both DANK shop pins stay fixed across rider movement and style swaps, then clear on completion',async()=>{
 const f=browser();await f.map.update(f.data());const shops=f.markers.filter(m=>m.options.element.className==='delivery-origin-pin');assert.equal(shops.length,2);assert.deepEqual([...shops[0].position],[100.6004,13.7419]);assert.deepEqual([...shops[1].position],[100.5375,13.7108]);
 await f.map.update({...f.data(),location:{lat:39,lng:-120}});f.controls.find(c=>c.node?.className.includes('delivery-theme')).node.click();assert.deepEqual([...shops[0].position],[100.6004,13.7419]);assert.equal(f.markers.filter(m=>m.options.element.className==='delivery-origin-pin').length,2);await f.map.update({status:'completed'});assert.ok(shops.every(m=>m.map===null));
});


test('traffic colours follow Google interval indices, with shared boundaries and unknown fallback',()=>{
 const f=browser();const result=vm.runInContext("deliveryRouteFeatures([{lat:0,lng:0},{lat:0,lng:1},{lat:0,lng:2},{lat:0,lng:3}], [{start:0,end:1,speed:'NORMAL'},{start:1,end:2,speed:'SLOW'},{start:2,end:3,speed:'TRAFFIC_JAM'}], 0.5)",f.context);
 assert.deepEqual(Array.from(result.features,x=>x.properties.color),['#00b65b','#efad23','#e84d43']);assert.equal(result.features[0].geometry.coordinates[0][0],0.5);
});
test('passed route disappears with animated rider movement and cannot grow back with GPS jitter or style changes',async()=>{
 const f=browser();const polyline=vm.runInContext("encodeDeliveryRoute([{lat:13,lng:100},{lat:13,lng:100.001},{lat:13,lng:100.002}])",f.context);
 const data=lng=>({...f.data(),location:{lat:13,lng,route:{polyline,traffic:[{start:0,end:1,speed:'SLOW'},{start:1,end:2,speed:'TRAFFIC_JAM'}]}}});
 await f.map.update(data(100));await f.map.update(data(100.001));f.tick(0);f.tick(600);
 const source=f.maps[0].getSource('delivery-route');assert.ok(source.data.features[0].geometry.coordinates[0][0]>100);f.tick(1200);assert.equal(source.data.features.length,1);assert.equal(source.data.features[0].properties.color,'#e84d43');
 await f.map.update(data(100.00099));f.tick(2000);f.tick(3200);assert.equal(source.data.features[0].geometry.coordinates[0][0],100.001);
 f.controls.find(c=>c.node?.className.includes('delivery-theme')).node.click();assert.equal(f.maps[0].getSource('delivery-route').data.features.length,1);
 await f.map.update(data(100.002));f.tick(4000);f.tick(5200);assert.equal(f.maps[0].getSource('delivery-route').data.features.length,0);
});
test('off-route position does not erase distant road sections and a replacement route resets progress',()=>{
 const f=browser();assert.equal(vm.runInContext("deliveryRouteProgress([{lat:13,lng:100},{lat:13,lng:100.01}],{lat:14,lng:100.01},0)",f.context),0);
});
test('route API requests traffic and normalizes omitted zero index while rejecting malformed intervals',async()=>{
 const previous=process.env.GOOGLE_MAPS_API_KEY,oldFetch=globalThis.fetch;process.env.GOOGLE_MAPS_API_KEY='test';
 try{globalThis.fetch=async(url,o)=>{const body=JSON.parse(o.body);assert.equal(body.routingPreference,'TRAFFIC_AWARE_OPTIMAL');assert.equal(body.computeAlternativeRoutes,false);assert.deepEqual(body.extraComputations,['TRAFFIC_ON_POLYLINE']);assert.match(o.headers['X-Goog-FieldMask'],/speedReadingIntervals/);return {ok:true,json:async()=>({routes:[{duration:'120s',polyline:{encodedPolyline:encoded},travelAdvisory:{speedReadingIntervals:[{endPolylinePointIndex:1,speed:'NORMAL'},{startPolylinePointIndex:1,endPolylinePointIndex:2,speed:'SLOW'},{startPolylinePointIndex:-1,endPolylinePointIndex:2,speed:'TRAFFIC_JAM'},{endPolylinePointIndex:2,speed:'FAKE'}]}}]})};};const route=await routeFor({lat:13,lng:100},{lat:14,lng:100});assert.deepEqual(route.traffic,[{start:0,end:1,speed:'NORMAL'},{start:1,end:2,speed:'SLOW'}]);}finally{globalThis.fetch=oldFetch;if(previous===undefined)delete process.env.GOOGLE_MAPS_API_KEY;else process.env.GOOGLE_MAPS_API_KEY=previous;}
});

test('address pins use geographic bottom anchors through zoom and absolute map positioning',async()=>{const f=browser();await f.map.update(f.data());const pin=f.markers.find(m=>m.options.element.className==='delivery-destination-pin');assert.equal(pin.options.anchor,'bottom');assert.equal(pin.options.offset[1],2.8);const before=JSON.stringify(pin.position);for(const zoom of [10,18,12,20]){f.maps[0].zoom=zoom;f.maps[0].events.zoom();assert.equal(JSON.stringify(pin.position),before);}const css=readFileSync(new URL('../delivery-map.css',import.meta.url),'utf8');assert.match(css,/\.delivery-rider-pin,\.delivery-destination-pin,\.delivery-origin-pin\{position:absolute/);});
