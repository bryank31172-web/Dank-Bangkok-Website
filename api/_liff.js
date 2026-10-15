/* LINE in-app form (LIFF) for staff. The page sends the LINE ID token it gets from
   liff.getIDToken(); LINE verifies it here and returns the staff member's LINE user
   ID, which must be registered in Staff portal → Orders → LINE riders. */
export const liffId = () => process.env.LINE_LIFF_ID || '';
export const liffUrl = orderId => liffId()
  ? 'https://liff.line.me/' + encodeURIComponent(liffId()) + (orderId ? '?' + new URLSearchParams({order: orderId}) : '')
  : '';

const cache = new Map();
export async function verifyLineIdToken(idToken) {
  const channel = process.env.LINE_LOGIN_CHANNEL_ID || '';
  if (!channel || typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) return null;
  const hit = cache.get(idToken);
  if (hit && hit.until > Date.now()) return hit.sub;
  try {
    const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({id_token: idToken, client_id: channel}),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const sub = /^U[0-9a-f]{32}$/.test(j.sub || '') ? j.sub : null;
    const until = Math.min(Number(j.exp) * 1000 || 0, Date.now() + 5 * 60000);
    if (sub && until > Date.now()) {
      if (cache.size > 500) cache.clear();
      cache.set(idToken, {sub, until});
    }
    return sub;
  } catch { return null; }
}

