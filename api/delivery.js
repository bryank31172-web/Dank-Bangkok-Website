import { getJSON } from './_store.js';
import { requirePermission, safeEq } from './_auth.js';
import { requireRate } from './_ratelimit.js';
import * as delivery from './_delivery.js';
import {createSetupHandler} from './_delivery-setup.js';
import {createRidersHandler} from './_delivery-line.js';
import {createProofCompleter, proofKey, jpegPhoto} from './_delivery-proof.js';

// Dependency injection keeps lifecycle/security tests isolated from real orders.
export function createHandler(deps = {}) {
  const d = { ...delivery, get: getJSON, permission: requirePermission, rate: requireRate, ...deps };
  let demoRouteCache, demoRouteFlight;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    if (!(await d.rate(req, res, 'delivery', 120, 300))) return;
    const b = req.method === 'GET' ? req.query || {} : req.body || {};
    if (b.action === 'proof-image') {
      if (req.method !== 'GET') return res.status(405).json({error:'GET only'});
      if (!/^[a-f0-9]{64}$/.test(b.photo || '')) return res.status(404).json({error:'Photo unavailable'});
      try {
        if (!d.ready()) throw Error('Storage unavailable');
        const proof = await d.get(proofKey(b.photo));
        if (!d.ready()) throw Error('Storage unavailable');
        const bytes = proof?.expiresAt > Date.now() && jpegPhoto(proof.photo);
        if (!bytes) return res.status(404).json({error:'Photo unavailable or expired'});
        res.setHeader('Content-Type','image/jpeg');
        res.setHeader('X-Content-Type-Options','nosniff');
        res.setHeader('X-Robots-Tag','noindex, nofollow');
        return res.status(200).send(bytes);
      } catch {return res.status(503).json({error:'Photo temporarily unavailable'});}
    }
    if (b.action === 'demo-route') {
      if (req.method !== 'GET') return res.status(405).json({error: 'GET only'});
      if (!(await d.rate(req, res, 'delivery-demo-route', 10, 300))) return;
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      // Fixed public locations only; no order, private driver token or device GPS.
      const origin = {lat: 13.7108, lng: 100.5375}, destination = {lat: 13.7463, lng: 100.5346};
      if (!demoRouteCache || Date.now() - demoRouteCache.at > (demoRouteCache.route ? 300000 : 30000)) {
        if (!demoRouteFlight) demoRouteFlight = d.routeFor(origin, destination).then(route => (demoRouteCache = {route, at: Date.now()})).catch(() => (demoRouteCache = {route: null, at: Date.now()})).finally(() => {demoRouteFlight = null;});
        await demoRouteFlight;
      }
      return res.status(200).json({origin, destination, destinationLabel: 'Siam Paragon', route: demoRouteCache.route});
    }
    if (b.action === 'setup') return createSetupHandler(deps)(req, res);
    if (b.action === 'riders') return createRidersHandler(deps)(req, res);
    const id = String(b.id || '');
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return res.status(400).json({ error: 'Invalid order reference' });
    try {
      if (!d.ready()) return res.status(503).json({ error: 'Tracking temporarily unavailable. Please retry.' });
      const staff = b.role === 'staff';
      if (staff && !d.permission(req, res, 'orders')) return;
      const record = await d.get(d.key(id));
      if (!d.ready()) throw new Error('Storage unavailable');
      if (!record || record.expiresAt <= Date.now()) return res.status(404).json({ error: 'Tracking link unavailable or expired' });
      const driver = b.role === 'driver';
      const credential = String(req.headers?.['x-delivery-token'] || '');
      if (!staff && !safeEq(credential, driver ? record.driver?.token : record.customerToken))
        return res.status(403).json({ error: 'This private tracking link is not valid' });
      if (!d.ready()) throw new Error('Storage unavailable');
      const order = await d.get('order:' + id);
      if (!order) return res.status(404).json({ error: 'Order unavailable' });
      let ended = await d.get(d.terminalKey(id));
      if (!ended && ['done', 'cancelled', 'canceled'].includes(order.status))
        ended = { status: order.status === 'done' ? 'completed' : 'cancelled', at: order.completedBy?.at || Date.now() };
      if (req.method === 'POST') {
        if (ended && !((driver && b.action === 'complete' || staff && b.action === 'resend-proof') && ended.status === 'completed')) return res.status(409).json({ error: 'This delivery has ended', status: ended.status });
        if (staff && b.action === 'resend-proof') {
          if (ended?.status !== 'completed' || !record.driver) return res.status(409).json({error:'Complete delivery with a photo first'});
          const result = await createProofCompleter(d)(id, record, undefined, ended);
          return res.status(result.code || 200).json(result);
        }
        if (staff && b.action === 'assign') {
          const name = String(b.name || '').trim(), phone = String(b.phone || '').trim().replace(/[\s()-]/g, '');
          const photo = String(b.photo || '').trim(), destination = d.point(b.destination) || record.destination;
          if (!name || name.length > 80 || !/^\+?\d{7,15}$/.test(phone) || !destination)
            return res.status(400).json({ error: 'Add driver name, valid phone number and destination coordinates' });
          if (photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo))
            return res.status(400).json({ error: 'Upload a JPEG, PNG or WebP profile picture' });
          if (photo.length > 160000) return res.status(400).json({ error: 'Profile picture is too large' });
          const previous = record.driver;
          record.driver = { name, phone, photo, token: d.token(), assignedAt: Date.now() };
          record.destination = destination;
          await d.write(d.key(id), record);
          if (previous) {await d.write(d.locationKey(id, previous.token), null, 1);await d.write(d.departureKey(id, previous.token), null, 1);}
          return res.status(200).json({ ok: true, driverUrl: '/driver-delivery.html#' + new URLSearchParams({ id, token: record.driver.token }) });
        }
        if (staff && ['complete', 'cancel'].includes(b.action)) {
          await d.endDelivery(id, b.action === 'complete' ? 'completed' : 'cancelled');
          return res.status(200).json({ ok: true });
        }
        if (!driver) return res.status(403).json({ error: 'Driver access required' });
        if (b.action === 'departure-photo') {
          if (!(await d.rate(req, res, 'delivery-photo', 12, 300))) return;
          const photo = String(b.photo || '');
          // The phone exports a resized JPEG without EXIF or embedded scripts.
          if (photo.length > 160000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))
            return res.status(400).json({error:'Choose a JPEG photo smaller than 120 KB'});
          const bytes = Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64');
          if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length-2] !== 255 || bytes[bytes.length-1] !== 217)
            return res.status(400).json({error:'The departure photo must be a valid JPEG'});
          const latest = await d.get(d.key(id));
          if (!safeEq(latest?.driver?.token, record.driver.token) || await d.get(d.terminalKey(id)))
            return res.status(409).json({error:'Assignment changed or delivery ended'});
          await d.write(d.departureKey(id, record.driver.token), {photo, at:Date.now()}, Math.max(1, Math.ceil((record.expiresAt-Date.now())/1000)));
          return res.status(200).json({ok:true});
        }
        if (b.action === 'complete') {
          const started = await d.get(d.startedKey(id, record.driver.token));
          if (!started) return res.status(409).json({ error: 'Start delivery first' });
          const result = await createProofCompleter(d)(id, record, b.photo, ended);
          return res.status(result.code || 200).json(result);
        }
        if (!['start', 'location', 'pause', 'preview-route'].includes(b.action)) return res.status(400).json({ error: 'Unknown action' });
        const lk = d.locationKey(id, record.driver.token);
        if (b.action === 'pause') { await d.write(d.pausedKey(id, record.driver.token), { at: Date.now() }); await d.write(lk, null, 1); return res.status(200).json({ ok: true }); }
        const p = d.point(b.location), capturedAt = b.location?.capturedAt;
        if (!p || typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) ||
            Math.abs(Date.now() - capturedAt) > 120000 || !Number.isFinite(b.location?.accuracy) ||
            b.location.accuracy < 0 || b.location.accuracy > 500)
          return res.status(400).json({ error: 'A fresh, accurate GPS location is required. Please try again outdoors.' });
        if (b.action === 'preview-route') {
          if (await d.get(d.startedKey(id, record.driver.token))) return res.status(409).json({error:'Delivery already started'});
          if (!(await d.rate(req, res, 'delivery-preview:'+id, 1, 90))) return;
          const route = await d.routeFor(p, record.destination);
          const latest = await d.get(d.key(id));
          if (!safeEq(latest?.driver?.token, record.driver.token) || await d.get(d.terminalKey(id)) || await d.get(d.startedKey(id, record.driver.token))) return res.status(409).json({error:'Assignment changed or delivery ended'});
          // Preview is private to the rider; never persist or start location sharing.
          return res.status(200).json({location:{...p, accuracy:b.location.accuracy, capturedAt, route}});
        }
        const started = await d.get(d.startedKey(id, record.driver.token));
        if (!started && b.action === 'start' && record.departurePhotoRequired && !(await d.get(d.departureKey(id, record.driver.token))))
          return res.status(409).json({error:'Upload your departure photo before starting delivery'});
        if (!started && b.action !== 'start') return res.status(409).json({ error: 'Start delivery first' });
        const paused = await d.get(d.pausedKey(id, record.driver.token));
        if (paused && b.action !== 'start') return res.status(409).json({ error: 'Sharing paused. Tap Start delivery to resume.' });
        if (paused && capturedAt <= paused.at) return res.status(400).json({ error: 'Wait for a new GPS fix to resume sharing' });
        const previous = await d.get(lk);
        if (previous && previous.capturedAt >= capturedAt) return res.status(200).json({ ok: true });
        if (previous && Date.now() - previous.at < 15000) return res.status(200).json({ ok: true });
        // Compute route once per driver update, not once per viewer/poll.
        const route = await d.routeFor(p, record.destination);
        // Recheck after external route request so reassignment/completion wins.
        const latest = await d.get(d.key(id));
        if (!safeEq(latest?.driver?.token, record.driver.token) || await d.get(d.terminalKey(id)))
          return res.status(409).json({ error: 'Assignment changed or delivery ended' });
        const latestPause = await d.get(d.pausedKey(id, record.driver.token));
        if (latestPause && capturedAt <= latestPause.at) return res.status(409).json({ error: 'Sharing paused. Tap Start delivery to resume.' });
        if (b.action === 'start') await d.write(d.pausedKey(id, record.driver.token), null, 1);
        await d.writeLocation(lk, { ...p, accuracy: b.location.accuracy, capturedAt, at: Date.now(), route });
        if (!started) await d.write(d.startedKey(id, record.driver.token), { at: Date.now() });
        return res.status(200).json({ ok: true });
      }
      const started = record.driver && await d.get(d.startedKey(id, record.driver.token));
      const paused = record.driver && await d.get(d.pausedKey(id, record.driver.token));
      const loc = !ended && !paused && started && await d.get(d.locationKey(id, record.driver.token));
      if (!d.ready()) throw new Error('Storage unavailable');
      const status = ended?.status || (started ? 'on_the_way' : 'preparing');
      const departure = !ended && record.driver ? await d.get(d.departureKey(id, record.driver.token)) : null;
      if (!d.ready()) throw new Error('Storage unavailable');
      const result = { departurePhoto: departure?.photo || null, departureAt: departure?.at || null, departurePhotoRequired: Boolean(record.departurePhotoRequired), orderId: id, status, completedAt: ended?.at || null,
        destination: ended ? null : record.destination, location: loc || null,
        stale: !loc || Date.now() - loc.capturedAt > 210000,
        driver: !ended && record.driver ? { name: record.driver.name, phone: record.driver.phone, photo: record.driver.photo } : null,
        reviewUrl: '', // Delivery ends without a review prompt.
        items: (order.items || []).map(i => ({ name: String(i.name || ''), qty: i.qty })), total: order.total ?? order.subtotal,
        mapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '', mapId: process.env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID' };
      if (driver || staff) {
        result.address = [order.delivery?.zone, order.delivery?.address].filter(Boolean).join(', ');
        const phone=String(order.customer?.phone || order.customer?.contact || '').trim().replace(/[\s()-]/g,'');
        result.customer = {name:String(order.customer?.name || 'Customer').slice(0,80),phone:/^\+?\d{7,15}$/.test(phone)?phone:''};
      }
      if (staff) {
        result.customerUrl = '/delivery.html#' + new URLSearchParams({ id, token: record.customerToken });
        result.driverUrl = record.driver ? '/driver-delivery.html#' + new URLSearchParams({ id, token: record.driver.token }) : '';
      }
      return res.status(200).json(result);
    } catch { return res.status(503).json({ error: 'Tracking temporarily unavailable. Please retry.' }); }
  };
}
export default createHandler();
