import { active, configured, END, newToken, valid, prize } from './_halloween.js';
import { bump, storageBackend } from './_store.js';
import { requireSameOrigin, requirePermission } from './_auth.js';
import { requireRate } from './_ratelimit.js';

// Never accept the shared adapter's in-memory fallback for a prize claim.
async function durableCount(key, ttl) {
  if (!storageBackend()) throw new Error('storage unavailable');
  const count=await bump(key,ttl);
  if (!storageBackend()) throw new Error('storage unavailable');
  return count;
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method==='GET') return res.status(200).json({active:active(),endsAt:new Date(END).toISOString()});
  if(req.method!=='POST') {res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
  if(!requireSameOrigin(req,res)) return;
  if(!configured()) return res.status(503).json({error:'Giveaway is temporarily unavailable.'});
  if(!active()) return res.status(410).json({error:'This giveaway is closed.'});
  try {
    if(!(await requireRate(req,res,'halloween',30,300))) return;
    if(req.body?.action==='redeem') {
      if(!requirePermission(req,res,'promotions')) return;
      const token=req.body.token;
      if(!valid(token)) return res.status(400).json({error:'Invalid entry link.'});
      const count=await durableCount('halloween:redeemed:'+token,86400*14);
      if(count!==1) return res.status(409).json({error:'This prize has already been claimed.'});
      return res.status(200).json({prize:prize(token),redeemed:true});
    }
    if(req.body?.action==='result') {
      const token=req.body.token;
      if(!valid(token)) return res.status(400).json({error:'Invalid entry link.'});
      return res.status(200).json({prize:prize(token)});
    }
    if(req.body?.action!=='enter') return res.status(400).json({error:'Unknown action.'});
    const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('halloween2026='))?.slice(14);
    const token=valid(cookie)?cookie:newToken();
    // Persistent entry receipt; retries and returning browsers reuse their signed token.
    await durableCount('halloween:entry:'+token,86400*14);
    res.setHeader('Set-Cookie','halloween2026='+token+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600');
    return res.status(200).json({link:'/halloween.html#'+token});
  } catch { return res.status(503).json({error:'Giveaway is temporarily unavailable. Please try again.'}); }
}
