import crypto from 'node:crypto';
export const END = Date.parse('2026-11-01T00:00:00+07:00');
export const START = Date.parse('2026-10-30T00:00:00+07:00');
export const active = (now=Date.now()) => now >= START && now < END;
const secret = () => process.env.ADMIN_SECRET || '';
export const configured = () => secret().length >= 16;
export function tokenFor(id) {
  return id + '.' + crypto.createHmac('sha256', secret()).update('halloween2026:'+id).digest('base64url');
}
export function valid(token) {
  if (!configured() || typeof token !== 'string' || !/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(tokenFor(token.split('.')[0])));
}
export function prize(token) {
  const n=crypto.createHmac('sha256',secret()).update('prize:'+token).digest().readUInt32BE(0);
  return n % 20 === 0 ? 'DANK hat' : 'Halloween candy';
}
export const newToken = () => tokenFor(crypto.randomBytes(16).toString('hex'));
