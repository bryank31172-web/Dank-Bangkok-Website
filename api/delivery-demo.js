// Isolated, expiring sample sessions. No order, GPS, photo or LINE access.
import crypto from 'node:crypto';
import {getJSON} from './_store.js';
import {ready,write} from './_delivery.js';
import {safeEq} from './_auth.js';
import {requireRate} from './_ratelimit.js';
export function createDemoHandler(deps={}) {
  const d={get:getJSON,ready,write,rate:requireRate,random:()=>crypto.randomBytes(24).toString('hex'),...deps};
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
    if(!await d.rate(req,res,'delivery-sample',120,300))return;
    const b=req.method==='GET'?req.query||{}:req.body||{};
    try{
      if(!d.ready())throw Error('Demo storage unavailable');
      if(b.action==='create'&&req.method==='POST'){
        if(!await d.rate(req,res,'delivery-sample-create',3,600))return;
        const id=d.random(),riderToken=d.random(),customerToken=d.random(),expiresAt=Date.now()+3600000;
        await d.write('delivery-sample:'+id,{riderToken,customerToken,expiresAt,index:0,status:'preparing',paused:false,photo:false,updatedAt:Date.now()},3600);
        return res.status(200).json({id,riderToken,customerToken,expiresAt});
      }
      if(!/^[a-f0-9]{48}$/.test(b.id||''))return res.status(404).json({error:'Demo link invalid or expired'});
      const k='delivery-sample:'+b.id,s=await d.get(k),role=b.role==='rider'?'rider':'customer';
      if(!s||s.expiresAt<=Date.now())return res.status(404).json({error:'Demo link expired. Create a new rider demo.'});
      if(!safeEq(req.headers?.['x-demo-token'],role==='rider'?s.riderToken:s.customerToken))return res.status(403).json({error:'Demo link invalid'});
      const terminal=await d.get(k+':ended');
      if(req.method==='POST'){
        if(role!=='rider')return res.status(403).json({error:'Customer demo is read-only'});
        if(terminal)return res.status(409).json({error:'Demo completed. Restart with a new demo.'});
        if(b.action==='photo')s.photo=true;
        else if(b.action==='start'){if(!s.photo)return res.status(400).json({error:'Share sample departure photo first'});s.status='on_the_way';s.paused=false;}
        else if(b.action==='move'){if(s.status!=='on_the_way'||s.paused)return res.status(409).json({error:'Start demo first'});s.index=Math.min(19,s.index+1);}
        else if(b.action==='pause'){s.paused=true;}
        else if(b.action==='complete'){if(b.deliveryPhoto!==true)return res.status(400).json({error:'Choose a delivery photo first'});if(s.status!=='on_the_way')return res.status(409).json({error:'Start demo first'});s.status='completed';s.photo=false;await d.write(k+':ended',{at:Date.now()},3600);}
        else return res.status(400).json({error:'Unknown demo action'});
        s.updatedAt=Date.now();await d.write(k,s,Math.max(1,Math.ceil((s.expiresAt-Date.now())/1000)));
      }
      if(!d.ready())throw Error('Demo storage unavailable');
      return res.status(200).json({index:s.index,status:terminal?'completed':s.status,paused:s.paused,photo:!terminal&&s.photo,updatedAt:s.updatedAt,expiresAt:s.expiresAt});
    }catch{return res.status(503).json({error:'Demo unavailable. Please retry.'});}
  };
}
export default createDemoHandler();

