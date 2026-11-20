import crypto from 'node:crypto';
import {runDeliveries} from '../_bo-report-delivery.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'method'});
  const secret=process.env.CRON_SECRET,given=req.headers?.authorization||'';
  const expected='Bearer '+secret;
  if(!secret||Buffer.byteLength(given)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(given),Buffer.from(expected)))return res.status(401).json({error:'unauthorized'});
  try{return res.status(200).json({results:await runDeliveries()});}
  catch(error){return res.status(503).json({error:String(error.message||error)});}
}
