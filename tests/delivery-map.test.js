import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHandler} from '../api/delivery.js';
import {routeFor} from '../api/_delivery.js';
const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
function browser(defer=false, key='test-browser-key') {
  const nodes=new Map(),maps=[],pins=[],lines=[],frames=new Map();let clock=0,number=0,release;
  const element=()=>({style:{},textContent:'',hidden:true,children:[],setAttribute(){},remove(){this.removed=true},appendChild(x){this.children.push(x)},classList:{add(){this.owner.hidden=true},remove(){this.owner.hidden=false}}});
  const el=id=>{if(!nodes.has(id)){const n=element();n.classList.owner=n;nodes.set(id,n)}return nodes.get(id)};
  const config={key,mapId:'production-map',mapIdConfigured:true};
  const google={maps:{RenderingType:{RASTER:'RASTER'},ControlPosition:{RIGHT_CENTER:'RIGHT_CENTER'},
    event:{trigger(){},addListenerOnce(map,event,fn){fn()}},
    Map:class{constructor(node,options){this.options=options;this.zoom=14;maps.push(this)}fitBounds(bounds){this.bounds=bounds}getZoom(){return this.zoom}setZoom(z){this.zoom=z}setCenter(p){this.center=p}},
    LatLng:class{constructor(point){Object.assign(this,point)}},
    LatLngBounds:class{points=[];extend(p){this.points.push(p)}isEmpty(){return !this.points.length}},
    Polyline:class{constructor(options){this.options=options;this.map=options.map;lines.push(this)}setMap(map){this.map=map}setPath(path){this.options.path=path}},
    OverlayView:class{constructor(){pins.push(this)}setMap(map){this.map=map;if(map){this.onAdd();this.draw()}else this.onRemove()}getPanes(){return {overlayMouseTarget:el('pane')}}getProjection(){return {fromLatLngToDivPixel:p=>({x:p.lng,y:p.lat})}}}
  }};
  const context=vm.createContext({console,google,AbortSignal,URLSearchParams,setTimeout,clearTimeout,
    document:{hidden:false,getElementById:el,createElement:element,addEventListener(){}},
    addEventListener(){},matchMedia:()=>({matches:false}),performance:{now:()=>clock},
    requestAnimationFrame(fn){frames.set(++number,fn);return number},cancelAnimationFrame(id){frames.delete(id)},
    fetch:async()=>({ok:true,json:()=>defer?new Promise(resolve=>{release=resolve}):Promise.resolve(config)})});
  context.window=context;vm.runInContext(readFileSync(new URL('../delivery-map.js',import.meta.url),'utf8'),context);
  const map=vm.runInContext("createDeliveryMap({map:'map',badge:'badge',label:'label',note:'note'})",context);
  const path=[{lat:13.73,lng:100.60},{lat:13.73,lng:100.605},{lat:13.735,lng:100.605},{lat:13.735,lng:100.61}];
  const polyline=vm.runInContext('encodeDeliveryRoute('+JSON.stringify(path)+')',context);
  const data=()=>({status:'on_the_way',destination:path.at(-1),location:{...path[0],capturedAt:1000,route:{polyline,minutes:8,km:1.6}},stale:false});
  return {map,maps,pins,lines,frames,el,data,path,context,
    tick(ms){clock=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(clock))},
    async finish(){await new Promise(resolve=>setImmediate(resolve));release(config)}};
}
test('Google raster map draws road geometry and uses the configured map ID',async()=>{
  const f=browser();await f.map.update(f.data());assert.equal(f.maps[0].options.renderingType,'RASTER');assert.equal(f.maps[0].options.mapId,'production-map');
  assert.equal(f.lines.length,2);assert.equal(f.lines[0].options.path.length,4);assert.equal(f.el('badge').textContent,'On the way · 8 min · 1.6 km');assert.equal(f.maps[0].bounds.points.length,6);assert.equal(f.pins.length,2);
  for(const file of ['delivery.html','driver-delivery.html'])assert.doesNotMatch(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/maplibre|pmtiles|unpkg/);
});
test('rider moves continuously around route bends and repeated polling does not interrupt motion',async()=>{
  const f=browser();await f.map.update(f.data());const rider=f.pins.find(p=>p.content.className==='delivery-rider-pin');
  await f.map.update({...f.data(),location:{...f.data().location,...f.path.at(-1),capturedAt:46000}});
  assert.equal(f.frames.size,1);f.tick(4000);assert.ok(rider.position.lat>13.73&&rider.position.lat<13.735);assert.ok(Math.abs(rider.position.lng-100.605)<0.00001);
  await f.map.update({...f.data(),location:{...f.data().location,...f.path.at(-1),capturedAt:46000}});assert.equal(f.frames.size,1);
  f.tick(8000);assert.equal(f.frames.size,0);assert.ok(Math.abs(rider.position.lng-100.61)<1e-8);
});
test('stale and paused updates cancel animation and remove visible route/location',async()=>{
  const f=browser();await f.map.update(f.data());await f.map.update({...f.data(),location:{...f.data().location,...f.path.at(-1),capturedAt:46000}});f.map.stale();
  assert.equal(f.frames.size,0);assert.ok(f.lines.every(p=>p.map===null));assert.equal(f.el('badge').hidden,true);
  await f.map.update({...f.data(),location:null,stale:true});assert.ok(f.pins.filter(p=>p.content.className==='delivery-rider-pin').every(p=>p.map===null));
});
test('completion during Google loading cannot restore private coordinates',async()=>{
  const f=browser(true),p=f.map.update(f.data());f.map.clear();await f.finish();await p;assert.equal(f.pins.length,0);assert.equal(f.el('badge').hidden,true);
});
test('overlapping updates display only the newest position',async()=>{
  const f=browser(true),p=f.map.update(f.data()),q=f.map.update({...f.data(),location:{...f.data().location,lat:13.74}});await f.finish();await Promise.all([p,q]);
  assert.equal(f.pins.find(p=>p.content.className==='delivery-rider-pin').position.lat,13.74);
});
test('completion stops every animation frame and removes both pins',async()=>{
  const f=browser();await f.map.update(f.data());await f.map.update({...f.data(),location:{...f.data().location,...f.path.at(-1),capturedAt:46000}});await f.map.update({status:'completed'});f.tick(4000);
  assert.equal(f.frames.size,0);assert.ok(f.pins.every(p=>p.map===null));assert.ok(f.lines.every(p=>p.map===null));
});
test('missing browser key produces a useful error instead of inventing a map',async()=>{
  const f=browser(false,'');await f.map.update(f.data());assert.match(f.map.error(),/browser key is not configured/);assert.equal(f.maps.length,0);
});
test('Pattanakarn preset uses the verified public shop and condo, rejects arbitrary routes',async()=>{
  const calls=[];const handler=createHandler({rate:async()=>true,get:async()=>{throw Error('No order access')},routeFor:async(a,b)=>{calls.push({a,b});return {polyline:encoded,minutes:23,km:15.1}}});
  async function request(route){const res={code:200,setHeader(){},status(x){this.code=x;return this},json(x){this.data=x;return this}};await handler({method:'GET',query:{action:'demo-route',route}},res);return res}
  const r=await request('pattanakarn');assert.equal(r.data.origin.lat,13.739853);assert.equal(r.data.destination.lng,100.7152376);assert.match(r.data.originLabel,/223 Phatthanakan/);assert.equal(r.data.route.km,15.1);
  await request('pattanakarn');assert.equal(calls.length,1);assert.equal((await request('custom')).code,400);assert.equal(calls.length,1);
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
  try{globalThis.fetch=async(url,options)=>{assert.equal(JSON.parse(options.body).travelMode,'TWO_WHEELER');return {ok:true,json:async()=>({routes:[{duration:'120s',distanceMeters:5420,polyline:{encodedPolyline:encoded}}]})}};assert.equal((await routeFor({lat:13.7,lng:100.5},{lat:13.8,lng:100.6})).km,5.4);
    for(const duration of ['-20s','120oops','invalid']){globalThis.fetch=async()=>({ok:true,json:async()=>({routes:[{duration,polyline:{encodedPolyline:encoded}}]})});assert.equal(await routeFor({lat:13.7,lng:100.5},{lat:13.8,lng:100.6}),null);}
  }finally{globalThis.fetch=oldFetch;if(previous===undefined)delete process.env.GOOGLE_MAPS_API_KEY;else process.env.GOOGLE_MAPS_API_KEY=previous;}
});
