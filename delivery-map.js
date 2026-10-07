function decodeDeliveryRoute(encoded) {
  const points = []; let index = 0, lat = 0, lng = 0;
  function delta() {let value = 0, shift = 0, byte; do {if (index >= encoded.length || shift > 30) throw new Error('Invalid route geometry'); byte = encoded.charCodeAt(index++) - 63; value |= (byte & 31) << shift; shift += 5;} while (byte >= 32); return value & 1 ? ~(value >> 1) : value >> 1;}
  while (index < encoded.length) {lat += delta(); lng += delta(); points.push({lat: lat / 1e5, lng: lng / 1e5});}
  return points;
}
function encodeDeliveryRoute(points) {
  let lat = 0, lng = 0, output = '';
  function append(delta) {let value = delta < 0 ? ~(delta << 1) : delta << 1; while (value >= 32) {output += String.fromCharCode((32 | (value & 31)) + 63); value >>= 5;} output += String.fromCharCode(value + 63);}
  points.forEach(point => {const nextLat = Math.round(point.lat * 1e5), nextLng = Math.round(point.lng * 1e5); append(nextLat - lat); append(nextLng - lng); lat = nextLat; lng = nextLng;});
  return output;
}
// Project only near the reported position. Keep progress monotonic on the same route,
// so GPS jitter cannot restore travelled sections; a new route resets progress.
function deliveryRouteProgress(points, position, minimum = 0) {
  let best = {offset: minimum, distance: Infinity};
  const scale = Math.cos(position.lat * Math.PI / 180);
  for (let i = Math.floor(minimum); i < points.length - 1; i++) {
    const a = points[i], b = points[i+1], dx = (b.lng-a.lng)*scale, dy = b.lat-a.lat;
    const t = Math.max(0, Math.min(1, ((position.lng-a.lng)*scale*dx+(position.lat-a.lat)*dy)/(dx*dx+dy*dy || 1)));
    const offset = i+t;
    if (offset < minimum) continue;
    const distance = Math.hypot((position.lng-a.lng-(b.lng-a.lng)*t)*scale, position.lat-a.lat-(b.lat-a.lat)*t)*111320;
    if (distance < best.distance-0.01) best = {offset, distance};
  }
  return best.distance <= 100 ? best.offset : minimum;
}
function deliveryRouteFeatures(points, traffic = [], progress = 0) {
  const features = [], colors = {NORMAL:'#00b65b', SLOW:'#efad23', TRAFFIC_JAM:'#e84d43'};
  if (points.length < 2 || progress >= points.length-1) return {type:'FeatureCollection', features};
  for (let i = Math.floor(progress); i < points.length-1; i++) {
    const t = Math.max(0, progress-i), a = points[i], b = points[i+1];
    if (t >= 1) continue;
    const interval = traffic.find(x=>x.start<=i&&x.end>i);
    features.push({type:'Feature', properties:{color:colors[interval?.speed] || '#00b65b',traffic:interval?.speed || 'UNKNOWN'}, geometry:{type:'LineString',coordinates:[[a.lng+(b.lng-a.lng)*t,a.lat+(b.lat-a.lat)*t],[b.lng,b.lat]]}});
  }
  return {type:'FeatureCollection',features};
}
// Shared MapLibre map. Keep the latest delivery overlay through style changes.
const DELIVERY_STYLES = {
  light: 'https://carto.elemnt.earth/2026-06-22_wayfinder/style.json',
  dark: 'https://carto.elemnt.earth/2026-06-22_wayfinder/style.dark.json'
};
const DELIVERY_SHOPS = [
  {id:'pattanakarn',name:'DANK Phatthanakan',lat:13.7419,lng:100.6004},
  {id:'sathorn',name:'DANK Sathorn',lat:13.7108,lng:100.5375}
];
let deliveryProtocolRegistered = false;
function createDeliveryMap(ids) {
  const el = name => document.getElementById(ids[name]);
  let map, pending, version = 0, last, fitted = false, rider, destination, routePath = [], errorText = '', mode = 'light', riderKind = '', riderPosition, riderHeading = 0, movementFrame;
  let shops=[], routeTraffic=[], routeProgress=0, routeEncoded='', styleReady=false;
  window.addEventListener?.('rider-sheet-resize',()=>map?.resize());
  const empty = () => ({type:'FeatureCollection',features:[]});
  function drawRoute() {
    // isStyleLoaded becomes false while GeoJSON/tiles refresh. That must not suppress route writes.
    if (!map || !styleReady) return;
    const geometry = deliveryRouteFeatures(routePath,routeTraffic,routeProgress);
    if (!map.getSource('delivery-route')) {
      map.addSource('delivery-route',{type:'geojson',data:geometry});
      map.addLayer({id:'delivery-route-outline',type:'line',source:'delivery-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#087744','line-width':11}});
      map.addLayer({id:'delivery-route-line',type:'line',source:'delivery-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':7}});
    } else map.getSource('delivery-route').setData(geometry);
  }
  function removeLines() {routePath = [];routeTraffic=[];routeProgress=0;routeEncoded=''; drawRoute(); el('badge')?.classList.add('hidden');}
  function trimRoute() {if(routePath.length>1&&riderPosition){routeProgress=deliveryRouteProgress(routePath,{lng:riderPosition[0],lat:riderPosition[1]},routeProgress);drawRoute();}}
  function stopMovement() {if(movementFrame!==undefined)cancelAnimationFrame(movementFrame);movementFrame=undefined;}
  function clear() {stopMovement();riderPosition=null;riderKind='';riderHeading=0;version++; last = null; errorText = ''; removeLines(); rider?.remove(); destination?.remove();shops.forEach(marker=>marker.remove());shops=[]; rider = destination = null; fitted = false;}
  function stale() {stopMovement();if(rider&&last?.location){riderPosition=[last.location.lng,last.location.lat];rider.setLngLat(riderPosition);}removeLines();}
  function fit() {
    if (!map || !last) return;
    map.resize();
    const bounds = new maplibregl.LngLatBounds();
    if (last.destination) bounds.extend([last.destination.lng,last.destination.lat]);
    if (last.location) bounds.extend([last.location.lng,last.location.lat]);
    routePath.forEach(p => bounds.extend([p.lng,p.lat]));
    DELIVERY_SHOPS.forEach(shop=>bounds.extend([shop.lng,shop.lat]));
    if (!bounds.isEmpty()) map.fitBounds(bounds,{padding:{top:110,right:60,bottom:100,left:60},maxZoom:16,duration:500});
  }
  function load(data) {
    if (pending) return pending;
    if (map) return Promise.resolve();
    pending = new Promise((resolve,reject) => {
      if (!window.maplibregl || !window.pmtiles) {reject(new Error('Map could not load. Check your internet connection. Delivery controls still work.')); return;}
      if (!deliveryProtocolRegistered) {maplibregl.addProtocol('pmtiles',new pmtiles.Protocol().tile); deliveryProtocolRegistered = true;}
      map = new maplibregl.Map({container:el('map'),style:DELIVERY_STYLES[mode],center:data.destination?[data.destination.lng,data.destination.lat]:[10,30],zoom:data.destination?14:3,attributionControl:false});
      map.addControl(new maplibregl.AttributionControl({compact:false,customAttribution:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap ODbL</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps BSD</a>'}),'bottom-right');
      map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
      map.addControl({onAdd(){const a=document.createElement('a');a.className='maplibregl-ctrl elemnt-credit';a.href='https://elemnt.earth';a.target='_blank';a.rel='noopener noreferrer';a.textContent='Powered by ELEMNT';this.node=a;return a;},onRemove(){this.node.remove();}},'bottom-left');
      map.addControl({onAdd(){const b=document.createElement('button');b.type='button';b.className='maplibregl-ctrl delivery-theme';b.textContent='Dark map';b.setAttribute('aria-label','Switch to dark map');b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{mode=mode==='light'?'dark':'light';b.textContent=mode==='light'?'Dark map':'Light map';b.setAttribute('aria-label','Switch to '+(mode==='light'?'dark':'light')+' map');b.setAttribute('aria-pressed',String(mode==='dark'));styleReady=false;map.setStyle(DELIVERY_STYLES[mode]);});this.node=b;return b;},onRemove(){this.node.remove();}},'top-left');
      map.on('zoom',resizeScooter);
      map.on('style.load',()=>{styleReady=true;drawRoute();map.resize();});
      map.on('error',()=>{errorText='Map tiles unavailable. Check your connection. Delivery controls still work.';el('note').textContent=errorText;});
      map.once('load',()=>{styleReady=true;errorText='';drawRoute();resolve();});
    }).catch(error=>{pending=null;throw error;});
    return pending;
  }
  function pin(position,home,label,shop=false) {
    const content=document.createElement('div');
    content.className=shop?'delivery-origin-pin':home?'delivery-destination-pin':'delivery-rider-pin';
    content.setAttribute('aria-label',shop?'Shop origin: '+label:home?'Delivery destination':'Delivery rider');
    const pinShape = '<svg viewBox="0 0 36 48" aria-hidden="true"><path d="M18 2C8 2 2 9 2 18c0 12 16 27 16 27s16-15 16-27C34 9 28 2 18 2Z" fill="'+(shop?'#008f4b':home?'#ef5544':'#009ee8')+'" stroke="white" stroke-width="2"/><circle cx="18" cy="18" r="6" fill="white"/></svg>';
    content.innerHTML='<span class="delivery-pin-shape">'+pinShape+'</span><span class="delivery-location-pill"></span>';
    content.querySelector('.delivery-location-pill').textContent=label||(home?'Your delivery':'Your rider');
    return new maplibregl.Marker({element:content,anchor:home||shop?'bottom':'center',offset:home||shop?[0,2.8]:[0,0]}).setLngLat([position.lng,position.lat]).addTo(map);
  }
  function sizeScooter(content) {
    const width=Math.max(32.4,Math.min(68.4,47.88*Math.pow(2,(map.getZoom()-14)/4)));
    content.style.width=width+'px';content.style.height=(width*88/76)+'px';
  }
  function resizeScooter() {if(riderKind==='scooter'&&rider)sizeScooter(rider.getElement());}
  function movingRider(position) {
    const content=document.createElement('div');
    content.className='delivery-moving-rider';
    sizeScooter(content);
    content.setAttribute('aria-label','Delivery rider on scooter');
    content.innerHTML='<img src="/assets/delivery-rider.svg" width="76" height="88" alt="" draggable="false">';
    return new maplibregl.Marker({element:content,anchor:'center',rotationAlignment:'map'}).setLngLat([position.lng,position.lat]).addTo(map);
  }
  function moveRider(position,animate) {
    stopMovement();
    const target=[position.lng,position.lat],start=riderPosition;
    if(start){
      const radians=Math.PI/180,dx=(target[0]-start[0])*Math.cos(start[1]*radians),dy=target[1]-start[1];
      // Ignore GPS jitter when deciding which way the scooter faces.
      if(Math.hypot(dx,dy)*111320>3)riderHeading=Math.atan2(dx,dy)/radians;
    }
    if(riderKind==='scooter')rider.setRotation(riderHeading);
    if(!animate||!start||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||!window.requestAnimationFrame){riderPosition=target;rider.setLngLat(target);trimRoute();return;}
    if(start[0]===target[0]&&start[1]===target[1])return;
    // Ease between received GPS fixes only; never predict unreported movement.
    let began;
    const marker=rider;
    function frame(now){
      if(marker!==rider)return;
      began??=now;const t=Math.min(1,(now-began)/1200),ease=t*t*(3-2*t);
      riderPosition=[start[0]+(target[0]-start[0])*ease,start[1]+(target[1]-start[1])*ease];
      marker.setLngLat(riderPosition);trimRoute();
      if(t<1)movementFrame=requestAnimationFrame(frame);else movementFrame=undefined;
    }
    movementFrame=requestAnimationFrame(frame);
  }
  async function update(data) {
    const current=++version;last=data;
    if (['completed','cancelled'].includes(data.status)) {clear();return;}
    el('label').textContent=data.destinationLabel||'Delivery destination';
    try {
      await load(data);if(current!==version||last!==data)return;
      errorText='';map.resize();
      if(!shops.length)shops=DELIVERY_SHOPS.map(shop=>pin(shop,false,shop.name,true));
      if(data.destination){if(!destination)destination=pin(data.destination,true,data.destinationLabel);else destination.setLngLat([data.destination.lng,data.destination.lat]);}
      if(data.location){
        const kind=data.status==='on_the_way'?'scooter':'pin';
        if(!rider||riderKind!==kind){stopMovement();rider?.remove();riderPosition=null;riderHeading=0;riderKind=kind;rider=kind==='scooter'?movingRider(data.location):pin(data.location,false);}
        moveRider(data.location,kind==='scooter'&&!data.stale);
      }else{stopMovement();rider?.remove();rider=null;riderPosition=null;riderKind='';}
      const route=data.location?.route;
      if(!data.stale&&route?.polyline){if(routeEncoded!==route.polyline){routePath=decodeDeliveryRoute(route.polyline);routeProgress=0;routeEncoded=route.polyline;}routeTraffic=Array.isArray(route.traffic)?route.traffic:[];trimRoute();drawRoute();if(el('badge')){el('badge').textContent='Best route · '+route.minutes+' min'+(Number.isFinite(route.km)?' · '+route.km+' km':'');el('badge').classList.remove('hidden');}}
      else removeLines();
      if(!fitted&&data.location){fit();fitted=true;}else if(!fitted&&data.destination)map.setCenter([data.destination.lng,data.destination.lat]);
    } catch(error){if(current===version){errorText=/webgl/i.test(error.message||'')?'This browser cannot display the map. Rider details and photos still work.':'Map unavailable. Check your connection. Rider details and photos still work.';el('note').textContent=errorText;el('badge')?.classList.add('hidden');}}
  }
  return {update,clear,stale,fit,error:()=>errorText};
}

