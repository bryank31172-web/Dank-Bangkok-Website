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
// Shared MapLibre map. Keep the latest delivery overlay through style changes.
const DELIVERY_STYLES = {
  light: 'https://carto.elemnt.earth/2026-06-22_wayfinder/style.json',
  dark: 'https://carto.elemnt.earth/2026-06-22_wayfinder/style.dark.json'
};
let deliveryProtocolRegistered = false;
function createDeliveryMap(ids) {
  const el = name => document.getElementById(ids[name]);
  let map, pending, version = 0, last, fitted = false, rider, destination, routePath = [], errorText = '', mode = 'light', riderKind = '', riderPosition, riderHeading = 0, movementFrame;
  const empty = () => ({type:'FeatureCollection',features:[]});
  function drawRoute() {
    if (!map?.isStyleLoaded()) return;
    const geometry = routePath.length > 1 ? {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:routePath.map(p=>[p.lng,p.lat])}} : empty();
    if (!map.getSource('delivery-route')) {
      map.addSource('delivery-route',{type:'geojson',data:geometry});
      map.addLayer({id:'delivery-route-outline',type:'line',source:'delivery-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#087744','line-width':11}});
      map.addLayer({id:'delivery-route-line',type:'line',source:'delivery-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#00b65b','line-width':7}});
    } else map.getSource('delivery-route').setData(geometry);
  }
  function removeLines() {routePath = []; drawRoute(); el('badge').classList.add('hidden');}
  function stopMovement() {if(movementFrame!==undefined)cancelAnimationFrame(movementFrame);movementFrame=undefined;}
  function clear() {stopMovement();riderPosition=null;riderKind='';riderHeading=0;version++; last = null; errorText = ''; removeLines(); rider?.remove(); destination?.remove(); rider = destination = null; fitted = false;}
  function stale() {stopMovement();if(rider&&last?.location){riderPosition=[last.location.lng,last.location.lat];rider.setLngLat(riderPosition);}removeLines();}
  function fit() {
    if (!map || !last) return;
    map.resize();
    const bounds = new maplibregl.LngLatBounds();
    if (last.destination) bounds.extend([last.destination.lng,last.destination.lat]);
    if (last.location) bounds.extend([last.location.lng,last.location.lat]);
    routePath.forEach(p => bounds.extend([p.lng,p.lat]));
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
      map.addControl({onAdd(){const b=document.createElement('button');b.type='button';b.className='maplibregl-ctrl delivery-theme';b.textContent='Dark map';b.setAttribute('aria-label','Switch to dark map');b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{mode=mode==='light'?'dark':'light';b.textContent=mode==='light'?'Dark map':'Light map';b.setAttribute('aria-label','Switch to '+(mode==='light'?'dark':'light')+' map');b.setAttribute('aria-pressed',String(mode==='dark'));map.setStyle(DELIVERY_STYLES[mode]);});this.node=b;return b;},onRemove(){this.node.remove();}},'top-left');
      map.on('style.load',()=>{drawRoute();map.resize();});
      map.on('error',()=>{errorText='Map tiles unavailable. Check your connection. Delivery controls still work.';el('note').textContent=errorText;});
      map.once('load',()=>{errorText='';resolve();});
    }).catch(error=>{pending=null;throw error;});
    return pending;
  }
  function pin(position,home,label) {
    const content=document.createElement('div');
    content.className=home?'delivery-destination-pin':'delivery-rider-pin';
    content.setAttribute('aria-label',home?'Delivery destination':'Delivery rider');
    const pinShape = '<svg viewBox="0 0 36 48" aria-hidden="true"><path d="M18 2C8 2 2 9 2 18c0 12 16 27 16 27s16-15 16-27C34 9 28 2 18 2Z" fill="'+(home?'#ef5544':'#009ee8')+'" stroke="white" stroke-width="2"/><circle cx="18" cy="18" r="6" fill="white"/></svg>';
    content.innerHTML='<span class="delivery-pin-shape">'+pinShape+'</span><span class="delivery-location-pill"></span>';
    content.querySelector('.delivery-location-pill').textContent=label||(home?'Your delivery':'Your rider');
    return new maplibregl.Marker({element:content,anchor:home?'bottom':'center'}).setLngLat([position.lng,position.lat]).addTo(map);
  }
  function movingRider(position) {
    const content=document.createElement('div');
    content.className='delivery-moving-rider';
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
    if(!animate||!start||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||!window.requestAnimationFrame){riderPosition=target;rider.setLngLat(target);return;}
    if(start[0]===target[0]&&start[1]===target[1])return;
    // Ease between received GPS fixes only; never predict unreported movement.
    let began;
    const marker=rider;
    function frame(now){
      if(marker!==rider)return;
      began??=now;const t=Math.min(1,(now-began)/1200),ease=t*t*(3-2*t);
      riderPosition=[start[0]+(target[0]-start[0])*ease,start[1]+(target[1]-start[1])*ease];
      marker.setLngLat(riderPosition);
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
      if(data.destination){if(!destination)destination=pin(data.destination,true,data.destinationLabel);else destination.setLngLat([data.destination.lng,data.destination.lat]);}
      if(data.location){
        const kind=data.status==='on_the_way'?'scooter':'pin';
        if(!rider||riderKind!==kind){stopMovement();rider?.remove();riderPosition=null;riderHeading=0;riderKind=kind;rider=kind==='scooter'?movingRider(data.location):pin(data.location,false);}
        moveRider(data.location,kind==='scooter'&&!data.stale);
      }else{stopMovement();rider?.remove();rider=null;riderPosition=null;riderKind='';}
      removeLines();const route=data.location?.route;
      if(!data.stale&&route?.polyline){routePath=decodeDeliveryRoute(route.polyline);drawRoute();el('badge').textContent=(data.demo?'Demo route · ':'Best route · ')+route.minutes+' min'+(Number.isFinite(route.km)?' · '+route.km+' km':'');el('badge').classList.remove('hidden');}
      if(!fitted&&data.location){fit();fitted=true;}else if(!fitted&&data.destination)map.setCenter([data.destination.lng,data.destination.lat]);
    } catch(error){if(current===version){errorText=/webgl/i.test(error.message||'')?'This browser cannot display the map. Rider details and photos still work.':'Map unavailable. Check your connection. Rider details and photos still work.';el('note').textContent=errorText;el('badge').classList.add('hidden');}}
  }
  return {update,clear,stale,fit,error:()=>errorText};
}
