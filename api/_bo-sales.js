import {getJSON,indexList} from './_store.js';
import {normalizeOrder} from '../assets/backoffice-sales.js';

// Include archived IDs and read bounded batches; never silently truncate at 500.
export async function readSalesRecords(){
  const ids=[...new Set(await indexList('orders:index',{includeArchive:true}))];
  const orders=[];let missing=0;
  for(let offset=0;offset<ids.length;offset+=40){
    const batch=await Promise.all(ids.slice(offset,offset+40).map(async id=>{
      const raw=await getJSON('order:'+id);
      return raw?{...raw,id:raw.orderId??raw.id??id}:null;
    }));
    for(const raw of batch){
      const at=raw?.receipt?.at??raw?.at;
      if(raw&&at!=null&&Number.isFinite(Number(new Date(at))))orders.push({...raw,at:Number(new Date(at))});else missing++;
    }
  }
  return {orders,missing,indexed:ids.length};
}
export function salesView(records){
  const orders=records.map(normalizeOrder),first=new Map();
  for(const order of orders){if(order.customerId&&!order.cancelledAt&&order.kind==='sale')first.set(order.customerId,Math.min(first.get(order.customerId)??Infinity,order.at));}
  for(const order of orders)order.firstPurchaseAt=order.customerId?first.get(order.customerId)??null:null;
  return orders;
}
