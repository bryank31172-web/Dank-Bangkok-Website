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
// Google Maps renders both delivery pages. Keys come from the public browser
// config; the Routes key stays server-only. Raster rendering also works without WebGL.
let deliveryGooglePromise;
const deliveryGoogleErrors = new Set();
function loadDeliveryGoogle() {
  if (deliveryGooglePromise) return deliveryGooglePromise;
  deliveryGooglePromise = (async () => {
    const response = await fetch('/api/maps-config', {signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Google Maps configuration unavailable.');
    const config = await response.json();
    if (!config.key) throw new Error('Google Maps browser key is not configured.');
    if (!window.google?.maps?.Map) await new Promise((resolve, reject) => {
      const script = document.createElement('script'), callback = '__dankDeliveryGoogleReady';
      const finish = error => {clearTimeout(timeout);delete window[callback];if (error) {script.remove();reject(error);} else resolve();};
      const timeout = setTimeout(() => finish(new Error('Google Maps could not load. Check your connection.')), 20000);
      window[callback] = () => finish();
      window.gm_authFailure = () => {
        const error = new Error('Google Maps key was rejected. Contact the shop.');
        deliveryGoogleErrors.forEach(report => report(error.message));finish(error);
      };
      script.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({key: config.key, v: 'weekly', loading: 'async', callback});
      script.async = true;script.onerror = () => finish(new Error('Google Maps could not load. Check your connection.'));
      document.head.appendChild(script);
    });
    return config;
  })().catch(error => {deliveryGooglePromise = null;throw error;});
  return deliveryGooglePromise;
}
function deliveryDistance(a, b) {
  const x = (a.lng - b.lng) * Math.cos((a.lat + b.lat) * Math.PI / 360), y = a.lat - b.lat;
  return Math.hypot(x, y) * 111195;
}
function deliveryPathLengths(path) {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + deliveryDistance(path[i - 1], path[i]));
  return lengths;
}
function deliveryPathAt(path, lengths, fraction) {
  if (path.length < 2 || !lengths.at(-1)) return {...path[0], index: 0};
  const target = Math.max(0, Math.min(1, fraction)) * lengths.at(-1);
  let index = 0;while (index < path.length - 2 && lengths[index + 1] < target) index++;
  const span = lengths[index + 1] - lengths[index], f = span ? (target - lengths[index]) / span : 0;
  return {lat: path[index].lat + (path[index + 1].lat - path[index].lat) * f,
    lng: path[index].lng + (path[index + 1].lng - path[index].lng) * f, index};
}
// Follow the previous Google road geometry between two received GPS fixes.
// Never predict movement beyond the newest fix. Off-route/large gaps snap instead.
function deliveryMovementPath(path, from, to) {
  function project(point) {
    let best;
    const scale = Math.cos(point.lat * Math.PI / 180);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], dx = (b.lng - a.lng) * scale, dy = b.lat - a.lat;
      const f = Math.max(0, Math.min(1, ((point.lng - a.lng) * scale * dx + (point.lat - a.lat) * dy) / (dx * dx + dy * dy || 1)));
      const p = {lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f};
      const distance = deliveryDistance(point, p);
      if (!best || distance < best.distance) best = {point: p, offset: i + f, distance};
    }
    return best;
  }
  const a = project(from), b = project(to);
  if (!a || !b || a.distance > 100 || b.distance > 100 || b.offset < a.offset) return null;
  return [from, a.point, ...path.slice(Math.floor(a.offset) + 1, Math.floor(b.offset) + 1), b.point, to];
}
function createDeliveryMap(ids) {
  const el = name => document.getElementById(ids[name]);
  let map, pending, version = 0, last, fitted = false, rider, destination, lines = [], routePath = [], errorText = '';
  let frame = null, riderPosition, lastCapture;
  function stopMotion() {if (frame !== null) cancelAnimationFrame(frame);frame = null;}
  function removeLines() {lines.forEach(line => line.setMap(null));lines = [];routePath = [];el('badge').classList.add('hidden');}
  function clear() {
    version++;last = null;stopMotion();removeLines();rider?.setMap(null);destination?.setMap(null);
    rider = destination = null;riderPosition = null;lastCapture = null;fitted = false;
  }
  function stale() {stopMotion();if (rider && last?.location) {riderPosition = {...last.location};rider.setPosition(riderPosition);}removeLines();}
  function report(message) {errorText = message;el('note').textContent = message;stopMotion();el('badge').classList.add('hidden');}
  deliveryGoogleErrors.add(report);
  function fit() {
    if (!map || !last) return;
    google.maps.event.trigger(map, 'resize');
    const bounds = new google.maps.LatLngBounds();
    if (last.destination) bounds.extend(last.destination);
    if (last.location) bounds.extend(last.location);
    routePath.forEach(point => bounds.extend(point));
    if (!bounds.isEmpty()) {map.fitBounds(bounds, {top: 105, right: 65, bottom: 110, left: 65});
      google.maps.event.addListenerOnce(map, 'idle', () => {if (map.getZoom() > 16) map.setZoom(16);});}
  }
  function load(data) {
    if (map) return Promise.resolve();
    if (pending) return pending;
    pending = loadDeliveryGoogle().then(config => {
      map = new google.maps.Map(el('map'), {center: data.destination || {lat: 13.73, lng: 100.65}, zoom: 14,
        renderingType: google.maps.RenderingType.RASTER, ...(config.mapIdConfigured ? {mapId: config.mapId} : {}),
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        clickableIcons: false, gestureHandling: 'cooperative', zoomControlOptions: {position: google.maps.ControlPosition.RIGHT_CENTER}});
    }).catch(error => {pending = null;throw error;});
    return pending;
  }
  function pin(point, home) {
    class DeliveryPin extends google.maps.OverlayView {
      constructor() {super();this.position = point;this.headingOrigin = point;this.heading = 0;this.content = document.createElement('div');
        this.content.className = home ? 'delivery-destination-pin' : 'delivery-moving-rider';
        this.content.style.position = 'absolute';this.content.style.pointerEvents = 'none';
        this.content.style.transform = home ? 'translate(-50%,-100%)' : 'translate(-50%,-50%)';
        this.content.setAttribute('aria-label', home ? 'Delivery destination' : 'Delivery rider');
        this.content.innerHTML = home
          ? '<svg viewBox="0 0 36 48" aria-hidden="true"><path d="M18 2C8 2 2 9 2 18c0 12 16 27 16 27s16-15 16-27C34 9 28 2 18 2Z" fill="#ef6152" stroke="white" stroke-width="3"/><circle cx="18" cy="18" r="6" fill="white"/></svg>'
          : '<img src="/assets/delivery-rider.svg" width="76" height="88" alt="" draggable="false">';
        this.setMap(map);
      }
      onAdd() {this.getPanes().overlayMouseTarget.appendChild(this.content);}
      draw() {const pixel = this.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(this.position));
        if (!home) {const width = Math.max(32.4, Math.min(68.4, 47.88 * Math.pow(2, (map.getZoom() - 14) / 4)));
          this.content.style.width = width + 'px';this.content.style.height = (width * 88 / 76) + 'px';
          this.content.style.transform = 'translate(-50%,-50%) rotate(' + this.heading + 'deg)';}
        if (pixel) {this.content.style.left = pixel.x + 'px';this.content.style.top = pixel.y + 'px';}}
      onRemove() {this.content.remove();}
      setPosition(position) {
        if (!home && deliveryDistance(this.headingOrigin, position) > 3) {
          const dx = (position.lng - this.headingOrigin.lng) * Math.cos(this.headingOrigin.lat * Math.PI / 180);
          this.heading = Math.atan2(dx, position.lat - this.headingOrigin.lat) * 180 / Math.PI;
          this.headingOrigin = position;
        }
        this.position = position;this.draw();
      }
    }
    return new DeliveryPin();
  }
  function move(point, data, previousRoute) {
    const from = riderPosition, capture = point.capturedAt;
    const same = capture != null && capture === lastCapture;
    if (same) return;
    stopMotion();
    const path = from && deliveryMovementPath(previousRoute, from, point);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = data.demo ? 2500 : Math.min(8000, Math.max(1500, (capture - lastCapture) || 3000));
    lastCapture = capture;
    if (!from || !path || (!data.demo && deliveryDistance(from, point) > 2000) || reduced || document.hidden || !window.requestAnimationFrame) {
      riderPosition = {lat: point.lat, lng: point.lng};rider.setPosition(riderPosition);return;
    }
    const lengths = deliveryPathLengths(path), started = performance.now(), target = rider;
    function animate(now) {
      if (rider !== target || !last?.location || last.stale) {frame = null;return;}
      const progress = Math.min(1, (now - started) / duration);
      riderPosition = deliveryPathAt(path, lengths, progress);target.setPosition(riderPosition);
      // The line begins at the interpolated marker, rather than jumping ahead
      // to the newly received fix while the marker catches up along the road.
      const remaining = [riderPosition, ...path.slice(riderPosition.index + 1), ...routePath];
      lines.forEach(line => line.setPath(remaining));
      frame = progress < 1 ? requestAnimationFrame(animate) : null;
    }
    frame = requestAnimationFrame(animate);
  }
  async function update(data) {
    const current = ++version, previousRoute = routePath.slice();last = data;
    if (['completed', 'cancelled'].includes(data.status)) {clear();return;}
    // Remove paused/shared coordinates immediately, even while the API is loading.
    if (!data.location) {stopMotion();rider?.setMap(null);rider = null;riderPosition = null;lastCapture = null;removeLines();}
    el('label').textContent = data.destinationLabel || 'Delivery destination';
    try {
      await load(data);if (current !== version || last !== data) return;
      errorText = '';google.maps.event.trigger(map, 'resize');
      if (data.destination) {if (!destination) destination = pin(data.destination, true);else destination.setPosition(data.destination);}
      if (data.location) {if (!rider) rider = pin(data.location, false);move(data.location, data, previousRoute);}
      removeLines();const route = data.location?.route;
      if (!data.stale && route?.polyline) {
        routePath = decodeDeliveryRoute(route.polyline);
        for (const options of [{strokeColor: '#087744', strokeWeight: 10}, {strokeColor: '#00b65b', strokeWeight: 6}])
          lines.push(new google.maps.Polyline({map, path: routePath, ...options, strokeOpacity: 1, clickable: false}));
        el('badge').textContent = (data.demo ? 'Simulated route · ' : 'On the way · ') + route.minutes + ' min' + (Number.isFinite(route.km) ? ' · ' + route.km + ' km' : '');
        el('badge').classList.remove('hidden');
      } else if (data.stale) stopMotion();
      if (!fitted && data.location) {fit();fitted = true;}else if (!fitted && data.destination) map.setCenter(data.destination);
    } catch (error) {if (current === version) report(error.message);}
  }
  document.addEventListener('visibilitychange', () => {if (document.hidden) {stopMotion();if (rider && last?.location) {riderPosition = {...last.location};rider.setPosition(riderPosition);}}});
  window.addEventListener('pagehide', clear);
  return {update, clear, stale, fit, error: () => errorText};
}
