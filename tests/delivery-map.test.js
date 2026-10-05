import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHandler} from '../api/delivery.js';
import {routeFor} from '../api/_delivery.js';
const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
function browser(defer = false) {
  const nodes = new Map(), lines = [], markers = [], bounds = [], scripts = [];
  const el = id => {if (!nodes.has(id)) nodes.set(id, {textContent:'', hidden:true, classList:{add(){nodes.get(id).hidden=true},remove(){nodes.get(id).hidden=false}}});return nodes.get(id);};
  const c=vm.createContext({console,document:{getElementById:el,createElement:()=>({}),head:{appendChild(s){scripts.push(s);if(!defer)c.initDeliveryRouteMap()}}},google:{maps:{
    Map:class{fitBounds(b){bounds.push(b.points)}setCenter(){}},LatLngBounds:class{points=[];extend(p){this.points.push(p)}isEmpty(){return !this.points.length}},
    Polyline:class{constructor(opts){Object.assign(this,opts);lines.push(this)}setMap(m){this.map=m}},marker:{AdvancedMarkerElement:class{constructor(opts){Object.assign(this,opts);markers.push(this)}}}}}});c.window=c;
  vm.runInContext(readFileSync(new URL('../delivery-map.js',import.meta.url),'utf8'),c);
  const map=vm.runInContext("createDeliveryMap({map:'map',badge:'badge',label:'label',note:'note'})",c);
  const data=(capturedAt=Date.now())=>({status:'on_the_way',mapsKey:'test',mapId:'test-map',destination:{lat:43.252,lng:-126.453},destinationLabel:'Sample destination',location:{lat:38.5,lng:-120.2,capturedAt,route:{polyline:encoded,minutes:8,km:5.4}},stale:false});
  return {c,map,data,lines,markers,bounds,el,scripts};
}
test('map draws the actual road polyline with outline, time, distance and full route bounds',async()=>{
  const f=browser();await f.map.update(f.data());assert.equal(f.lines.length,2);assert.equal(f.lines[1].strokeColor,'#00b65b');assert.equal(f.lines[1].path.length,3);
  assert.equal(f.el('badge').textContent,'On the way · 8 min · 5.4 km');assert.equal(f.el('label').textContent,'Sample destination');assert.equal(f.bounds[0].length,5);
  assert.equal(f.scripts[0].referrerPolicy,'strict-origin-when-cross-origin');assert.equal(f.markers.length,2);
  const roundtrip=vm.runInContext(`decodeDeliveryRoute(encodeDeliveryRoute(decodeDeliveryRoute('${encoded}')))`,f.c);assert.equal(roundtrip[1].lat,40.7);
});
test('newer location replaces route and stale updates remove lines and route badge',async()=>{
  const f=browser();await f.map.update(f.data());const old=f.lines.slice();await f.map.update({...f.data(),location:{...f.data().location,route:{polyline:encoded,minutes:3,km:2}}});
  assert.ok(old.every(l=>l.map===null));assert.match(f.el('badge').textContent,/3 min · 2 km/);f.map.stale();assert.ok(f.lines.every(l=>l.map===null));assert.equal(f.el('badge').hidden,true);
});
test('pause and completion during delayed map loading cannot restore rider or route',async()=>{
  for(const stop of ['pause','complete']){const f=browser(true);const update=f.map.update(f.data());f.map.clear();f.c.initDeliveryRouteMap();await update;assert.equal(f.markers.length,0);assert.equal(f.lines.length,0);assert.equal(f.el('badge').hidden,true);}
});
test('overlapping map loads display only newest location',async()=>{
  const f=browser(true),a=f.data(),b={...f.data(),location:{...f.data().location,lat:40.7}};const p=f.map.update(a),q=f.map.update(b);f.c.initDeliveryRouteMap();await Promise.all([p,q]);assert.equal(f.markers.find(m=>m.title==='Delivery rider').position.lat,40.7);assert.equal(f.lines.length,2);
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
