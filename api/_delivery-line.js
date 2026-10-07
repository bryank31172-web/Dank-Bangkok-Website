import crypto from 'node:crypto';
import {getJSON, bump} from './_store.js';
import {listAccounts} from './_staff-accounts.js';
import {hasPermission, requirePermission} from './_auth.js';
import {lineMessages} from './_line.js';
import * as delivery from './_delivery.js';

export const RIDERS_KEY = 'delivery:line-riders:v1';
const ORIGIN = 'https://www.dankbangkok.com';
const uid = value => /^U[0-9a-f]{32}$/.test(value || '');
const postback = (action, id, rider = '', page = 0) => new URLSearchParams({delivery: action, id, rider, page}).toString();
export function deliveryOrderCard(order, customerUrl) {
  return {type: 'flex', altText: `Delivery ${order.orderId}: track delivery or choose rider`, contents: {
    type: 'bubble', body: {type: 'box', layout: 'vertical', spacing: 'md', contents: [
      {type: 'text', text: 'NEW DELIVERY', weight: 'bold', color: '#008F4B'},
      {type: 'text', text: String(order.orderId), weight: 'bold', size: 'xl'},
      {type: 'text', text: `${(order.items || []).map(i => `${i.name} × ${i.qty}`).join('\n')}\nTotal: ฿${order.total ?? order.subtotal ?? 0}`.slice(0, 3000), wrap: true},
      {type: 'text', text: 'Choose the rider for this order. Their private controls are sent directly to them.', wrap: true, size: 'sm'},
    ]}, footer: {type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      {type: 'button', style: 'primary', color: '#008F4B', action: {type: 'uri', label: 'Check your delivery', uri: ORIGIN + customerUrl}},
      {type: 'button', action: {type: 'postback', label: 'Choose rider', data: postback('choose', order.orderId)}},
    ]}}};
}

export function createRidersHandler(deps = {}) {
  const d = {get: getJSON, accounts: listAccounts, permission: requirePermission, ...delivery, ...deps};
  return async (req, res) => {
    if (!d.permission(req, res, 'staff_manage')) return;
    try {
      if (!d.ready()) throw new Error('Rider settings require connected storage');
      const accounts = (await d.accounts()).filter(a => a.active !== false && hasPermission(a, 'orders'));
      const valid = new Set(accounts.map(a => a.id));
      if (req.method === 'POST') {
        const rows = req.body?.riders;
        if (!Array.isArray(rows) || rows.length > 100 || rows.some(r => !valid.has(r.accountId) || !uid(r.lineUserId) || typeof r.onShift !== 'boolean') ||
            new Set(rows.map(r => r.accountId)).size !== rows.length || new Set(rows.map(r => r.lineUserId)).size !== rows.length)
          return res.status(400).json({error: 'Use active staff accounts, unique LINE user IDs and an on-shift setting'});
        await d.write(RIDERS_KEY, rows.map(({accountId, lineUserId, onShift}) => ({accountId, lineUserId, onShift})), 365 * 86400);
        return res.status(200).json({ok: true});
      }
      const riders = await d.get(RIDERS_KEY) || [];
      if (!d.ready()) throw new Error('Storage unavailable');
      return res.status(200).json({accounts: accounts.map(a => ({id: a.id, name: a.name, phone: a.phone || '', role: a.role})), riders});
    } catch { return res.status(503).json({error: 'Rider settings unavailable. Retry after storage recovers.'}); }
  };
}

