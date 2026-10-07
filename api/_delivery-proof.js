import crypto from 'node:crypto';
import {lineMessages} from './_line.js';
import {bump} from './_store.js';

export const PROOF_TTL = 7 * 86400;
export const proofRef = (id, generation) => crypto.createHash('sha256').update('delivery-proof:' + id + ':' + generation).digest('hex');
export const proofKey = ref => 'delivery-proof:' + ref;
export function deliveryConfirmedCard(id, order, imageUrl) {
  const text = value => String(value || '—').slice(0, 2500);
  const row = (label, value) => ({type:'box',layout:'vertical',spacing:'xs',contents:[
    {type:'text',text:label,size:'xs',color:'#65776B'},
    {type:'text',text:text(value),size:'sm',wrap:true,color:'#163024'},
  ]});
  return {type:'flex',altText:`Delivery confirmed · ${id}`,contents:{type:'bubble',
    header:{type:'box',layout:'vertical',backgroundColor:'#00B65B',paddingAll:'lg',contents:[
      {type:'text',text:'Delivery confirmed',color:'#FFFFFF',weight:'bold',size:'xl',wrap:true},
    ]},
    body:{type:'box',layout:'vertical',spacing:'md',contents:[
      row('Order',id),row('Name',order.customer?.name),
      row('Address',[order.delivery?.zone,order.delivery?.address].filter(Boolean).join(', ')),
      row('Phone number',order.customer?.phone || order.customer?.contact),
      row('Products',(order.items || []).map(i=>`${i.name} × ${i.qty}`).join('\n')),
      row('Total price',`฿${Number(order.total ?? order.subtotal ?? 0).toLocaleString('en-US')}`),
      {type:'image',url:imageUrl,size:'full',aspectRatio:'4:3',aspectMode:'fit',action:{type:'uri',label:'Open delivery photo',uri:imageUrl}},
    ]},
  }};
}
export function jpegPhoto(photo) {
  if (typeof photo !== 'string' || photo.length > 160000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) return null;
  const bytes = Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64');
  return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217 ? bytes : null;
}
export function createProofCompleter(deps) {
  const d = {claim:bump, send:lineMessages, group:()=>process.env.LINE_TO || '',
    origin:()=>process.env.VERCEL_ENV === 'preview' && /^[a-z0-9.-]+\.vercel\.app$/.test(process.env.VERCEL_URL || '') ? 'https://' + process.env.VERCEL_URL : 'https://www.dankbangkok.com', ...deps};
  return async (id, record, photo, ended) => {
    const ref = proofRef(id, record.driver.token), k = proofKey(ref);
    let proof = await d.get(k);
    if (!d.ready()) throw Error('Storage unavailable');
    if (!proof) {
      if (ended) return {error:'This delivery has ended', code:409};
      if (!jpegPhoto(photo)) return {error:'Choose a delivery JPEG photo smaller than 120 KB', code:400};
      if (await d.claim('delivery-proof-lock:' + ref, 20) !== 1) return {error:'Delivery photo is being processed. Retry in 20 seconds.', code:409};
      if (!d.ready()) throw Error('Storage unavailable');
      const latest = await d.get(d.key(id));
      if (latest?.driver?.token !== record.driver.token || await d.get(d.terminalKey(id))) return {error:'Assignment changed or delivery ended', code:409};
      proof = {photo, at:Date.now(), expiresAt:Date.now() + PROOF_TTL * 1000, notified:false};
      await d.write(k, proof, PROOF_TTL);
    }
    if (proof.expiresAt <= Date.now()) return {error:'Delivery photo expired', code:410};
    // Persist proof before ending GPS sharing. Retries keep the same photo and LINE retry key.
    if (!ended) {
      const latest = await d.get(d.key(id)), terminal = await d.get(d.terminalKey(id));
      if (!d.ready()) throw Error('Storage unavailable');
      if (latest?.driver?.token !== record.driver.token || terminal && terminal.status !== 'completed') return {error:'Assignment changed or delivery ended', code:409};
      if (!terminal) await d.endDelivery(id, 'completed');
    }
    if (!proof.notified) {
      const url = d.origin() + '/api/delivery?action=proof-image&photo=' + ref;
      const hex = crypto.createHash('sha256').update('line-proof:' + ref).digest('hex').slice(0,32);
      const retryKey = [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
      const order = await d.get('order:' + id);
      if (!d.ready() || !order) throw Error('Order unavailable');
      const sent = await d.send(d.group(), [deliveryConfirmedCard(id, order, url)], {retryKey});
      if (sent.ok) {proof.notified = true; await d.write(k, proof, Math.max(1, Math.ceil((proof.expiresAt - Date.now()) / 1000)));}
    }
    return {ok:true, notificationSent:proof.notified};
  };
}
