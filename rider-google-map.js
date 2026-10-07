// The browser key is already public and referrer restricted. Never use the server key.
let riderGoogleLoading;
async function loadRiderGoogleMaps() {
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
function createRiderGoogleMap(ids) {
  const node=document.getElementById(ids.google), fallback=document.getElementById(ids.fallback);
  let map,rider,destination,traffic,lines=[],last,version=0,following=true,encoded='',points=[],progress=0;
  function removeLines(){lines.forEach(line=>line.setMap(null));lines=[];}
  function clear(){version++;last=null;removeLines();rider?.setMap(null);destination?.setMap(null);rider=destination=null;traffic?.setMap(null);encoded='';points=[];progress=0;node.classList.add('hidden');fallback.classList.remove('hidden');}
  function fit(){following=true;if(map&&last?.location){map.panTo(last.location);map.setZoom(16);}}
  async function update(data){
    if(data.status!=='on_the_way'||!data.location||data.stale){clear();return false;}
    const current=++version;last=data;
    try{
      await loadRiderGoogleMaps();if(current!==version||last!==data)return false;
      if(!map){map=new google.maps.Map(node,{center:data.location,zoom:16,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:'greedy'});traffic=new google.maps.TrafficLayer();map.addListener('dragstart',()=>{following=false;});}
      node.classList.remove('hidden');fallback.classList.add('hidden');traffic.setMap(map);
      if(!rider)rider=new google.maps.Marker({map,position:data.location,title:'Your current location',icon:{url:'/assets/delivery-rider.svg',scaledSize:new google.maps.Size(47.88,55.44),anchor:new google.maps.Point(23.94,27.72)}});else rider.setPosition(data.location);
      if(data.destination){if(!destination)destination=new google.maps.Marker({map,position:data.destination,title:data.address||'Delivery destination'});else destination.setPosition(data.destination);}
      const route=data.location.route;
      if(route?.polyline){if(encoded!==route.polyline){encoded=route.polyline;points=decodeDeliveryRoute(encoded);progress=0;}progress=deliveryRouteProgress(points,data.location,progress);removeLines();
        const features=deliveryRouteFeatures(points,route.traffic,progress).features;
        // Merge adjacent colours to avoid creating one Google overlay per segment.
        const groups=[];for(const feature of features){const color=feature.properties.color,coords=feature.geometry.coordinates,previous=groups.at(-1);if(previous?.color===color)previous.coords.push(coords[1]);else groups.push({color,coords:[...coords]});}
        groups.forEach(group=>{const path=group.coords.map(([lng,lat])=>({lng,lat}));lines.push(new google.maps.Polyline({map,path,strokeColor:'#087744',strokeWeight:10,strokeOpacity:1,zIndex:1}),new google.maps.Polyline({map,path,strokeColor:group.color,strokeWeight:6,strokeOpacity:1,zIndex:2}));});
      }else{removeLines();encoded='';points=[];progress=0;}
      if(following)map.panTo(data.location);
      return true;
    }catch{if(current===version){node.classList.add('hidden');fallback.classList.remove('hidden');}return false;}
  }
  return {update,clear,fit};
}