// Only invoked after the webhook verifies LINE's signature. Rider controls are
// shared with the configured staff group and assigned rider. An atomic claim prevents double assignment.
export function createDeliveryLineHandler(deps = {}) {
  const d = {get: getJSON, accounts: listAccounts, claim: bump, send: lineMessages, group: () => process.env.LINE_TO || '', uuid: () => crypto.randomUUID(), ...delivery, ...deps};
  return async ev => {
    if (ev.type === 'message' && ev.source?.type === 'user' && /^rider id$/i.test(ev.message?.text?.trim() || '')) {
      await d.send(ev.replyToken, [{type: 'text', text: 'Your LINE user ID: ' + ev.source.userId + '\nGive this to the shop manager for LINE riders setup.'}], {reply: true});
      return true;
    }
    if (ev.type !== 'postback') return false;
    const p = new URLSearchParams(ev.postback?.data || '');
    if (!p.has('delivery')) return false;
    const reply = text => d.send(ev.replyToken, [{type: 'text', text}], {reply: true});
    if (ev.source?.type !== 'group' || !d.group() || ev.source.groupId !== d.group()) {await reply('Use the shop staff LINE group to choose a rider.'); return true;}
    try {
      if (!d.ready()) throw new Error('Delivery storage unavailable. Use the staff portal.');
      const rows = await d.get(RIDERS_KEY) || [], accounts = await d.accounts();
      const actorRow = rows.find(r => r.lineUserId === ev.source.userId);
      const actor = accounts.find(a => a.id === actorRow?.accountId && a.active !== false);
      if (!hasPermission(actor, 'orders')) throw new Error('Ask the manager to register your LINE user ID in Staff portal → Orders → LINE riders.');
      const id = p.get('id');
      if (!/^[A-Za-z0-9_-]{3,80}$/.test(id || '')) throw new Error('Invalid delivery reference');
      let record = await d.get(d.key(id));
      const order = await d.get('order:' + id);
      const ended = async () => Boolean(await d.get(d.terminalKey(id))) || ['done', 'cancelled', 'canceled'].includes((await d.get('order:' + id))?.status);
      if (!d.ready() || !record || record.expiresAt <= Date.now() || !order) throw new Error('Delivery unavailable or expired');
      if (await ended()) throw new Error('This delivery has ended.');
      const available = rows.flatMap(r => {
        const a = accounts.find(a => a.id === r.accountId && a.active !== false && hasPermission(a, 'orders'));
        return a && r.onShift && uid(r.lineUserId) && /^\+?\d{7,15}$/.test(String(a.phone || '').replace(/[\s()-]/g, '')) ? [{...r, name: a.name, phone: a.phone.replace(/[\s()-]/g, '')}] : [];
      });
      if (p.get('delivery') === 'choose') {
        if (record.driver && record.driver.assignedVia !== 'line') throw new Error('A rider is already assigned. Manage reassignment in the staff portal.');
        if (!available.length) throw new Error('No rider on shift is configured. Add a valid phone and LINE user ID, then turn on Rider on shift in the staff portal.');
        const selectable = record.driver ? available.filter(r => r.accountId === record.driver.accountId) : available;
        const page = Math.max(0, Math.min(8, Number(p.get('page')) || 0)), slice = selectable.slice(page * 12, page * 12 + 12);
        const items = slice.map(r => ({type: 'action', action: {type: 'postback', label: r.name.slice(0, 20), data: postback('assign', id, r.accountId)}}));
        if (selectable.length > page * 12 + 12) items.push({type: 'action', action: {type: 'postback', label: 'More riders', data: postback('choose', id, '', page + 1)}});
        if (!items.length) throw new Error('Rider list changed. Tap Choose rider again.');
        await d.send(ev.replyToken, [{type: 'text', text: (record.driver ? 'Tap the assigned rider to resend their private link for ' : 'Choose the on-shift rider for ') + id, quickReply: {items}}], {reply: true});
        return true;
      }
      if (p.get('delivery') !== 'assign') throw new Error('Unknown delivery action');
      const rider = available.find(r => r.accountId === p.get('rider'));
      if (!rider) throw new Error('This rider is unavailable or off shift. Choose again.');
      if (!record.destination) throw new Error('Confirm destination coordinates in the staff portal first.');
      if (record.driver && (record.driver.accountId !== rider.accountId || record.driver.assignedVia !== 'line')) throw new Error('A different rider is assigned. Manage reassignment in the staff portal.');
      if (!record.driver) {
        const n = await d.claim('delivery:line-assignment:' + id, 14 * 86400);
        if (!d.ready()) throw new Error('Storage unavailable');
        if (n !== 1) throw new Error('Assignment is being processed. Retry in a moment or use the staff portal.');
        record = await d.get(d.key(id));
        if (record.driver || await ended()) throw new Error('Assignment changed or delivery ended.');
        record.driver = {name: rider.name, phone: rider.phone, photo: '', token: d.token(), assignedAt: Date.now(), accountId: rider.accountId, assignedVia: 'line', retryKey: d.uuid()};
        await d.write(d.key(id), record);
      }
      if (!d.ready() || await ended()) throw new Error('Delivery unavailable or ended.');
      const latest = await d.get(d.key(id));
      if (latest?.driver?.token !== record.driver.token) throw new Error('Rider assignment changed. Use the staff portal.');
      const url = ORIGIN + '/driver-delivery.html#' + new URLSearchParams({id, token: record.driver.token});
      const sent = await d.send(rider.lineUserId, [{type: 'text', text: `Delivery ${id}\n${order.delivery?.address || ''}\nOpen your rider controls:\n${url}\nTake a picture to start delivery, then tap Delivered when complete. Open in Safari/Chrome, allow GPS and keep the page open and phone awake.`}], {retryKey: record.driver.retryKey});
      const confirmation = sent.ok
        ? `Assigned ${id} to ${rider.name}. LINE accepted the direct message to their personal chat.`
        : `Assigned ${id} to ${rider.name}, but LINE could not accept the direct message. Ask the rider to add the shop LINE Official Account as a friend, then tap their rider selection again to retry.`;
      await reply(`${confirmation}\nRider delivery link:\n${url}`);
      return true;
    } catch (e) {await reply(e.message || 'Delivery assignment unavailable. Use the staff portal.'); return true;}
  };
}
