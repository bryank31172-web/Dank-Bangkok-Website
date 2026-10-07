// The browser key is already public and referrer restricted. Never use the server key.
let riderGoogleLoading;
let riderGoogleAuthFailed=false;
const riderGoogleFailures=new Set();
window.gm_authFailure=()=>{riderGoogleAuthFailed=true;riderGoogleFailures.forEach(fn=>fn());};
async function loadRiderGoogleMaps() {
  if(riderGoogleAuthFailed)throw Error('Google Maps does not allow this website');
  if (window.google?.maps?.Map) return;
  if (riderGoogleLoading) return riderGoogleLoading;
  riderGoogleLoading = (async()=>{
    const response=await fetch('/api/maps-config',{signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw Error('Google Maps settings unavailable');
    const config=await response.json();
    if(!config.key) throw Error('Google Maps browser key is not configured');
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      let timeout;
      function done(error){clearTimeout(timeout);delete window.dankRiderGoogleReady;error?reject(error):resolve();}
      window.dankRiderGoogleReady=()=>done();
      script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key:config.key,v:'weekly',loading:'async',callback:'dankRiderGoogleReady'});
      script.async=true;script.onerror=()=>done(Error('Google Maps could not load'));
      timeout=setTimeout(()=>{script.remove();done(Error('Google Maps timed out'));},15000);
      document.head.appendChild(script);
    });
  })().catch(error=>{riderGoogleLoading=null;throw error;});
  return riderGoogleLoading;
}
// Google overlays use the same anchored pin, label and scooter artwork as the customer map.
function createRiderGoogleMap(ids) {
  const node=document.getElementById(ids.google), fallback=document.getElementById(ids.fallback);
  let map,rider,destination,traffic,shops=[],lines=[],last,version=0,following=true,encoded='',points=[],progress=0,position,movementFrame;
  function scooterWidth(){return Math.max(32.4,Math.min(68.4,47.88*Math.pow(2,((map.getZoom?.()||16)-14)/4)));}
  function overlay(point,{scooter=false,home=false,shop=false,label=''}={}) {
    const color=shop?'#008f4b':home?'#ef5544':'#009ee8';
    const pin='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 48"><path d="M18 2C8 2 2 9 2 18c0 12 16 27 16 27s16-15 16-27C34 9 28 2 18 2Z" fill="'+color+'" stroke="white" stroke-width="2"/><circle cx="18" cy="18" r="6" fill="white"/></svg>';
    if(!google.maps.OverlayView){
      const icon={url:scooter?'/assets/delivery-rider.svg':'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(pin),scaledSize:new google.maps.Size(scooter?scooterWidth():35.2,scooter?scooterWidth()*88/76:44.8),anchor:new google.maps.Point(scooter?scooterWidth()/2:17.6,scooter?scooterWidth()*44/76:42)};
      const marker=new google.maps.Marker({map,position:point,title:label||'Delivery rider on scooter',icon});
      marker.resize=()=>{if(scooter){const w=scooterWidth();marker.setIcon?.({...icon,scaledSize:new google.maps.Size(w,w*88/76),anchor:new google.maps.Point(w/2,w*44/76)});}};
      marker.heading=()=>{};return marker;
    }
    const marker=new google.maps.OverlayView(),element=document.createElement('div');let current=point,width=scooter?scooterWidth():35.2;
    element.className=scooter?'delivery-moving-rider':shop?'delivery-origin-pin':'delivery-destination-pin';
    element.style.position='absolute';element.style.pointerEvents='none';element.style.zIndex=scooter?'30':home?'20':'10';
    element.setAttribute('aria-label',scooter?'Delivery rider on scooter':shop?'Shop origin: '+label:'Delivery destination: '+label);
    element.innerHTML=scooter?'<img src="/assets/delivery-rider.svg" alt="" draggable="false">':'<span class="delivery-pin-shape">'+pin+'</span><span class="delivery-location-pill"></span>';
    if(!scooter)element.querySelector('.delivery-location-pill').textContent=label;
    marker.onAdd=()=>marker.getPanes().overlayMouseTarget.appendChild(element);
    marker.draw=()=>{const pixel=marker.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(current.lat,current.lng));if(!pixel)return;element.style.left=(pixel.x-width/2)+'px';element.style.top=(pixel.y-(scooter?width*44/76:42))+'px';};
    marker.onRemove=()=>element.remove();
    marker.setPosition=point=>{current={lat:point.lat,lng:point.lng};marker.draw();};
    marker.resize=()=>{if(scooter){width=scooterWidth();element.style.width=width+'px';element.style.height=(width*88/76)+'px';marker.draw();}};
    marker.heading=angle=>{if(scooter)element.querySelector('img').style.transform='rotate('+angle+'deg)';};
    marker.setMap(map);marker.resize();return marker;
  }
  window.addEventListener?.('rider-sheet-resize',()=>{if(map){google.maps.event?.trigger(map,'resize');if(following&&last?.location)map.panTo(last.location);}});
  riderGoogleFailures.add(()=>{const data=last;clear();if(data)ids.onFallback?.(data);});
  function removeLines(){lines.forEach(line=>line.setMap(null));lines=[];}
  function stopMovement(){if(movementFrame!==undefined)cancelAnimationFrame(movementFrame);movementFrame=undefined;}
  function clear(){version++;last=null;stopMovement();position=null;removeLines();rider?.setMap(null);destination?.setMap(null);shops.forEach(marker=>marker.setMap(null));shops=[];rider=destination=null;traffic?.setMap(null);encoded='';points=[];progress=0;node.classList.add('hidden');fallback.classList.remove('hidden');}
  function fit(){following=true;if(map&&last?.location){map.panTo(last.location);map.setZoom(16);}}
  function drawRoute(){
    if(position&&points.length>1)progress=deliveryRouteProgress(points,position,progress);
    removeLines();const groups=[];
    for(const feature of deliveryRouteFeatures(points,last?.location?.route?.traffic,progress).features){const color=feature.properties.color,coords=feature.geometry.coordinates,previous=groups.at(-1);if(previous?.color===color)previous.coords.push(coords[1]);else groups.push({color,coords:[...coords]});}
    groups.forEach(group=>{const path=group.coords.map(([lng,lat])=>({lng,lat}));lines.push(new google.maps.Polyline({map,path,strokeColor:'#087744',strokeWeight:11,strokeOpacity:1,zIndex:1}),new google.maps.Polyline({map,path,strokeColor:group.color,strokeWeight:7,strokeOpacity:1,zIndex:2}));});
  }
  function moveRider(target){
    stopMovement();const start=position,marker=rider;
    if(start){const dx=(target.lng-start.lng)*Math.cos(start.lat*Math.PI/180),dy=target.lat-start.lat;if(Math.hypot(dx,dy)*111320>3)marker.heading(Math.atan2(dx,dy)*180/Math.PI);}
    if(!start||!window.requestAnimationFrame||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){position={lat:target.lat,lng:target.lng};marker.setPosition(position);drawRoute();return;}
    if(start.lat===target.lat&&start.lng===target.lng){drawRoute();return;}
    let began;
    function frame(now){if(marker!==rider||!last)return;began??=now;const t=Math.min(1,(now-began)/1200),ease=t*t*(3-2*t);position={lat:start.lat+(target.lat-start.lat)*ease,lng:start.lng+(target.lng-start.lng)*ease};marker.setPosition(position);drawRoute();if(t<1)movementFrame=requestAnimationFrame(frame);else movementFrame=undefined;}
    movementFrame=requestAnimationFrame(frame);
  }
  async function update(data){
    if(data.status!=='on_the_way'||!data.location||data.stale){clear();return false;}
    const current=++version;last=data;
    try{
      await loadRiderGoogleMaps();if(current!==version||last!==data)return false;
      if(!map){map=new google.maps.Map(node,{center:data.location,zoom:16,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:'greedy'});traffic=new google.maps.TrafficLayer();map.addListener('dragstart',()=>{following=false;});map.addListener('zoom_changed',()=>rider?.resize());}
      node.classList.remove('hidden');fallback.classList.add('hidden');traffic.setMap(map);
      if(!shops.length)shops=DELIVERY_SHOPS.map(shop=>overlay(shop,{shop:true,label:shop.name}));
      if(!rider)rider=overlay(data.location,{scooter:true});
      if(data.destination){if(!destination)destination=overlay(data.destination,{home:true,label:data.destinationLabel||data.address||'Delivery destination'});else destination.setPosition(data.destination);}else{destination?.setMap(null);destination=null;}
      const route=data.location.route;
      if(route?.polyline){if(encoded!==route.polyline){encoded=route.polyline;points=decodeDeliveryRoute(encoded);progress=0;}}else{encoded='';points=[];progress=0;}
      moveRider(data.location);
      if(following)map.panTo(data.location);
      return true;
    }catch{if(current===version)clear();return false;}
  }
  return {update,clear,fit};
}
