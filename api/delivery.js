import { getJSON, indexList } from './_store.js';
import { liffId, verifyLineIdToken } from './_liff.js';
import { listAccounts } from './_staff-accounts.js';
import { lineMessages, isStaffGroupMember } from './_line.js';
import { requirePermission, safeEq, hasPermission } from './_auth.js';
import { requireRate } from './_ratelimit.js';
import * as delivery from './_delivery.js';
import {createSetupHandler} from './_delivery-setup.js';
import {createRidersHandler, riderOptions, riderLinkMessage, RIDERS_KEY, RIDER_LINK_ORIGIN} from './_delivery-line.js';
import {createProofCompleter, proofKey, jpegPhoto} from './_delivery-proof.js';

// Dependency injection keeps lifecycle/security tests isolated from real orders.
export function createHandler(deps = {}) {
  const d = { ...delivery, get: getJSON, accounts: listAccounts, send: lineMessages, verifyLine: verifyLineIdToken, groupMember: isStaffGroupMember, orderIds: () => indexList('orders:index'), permission: requirePermission, rate: requireRate, ...deps };
  const demoRoutes = new Map(), demoFlights = new Map();
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    if (!(await d.rate(req, res, 'delivery', 120, 300))) return;
    const b = req.method === 'GET' ? req.query || {} : req.body || {};
    // Staff access for the Create delivery link form. Inside LINE (LIFF) the form sends
    // a LINE ID token instead of a staff key; it is accepted only for creating links,
    // and only from a LINE user registered against an active staff account with orders access.
    const ordersAccess = async () => {
      const lineToken = String(req.headers?.['x-line-id-token'] || '');
      if (!lineToken) return d.permission(req, res, 'orders');
      const sub = await d.verifyLine(lineToken);
      if (!sub) { res.status(401).json({ error: 'LINE sign-in expired. Close and reopen the form.' }); return false; }
      // Anyone in the staff LINE group may use the form; registered LINE riders too.
      if (await d.groupMember(sub)) return true;
      const row = (await d.get(RIDERS_KEY) || []).find(r => r.lineUserId === sub);
      const account = row && (await d.accounts()).find(a => a.id === row.accountId && a.active !== false && hasPermission(a, 'orders'));
      if (account) return true;
      res.status(403).json({ error: 'Only members of the DANK staff LINE group can use this form. If you are in the group, ask the manager to check that the form and the DANK bot are under the same LINE Provider.' });
      return false;
    };
    if (b.action === 'liff-config') return res.status(200).json({ liffId: liffId() });
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
      // Only these fixed public routes are allowed; never read orders or device GPS.
      const preset = b.route || 'siam';
      if (!['siam', 'pattanakarn'].includes(preset)) return res.status(400).json({error: 'Unknown demo route'});
      const origin = preset === 'pattanakarn' ? {lat: 13.739853, lng: 100.603437} : {lat: 13.7108, lng: 100.5375};
      const destination = preset === 'pattanakarn' ? {lat: 13.7216546, lng: 100.7152376} : {lat: 13.7463, lng: 100.5346};
      let cached = demoRoutes.get(preset);
      if (!cached || Date.now() - cached.at > (cached.route ? 300000 : 30000)) {
        if (!demoFlights.has(preset)) demoFlights.set(preset, d.routeFor(origin, destination)
          .then(route => demoRoutes.set(preset, {route, at: Date.now()}))
          .catch(() => demoRoutes.set(preset, {route: null, at: Date.now()}))
          .finally(() => demoFlights.delete(preset)));
        await demoFlights.get(preset);cached = demoRoutes.get(preset);
      }
      return res.status(200).json({origin, destination,
        ...(preset === 'pattanakarn' ? {originLabel: 'DANK Pattanakarn · 223 Phatthanakan Rd, Suan Luang, Bangkok 10250'} : {}),
        destinationLabel: preset === 'pattanakarn' ? 'Lumpini Ville On Nut–Latkrabang' : 'Siam Paragon', route: cached.route});
    }
    if (b.action === 'setup') return createSetupHandler(deps)(req, res);
    if (b.action === 'riders') return createRidersHandler(deps)(req, res);
    if (b.action === 'rider-options') {
      // Rider picker for Create delivery link. Orders permission, like assigning.
      if (!(await ordersAccess())) return;
      try {
        if (!d.ready()) throw new Error('Storage unavailable');
        const riders = riderOptions(await d.accounts(), await d.get(RIDERS_KEY));
        return res.status(200).json({ riders: riders.map(({lineUserId, ...r}) => ({...r, line: Boolean(lineUserId)})) });
      } catch { return res.status(503).json({ error: 'Rider list unavailable. Please retry.' }); }
    }
    if (b.action === 'pending') {
      // Recent delivery orders still open, for the Create delivery link form.
      if (!(await ordersAccess())) return;
      try {
        if (!d.ready()) throw new Error('Storage unavailable');
        const want = /^[A-Za-z0-9_-]{3,80}$/.test(String(b.id || '')) ? String(b.id) : '';
        const ids = [...new Set([want, ...(await d.orderIds() || []).slice(0, 60)].filter(Boolean))];
        const orders = [];
        for (const oid of ids) {
          const o = await d.get('order:' + oid);
          if (!o || o.fulfilment !== 'delivery' || ['done', 'cancelled', 'canceled'].includes(o.status) || await d.get(d.terminalKey(oid))) continue;
          const t = await d.get(d.key(oid));
          orders.push({ orderId: oid, at: o.at || null, customer: String(o.customer?.name || ''), address: [o.delivery?.zone, o.delivery?.address].filter(Boolean).join(', '),
            coordinates: d.point(o.delivery?.coordinates), items: (o.items || []).map(i => ({ name: String(i.name || ''), qty: i.qty })), total: o.total ?? o.subtotal ?? 0,
            tracking: Boolean(t && t.expiresAt > Date.now()), rider: t && t.expiresAt > Date.now() && t.driver ? t.driver.name : '' });
          if (orders.length >= 20) break;
        }
        return res.status(200).json({ orders });
      } catch { return res.status(503).json({ error: 'Orders unavailable. Please retry.' }); }
    }
    const id = String(b.id || '');
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return res.status(400).json({ error: 'Invalid order reference' });
    try {
      if (!d.ready()) return res.status(503).json({ error: 'Tracking temporarily unavailable. Please retry.' });
      const staff = b.role === 'staff';
      if (staff && !(b.action === 'create' && req.method === 'POST' ? await ordersAccess() : d.permission(req, res, 'orders'))) return;
      if (b.action === 'create') {
        // Staff create tracking for an order that has none (setup failed at checkout,
        // or its products were approved afterwards), optionally with a confirmed
        // destination and a rider in the same step. The same eligibility rules as
        // checkout apply; this never widens which orders can be tracked.
        if (!staff) return res.status(403).json({ error: 'Staff access required' });
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
        const order = await d.get('order:' + id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.fulfilment !== 'delivery') return res.status(409).json({ error: 'Tracking links are only for delivery orders' });
        if (['done', 'cancelled', 'canceled'].includes(order.status) || await d.get(d.terminalKey(id)))
          return res.status(409).json({ error: 'This order has already ended' });
        const place = String(b.place || '').trim().slice(0, 200);
        const note = String(b.note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (b.destination != null && !d.point(b.destination)) return res.status(400).json({ error: 'Choose the destination from the suggestions' });
        let rider = null;
        if (b.riderId) {
          rider = riderOptions(await d.accounts(), await d.get(RIDERS_KEY)).find(r => r.id === String(b.riderId));
          if (!rider) return res.status(400).json({ error: 'Choose a rider from the list. Riders need orders access and a phone number.' });
        }
        let record = await d.get(d.key(id)), created = false;
        if (!record || record.expiresAt <= Date.now()) {
          const destination = d.point(b.destination) || d.point(order.delivery?.coordinates);
          const made = await d.createDelivery({ ...order, orderId: id, delivery: { ...order.delivery, coordinates: destination } }, { byStaff: true });
          if (!made) return res.status(503).json({ error: 'Could not create the tracking link. Please retry.' });
          record = await d.get(d.key(id)); created = true;
          if (!record) throw new Error('Storage unavailable');
        }
        // The customer link only exists once a rider has been assigned.
        let customerUrl = d.customerPath(id, record.customerToken);
        if (!rider) return res.status(200).json({ ok: true, created, customerUrl });
        const destination = d.point(b.destination) || record.destination;
        if (!destination) return res.status(400).json({ error: 'Choose the delivery destination before assigning a rider', created, customerUrl });
        const previous = record.driver;
        record.destination = destination;
        if (place) record.place = place;
        if (note || b.note === '') record.note = note;
        record.driver = { name: rider.name, phone: rider.phone, photo: '', token: d.token(), assignedAt: Date.now(), accountId: rider.id, assignedVia: 'staff' };
        await d.write(d.key(id), record);
        if (previous) { await d.write(d.locationKey(id, previous.token), null, 1); if (d.departureKey) await d.write(d.departureKey(id, previous.token), null, 1); }
        const driverUrl = '/driver-delivery.html#' + new URLSearchParams({ id, token: record.driver.token });
        customerUrl = await d.issueCustomerLink(id, { get: d.get, write: d.write, token: d.token });
        // Best effort: the link is also shown to staff to copy, so a failed LINE send loses nothing.
        let lineSent = false;
        if (rider.lineUserId) {
          try { lineSent = Boolean((await d.send(rider.lineUserId, [{ type: 'text', text: riderLinkMessage(id, record.place || order.delivery?.address, RIDER_LINK_ORIGIN + driverUrl, record.note) }])).ok); } catch {}
        }
        return res.status(200).json({ ok: true, created, customerUrl, driverUrl, rider: { name: rider.name, phone: rider.phone }, lineSent, lineRegistered: Boolean(rider.lineUserId) });
      }
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
        result.address = record.place || [order.delivery?.zone, order.delivery?.address].filter(Boolean).join(', ');
        if (record.note) result.note = record.note;
        const phone=String(order.customer?.phone || order.customer?.contact || '').trim().replace(/[\s()-]/g,'');
        result.customer = {name:String(order.customer?.name || 'Customer').slice(0,80),phone:/^\+?\d{7,15}$/.test(phone)?phone:''};
      }
      if (staff) {
        result.customerUrl = d.customerPath(id, record.customerToken);
        result.driverUrl = record.driver ? '/driver-delivery.html#' + new URLSearchParams({ id, token: record.driver.token }) : '';
      }
      return res.status(200).json(result);
    } catch { return res.status(503).json({ error: 'Tracking temporarily unavailable. Please retry.' }); }
  };
}
export default createHandler();
