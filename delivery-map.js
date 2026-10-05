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
// Shared customer/rider map. Versions prevent late map loading from reviving an
// old position after pause, completion or a newer delivery update.
function createDeliveryMap(ids) {
  const el = name => document.getElementById(ids[name]);
  let map, pending, version = 0, last, fitted = false, rider, destination, lines = [], routePath = [], errorText = '';
  function removeLines() {lines.forEach(line => line.setMap(null)); lines = []; routePath = []; el('badge').classList.add('hidden');}
  function clear() {version++; last = null; errorText = ''; removeLines(); if (rider) rider.map = null; if (destination) destination.map = null; rider = destination = null; fitted = false;}
  function stale() {removeLines();}
  function fit() {
    if (!map || !last) return;
    const bounds = new google.maps.LatLngBounds();
    if (last.destination) bounds.extend(last.destination);
    if (last.location) bounds.extend(last.location);
    routePath.forEach(point => bounds.extend(point));
    if (!bounds.isEmpty()) map.fitBounds(bounds, {top: 110, right: 60, bottom: 80, left: 60});
  }
  function load(data) {
    if (map) return Promise.resolve();
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      if (!data.mapsKey) {reject(new Error('Google map unavailable. Delivery controls still work.')); return;}
      window.initDeliveryRouteMap = () => {
        try {map = new google.maps.Map(el('map'), {center: data.destination || {lat: 13.7563, lng: 100.5018}, zoom: 14,
          mapId: data.mapId || 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: 'cooperative'}); resolve();}
        catch (error) {reject(error);}
      };
      window.gm_authFailure = () => reject(new Error('Google Maps authorization failed. Contact the shop.'));
      const script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(data.mapsKey) + '&libraries=marker&loading=async&callback=initDeliveryRouteMap';
      script.referrerPolicy = 'strict-origin-when-cross-origin'; script.async = true;
      script.onerror = () => reject(new Error('Map could not load. Check your internet connection.'));
      document.head.appendChild(script);
    }).catch(error => {pending = null; throw error;});
    return pending;
  }
  function pin(position, home) {
    const content = document.createElement('div');
    content.className = home ? 'delivery-destination-pin' : 'delivery-rider-pin';
    content.innerHTML = home ? '<svg viewBox="0 0 36 48" aria-hidden="true"><path d="M18 2C8 2 2 9 2 18c0 12 16 27 16 27s16-15 16-27C34 9 28 2 18 2Z" fill="#ef6152" stroke="white" stroke-width="3"/><circle cx="18" cy="18" r="6" fill="white"/></svg>' : '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="24" r="4"/><circle cx="25" cy="24" r="4"/><path d="M7 24h12l6-12h-5M18 11l-3 7H9l-2 6m12 0 3-8M6 15h8M22 8h4l2 4"/><circle cx="16" cy="5" r="2.5"/><path d="m15 10-4 4 7 4"/></svg>';
    return new google.maps.marker.AdvancedMarkerElement({map, position, content, title: home ? 'Delivery destination' : 'Delivery rider'});
  }
  async function update(data) {
    const current = ++version; last = data;
    if (['completed', 'cancelled'].includes(data.status)) {clear(); return;}
    el('label').textContent = data.destinationLabel || 'Delivery destination';
    try {
      await load(data); if (current !== version || last !== data) return;
      errorText = '';
      if (data.destination) {if (!destination) destination = pin(data.destination, true); else destination.position = data.destination;}
      if (data.location) {if (!rider) rider = pin(data.location, false); else rider.position = data.location;} else if (rider) {rider.map = null; rider = null;}
      removeLines();
      const route = data.location?.route;
      if (!data.stale && route?.polyline) {
        routePath = decodeDeliveryRoute(route.polyline);
        lines = [new google.maps.Polyline({map, path: routePath, strokeColor: '#087744', strokeWeight: 11, strokeOpacity: 1, zIndex: 1}),
          new google.maps.Polyline({map, path: routePath, strokeColor: '#00b65b', strokeWeight: 7, strokeOpacity: 1, zIndex: 2})];
        el('badge').textContent = (data.demo ? 'Demo route · ' : 'On the way · ') + route.minutes + ' min' + (Number.isFinite(route.km) ? ' · ' + route.km + ' km' : '');
        el('badge').classList.remove('hidden');
      }
      if (!fitted && data.location) {fit(); fitted = true;}
      else if (!fitted && data.destination) {map.setCenter(data.destination);}
    } catch (error) {if (current === version) {errorText = error.message; el('note').textContent = error.message; el('badge').classList.add('hidden');}}
  }
  return {update, clear, stale, fit, error: () => errorText};
}
