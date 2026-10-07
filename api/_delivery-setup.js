import crypto from 'node:crypto';
import {getJSON, storageBackend} from './_store.js';
import {getMenu} from './_menu.js';
import {listAccounts} from './_staff-accounts.js';
import {requirePermission, hasPermission} from './_auth.js';
import {RIDERS_KEY} from './_delivery-line.js';
import {write, ready, routeFor, catalogProducts, configuredProductIds, PRODUCTS_CONFIG_KEY, LIVE_MENU_SOURCES} from './_delivery.js';

export function createSetupHandler(deps={}) {
  const d={get:getJSON,menu:getMenu,accounts:listAccounts,permission:requirePermission,write,ready,routeFor,backend:storageBackend,env:process.env,fetch:globalThis.fetch,...deps};
  return async(req,res)=>{
    if(!d.permission(req,res,'staff_manage'))return;
    if(req.method!=='POST')return res.status(405).json({error:'POST only'});
    const checks=[];
    const add=(name,ok,detail)=>checks.push({name,ok,detail});
    try{
      if(!d.ready())throw new Error();
      const key='delivery:setup-probe:'+crypto.randomUUID(),value={nonce:crypto.randomUUID()};
      await d.write(key,value,30);const saved=await d.get(key);
      if(!d.ready()||saved?.nonce!==value.nonce)throw new Error();
      await d.write(key,null,1);
      add('Database',true,'Verified write and read using '+d.backend()+'.');
    }catch{add('Database',false,'Check Supabase service-role credentials or Upstash REST credentials in Vercel, then redeploy.');}
    try{
      const [menu,config]=await Promise.all([d.menu(),d.get(PRODUCTS_CONFIG_KEY)]);
      const live=new Set(catalogProducts(menu.data).map(p=>p.id));
      const count=configuredProductIds(config).filter(id=>live.has(id)).length;
      add('Delivery products',d.ready()&&LIVE_MENU_SOURCES.has(menu.source)&&count>0,count+' eligible products selected. Use Orders → Delivery products to change the selection.');
    }catch{add('Delivery products',false,'Check the live product connection and saved delivery product selection.');}
    add('Wayfinder basemap',true,'Uses MapLibre + PMTiles without a map API key. Open the demo to verify tiles, credits and light/dark mode in your browser.');
    const route=await d.routeFor({lat:13.7108,lng:100.5375},{lat:13.7463,lng:100.5346});
    add('Google Routes',Boolean(route),'A fixed public road route '+(route?'was returned.':'could not be returned. Set GOOGLE_MAPS_API_KEY with Routes API enabled and billing active, then redeploy.'));
    const env=d.env, configured=Boolean(env.LINE_CHANNEL_ACCESS_TOKEN&&env.LINE_CHANNEL_SECRET&&/^C[0-9a-f]{32}$/.test(env.LINE_TO||''));
    let lineOK=false;
    if(configured)try{const r=await d.fetch('https://api.line.me/v2/bot/info',{headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN},signal:AbortSignal.timeout(5000)});lineOK=r.ok;}catch{}
    add('LINE configuration',configured&&lineOK,'Requires a valid channel token, channel secret and staff group LINE_TO. Webhook: https://www.dankbangkok.com/api/line-webhook. Bot friendship, group membership and incoming webhook delivery must be checked in LINE. No messages were sent by this check.');
    try{
      const [rows,accounts]=await Promise.all([d.get(RIDERS_KEY),d.accounts()]);
      const registered=(rows||[]).filter(r=>/^U[0-9a-f]{32}$/.test(r.lineUserId||'')&&accounts.some(a=>a.id===r.accountId&&a.active!==false&&hasPermission(a,'orders')));
      const riders=registered.filter(r=>r.onShift&&accounts.some(a=>a.id===r.accountId&&/^\+?\d{7,15}$/.test(String(a.phone||'').replace(/[\s()-]/g,''))));
      add('LINE riders',d.ready()&&riders.length>0,riders.length+' on-shift riders and '+registered.length+' registered dispatch staff. Use Orders → LINE riders.');
    }catch{add('LINE riders',false,'Open Orders → LINE riders and register staff LINE IDs and rider shifts.');}
    return res.status(200).json({checkedAt:Date.now(),checks,ready:checks.every(c=>c.ok),phoneTestRequired:true});
  };
}
