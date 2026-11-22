// Shared, deterministic reporting rules for the browser and server.
export const ZONE='Asia/Bangkok';
export const ORDER_GROUPS=['channel','payment','shift','promotion'];
export const BREAKDOWN_GROUPS=['product','category','sku',...ORDER_GROUPS];
const OFFSET=7*3600000, DAY=86400000;
export const round=value=>Math.round((Number(value)||0)*100)/100;
const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
export function dateKey(value){return new Date(Number(new Date(value))+OFFSET).toISOString().slice(0,10);}
export function dayStart(value){return new Date(dateKey(value)+'T00:00:00+07:00');}
export function dateBounds(from,to){
  const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&dateKey(new Date(s+'T00:00:00+07:00'))===s;
  if(!valid(from)||!valid(to)||from>to)throw Error('ช่วงวันที่ไม่ถูกต้อง');
  return {start:new Date(from+'T00:00:00+07:00').toISOString(),end:new Date(+new Date(to+'T00:00:00+07:00')+DAY).toISOString()};
}
export function presetWindow(preset='month',now=Date.now()){
  const end=new Date(now),start=dayStart(end),d=new Date(+start+OFFSET);
  if(preset==='yesterday')return {start:new Date(+start-DAY).toISOString(),end:start.toISOString()};
  if(preset==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  if(preset==='month')d.setUTCDate(1);
  if(preset==='year')d.setUTCMonth(0,1);
  return {start:new Date(+d-OFFSET).toISOString(),end:end.toISOString()};
}
export function previousWindow(window,preset){
  const start=new Date(window.start),end=new Date(window.end);
  if(preset==='today'||preset==='yesterday'||preset==='week'){
    const shift=(preset==='week'?7:1)*DAY;
    return {start:new Date(+start-shift).toISOString(),end:new Date(+end-shift).toISOString()};
  }
  if(preset==='month'||preset==='year'){
    const shift=value=>{
      const d=new Date(+value+OFFSET),day=d.getUTCDate();d.setUTCDate(1);
      if(preset==='month')d.setUTCMonth(d.getUTCMonth()-1);else d.setUTCFullYear(d.getUTCFullYear()-1);
      const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
      if(preset==='month'&&day>max)return start.toISOString();
      d.setUTCDate(Math.min(day,max));return new Date(+d-OFFSET).toISOString();
    };
    return {start:shift(start),end:shift(end)};
  }
  return {start:new Date(+start-(end-start)).toISOString(),end:start.toISOString()};
}
export function normalizeOrder(raw){
  const receipt=raw.receipt||{},get=key=>receipt[key]??raw[key];
  const items=(get('items')||[]).map(item=>({
    ...item,name:String(item.name||''),quantity:number(item.quantity??item.qty)??1,
    productKey:String(item.productKey??item.product_key??item.productId??''),
    sku:String(item.sku??item.SKU??''),category:typeof item.category==='string'?item.category:'',
    unitPrice:number(item.unitPrice??item.price),subtotal:number(item.subtotal??item.lineTotal),
    discount:number(item.discount),tax:number(item.tax),
  }));
  if(!items.length&&raw.product)items.push({name:String(raw.product),productKey:String(raw.productKey??''),sku:String(raw.sku??''),category:String(raw.category??''),quantity:number(raw.qty)??1,subtotal:number(raw.subtotal),discount:number(raw.discount),tax:number(raw.tax)});
  const payments=(get('payments')||[]).map(p=>({...p,method:String(p.method||'ไม่ระบุ')}));
  // A recorded tender label can be filtered without inventing a payment amount.
  const tender=raw.paymentMethod??raw.payment;
  const paymentMethods=[...new Set([...payments.map(p=>p.method),...(typeof tender==='string'&&tender?[tender]:[])])];
  const kind=['return','refund'].includes(String(raw.type||raw.kind).toLowerCase())?'return':'sale';
  const amount=value=>value===null?null:kind==='return'?Math.abs(value):value;
  const tax=amount(number(get('tax'))),discount=amount(number(get('discount')))??0;
  const charges=amount(round((number(raw.deliveryFee)??0)+(number(raw.serviceCharge)??0)));
  const total=amount(number(get('total'))??round((number(get('subtotal'))??0)-discount+charges));
  const net=tax===null?null:round(total-tax-charges);
  const storedCost=amount(number(raw.cost??raw.costAtSale));
  const itemCosts=items.map(i=>number(i.lineCost)??(number(i.unitCost??i.costAtSale)===null?null:round(Number(i.unitCost??i.costAtSale)*i.quantity)));
  const cost=storedCost??(items.length&&itemCosts.every(v=>v!==null)?round(itemCosts.reduce((a,b)=>a+b,0)):null);
  const customer=raw.customer;
  const customerId=raw.customerId??raw.memberId??(typeof customer==='object'?(customer?.id??customer?.phone):null)??raw.phone??null;
  return {
    id:String(get('id')??raw.orderId??raw.id??''),at:Number(new Date(get('at'))),kind,
    cancelledAt:raw.cancelledAt||(raw.status==='cancelled'?Number(new Date(raw.updatedAt??raw.at)):null),
    status:raw.status,storeId:String(raw.storeId??raw.store_id??''),branch:String(get('branch')??raw.storeName??raw.storeId??'ไม่ระบุสาขา'),
    employee:String(get('employee')??raw.staffName??raw.staffId??'ไม่ระบุ'),
    channel:String(raw.channel??raw.source??'website'),
    orderType:String(get('orderType')??({delivery:'เดลิเวอรี่',table:'ทานที่ร้าน',pickup:'ซื้อกลับบ้าน'}[raw.fulfilment])??'ไม่ระบุ'),
    customer:typeof customer==='object'?String(customer?.name??'ไม่ระบุ'):String(customer??raw.name??'ไม่ระบุ'),
    customerId:customerId===null?null:String(customerId),firstPurchaseAt:raw.firstPurchaseAt??null,
    product:items.map(i=>i.name).join(', '),qty:items.reduce((sum,i)=>sum+i.quantity,0),items,payments,paymentMethods,
    subtotal:net===null?number(get('subtotal')):round(net+discount),discount,manualDiscount:number(raw.manualDiscount),tax,charges,total,net,
    deliveryFee:amount(number(raw.deliveryFee))??0,serviceCharge:amount(number(raw.serviceCharge))??0,
    rounding:number(raw.rounding??raw.roundingAdjustment),
    gross:net===null?null:round(net+discount),cost,profit:cost===null||net===null?null:round(net-cost),
    shift:String(raw.shiftName??raw.shiftId??'ไม่ระบุกะทำงาน'),
    shiftId:raw.shiftId==null?null:String(raw.shiftId),
    shiftStartedAt:raw.shiftStartedAt??null,shiftEndedAt:raw.shiftEndedAt??null,
    preorderDeposit:number(raw.preorderDeposit),
    promotion:String(raw.promotionName??raw.promoCode??(typeof raw.promo==='string'?raw.promo:null)??'ไม่ระบุโปรโมชั่น'),
    posNumber:get('posNumber')??null,activity:get('activity')??[],
  };
}
export function matches(order,scope={}){
  let categories=scope.categories;
  if(typeof categories==='string'&&categories){try{categories=JSON.parse(categories);}catch{return false;}}
  let branches=scope.branches;
  if(typeof branches==='string'&&branches){try{branches=JSON.parse(branches);}catch{return false;}}
  return (!scope.start||order.at>=+new Date(scope.start))&&(!scope.end||order.at<+new Date(scope.end))&&
    (!Array.isArray(categories)||order.items.some(item=>categories.includes(item.category||'ไม่มีประเภทสินค้า')))&&
    (!Array.isArray(branches)||branches.includes(order.branch))&&
    (!scope.receipt||String(order.id).toLowerCase().includes(String(scope.receipt).toLowerCase()))&&
    (!scope.store||scope.store==='all'||order.storeId===scope.store||order.branch===scope.store)&&
    (!scope.channel||order.channel===scope.channel)&&(!scope.orderType||order.orderType===scope.orderType)&&
    (!scope.employee||order.employee===scope.employee)&&(!scope.payment||order.paymentMethods?.includes(scope.payment)||order.payments?.some(p=>p.method===scope.payment))&&
    (!scope.product||order.items.some(i=>i.name===scope.product))&&
    (!scope.itemGroup||orderMatchesItemGroup(order,scope.itemGroup,scope.itemKey));
}
function itemGroup(item,group){
  const name=String(item.name||'').trim();
  const id=String(item.productKey??item.product_key??item.productId??'').trim();
  const value=group==='product'?(id||name):String(item[group]??'').trim();
  const missing=!value;
  return {
    key:JSON.stringify([group,value||null]),missing,
    label:missing?({product:'ไม่ระบุสินค้า',category:'ไม่มีหมวดหมู่',sku:'ไม่ระบุ SKU'})[group]:group==='product'?(name||id):value
  };
}
const itemWeight=item=>Math.abs(number(item.subtotal)??number(item.total)??((number(item.unitPrice)!==null)?item.unitPrice*item.quantity:0));
function orderMatchesItemGroup(order,group,key){
  if(group==='shift')return shiftReportKey(order)===key;
  if(group==='payment'){
    try{const [,method,channel]=JSON.parse(key);return (order.paymentMethods.length?order.paymentMethods:['ไม่ระบุวิธีชำระเงิน']).includes(method)&&(!channel||channel===order.channel);}catch{return false;}
  }
  if(ORDER_GROUPS.includes(group))return JSON.stringify([group,orderGroupLabel(order,group)])===key;
  if(!BREAKDOWN_GROUPS.includes(group))return false;
  if(key===JSON.stringify(['unallocated',group]))
    return !order.items.some(item=>itemWeight(item)>0)&&['gross','discount','net','tax','charges','total','cost'].some(field=>Number(order[field])!==0&&order[field]!==null);
  const items=order.items.length?order.items:[{name:''}];
  return items.some(item=>itemGroup(item,group).key===key);
}
export function bucketWindow(value,group='day'){
  const date=new Date(Number(value)+OFFSET);
  date.setUTCMinutes(0,0,0);
  if(group!=='hour')date.setUTCHours(0);
  if(group==='week')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  if(group==='month')date.setUTCDate(1);
  if(group==='year')date.setUTCMonth(0,1);
  const start=new Date(+date-OFFSET);
  if(group==='hour')date.setUTCHours(date.getUTCHours()+1);
  else if(group==='week')date.setUTCDate(date.getUTCDate()+7);
  else if(group==='month')date.setUTCMonth(date.getUTCMonth()+1);
  else if(group==='year')date.setUTCFullYear(date.getUTCFullYear()+1);
  else date.setUTCDate(date.getUTCDate()+1);
  return {start:start.toISOString(),end:new Date(+date-OFFSET).toISOString()};
}
export function summarize(orders){
  const live=orders.filter(o=>!o.cancelledAt),sales=live.filter(o=>o.kind!=='return'),returns=live.filter(o=>o.kind==='return');
  const sum=(list,key)=>round(list.reduce((total,o)=>total+Math.round((o[key]??0)*100),0)/100);
  const complete=key=>live.every(o=>o[key]!==null);
  const customers=new Set(sales.map(o=>o.customerId).filter(Boolean));
  const net=complete('net')?round(sum(sales,'net')-sum(returns,'net')):null;
  const cost=complete('cost')?round(sum(sales,'cost')-sum(returns,'cost')):null;
  return {
    transactions:live.length,
    deliveryFee:round(sum(sales,'deliveryFee')-sum(returns,'deliveryFee')),
    serviceCharge:round(sum(sales,'serviceCharge')-sum(returns,'serviceCharge')),
    rounding:live.every(o=>o.rounding!=null)?round(sum(sales,'rounding')-sum(returns,'rounding')):null,
    manualDiscount:sales.every(o=>!o.discount||o.manualDiscount!=null)?sum(sales,'manualDiscount'):null,
    discountPct:complete('gross')&&sum(sales,'gross')?round(sum(sales,'discount')/sum(sales,'gross')*100):sales.length?null:0,
    manualDiscountPct:sales.every(o=>!o.discount||o.manualDiscount!=null)?(sum(sales,'gross')?round(sum(sales,'manualDiscount')/sum(sales,'gross')*100):0):null,
    orders:sales.length,gross:complete('gross')?sum(sales,'gross'):null,discount:sum(sales,'discount'),
    returns:sum(returns,'total'),net,tax:complete('tax')?round(sum(sales,'tax')-sum(returns,'tax')):null,
    charges:round(sum(sales,'charges')-sum(returns,'charges')),total:round(sum(sales,'total')-sum(returns,'total')),
    cost,profit:cost===null||net===null?null:round(net-cost),margin:cost===null||!net?null:round((net-cost)/net*100),
    average:net===null?null:sales.length?round(net/sales.length):0,
    customers:customers.size,anonymousOrders:sales.filter(o=>!o.customerId).length,
    cancelled:orders.filter(o=>o.cancelledAt).length,
    items:sales.reduce((sum,o)=>sum+o.qty,0),costedOrders:sales.filter(o=>o.cost!==null).length,
  };
}
export function buildReport(orders,scope,group='day'){
  if(group==='shift')return buildShiftReport(orders,scope);
  if(group==='payment')return buildPaymentReport(orders,scope);
  if(ORDER_GROUPS.includes(group)){
    const selected=orders.filter(order=>matches(order,scope)),groups=new Map();
    for(const order of selected){
      if(order.cancelledAt)continue;
      const label=orderGroupLabel(order,group);
      if(!groups.has(label))groups.set(label,[]);
      groups.get(label).push(order);
    }
    return {rows:[...groups].map(([label,rows])=>({key:JSON.stringify([group,label]),label,orderIds:rows.map(o=>o.id),...summarize(rows)})).sort((a,b)=>(b.total||0)-(a.total||0)),totals:summarize(selected),orders:selected,group};
  }
  if(BREAKDOWN_GROUPS.includes(group))return buildItemReport(orders,scope,group);
  const selected=orders.filter(o=>matches(o,scope)),buckets=[];
  let cursor=+new Date(scope.start),end=+new Date(scope.end);
  while(cursor<end){
    if(buckets.length>=10000)throw Error('ช่วงเวลามีมากกว่า 10,000 กลุ่ม กรุณาเลือกการจัดกลุ่มที่ใหญ่ขึ้น');
    const bucket=bucketWindow(cursor,group);
    const from=Math.max(cursor,+new Date(bucket.start)),to=Math.min(end,+new Date(bucket.end));
    const rows=selected.filter(o=>o.at>=from&&o.at<to);
    buckets.push({start:new Date(from).toISOString(),end:new Date(to).toISOString(),...summarize(rows)});
    cursor=to;
  }
  return {rows:buckets,totals:summarize(selected),orders:selected};
}

function orderGroupLabel(order,group){
  if(group==='payment')return [...new Set(order.paymentMethods||[])].sort().join(' + ')||'ไม่ระบุวิธีชำระเงิน';
  return order[group]||'ไม่ระบุ';
}

function shiftReportKey(order){
  return JSON.stringify(['shift',order.shiftId||`receipt:${order.id}`,order.storeId,order.posNumber]);
}
function buildShiftReport(orders,scope){
  const selected=orders.filter(order=>matches(order,scope)),groups=new Map();
  for(const order of selected){
    if(order.cancelledAt)continue;
    const key=shiftReportKey(order);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(order);
  }
  const deposit=rows=>rows.every(o=>o.preorderDeposit!=null)?round(rows.reduce((sum,o)=>sum+(o.kind==='return'?-1:1)*o.preorderDeposit,0)):null;
  const rows=[...groups].map(([key,receipts])=>{
    const unique=field=>{const values=[...new Set(receipts.map(o=>o[field]).filter(Boolean))];return values.length===1?values[0]:null;};
    return {key,label:unique('shiftStartedAt')||'ไม่ระบุเวลาเข้ากะ',shiftStartedAt:unique('shiftStartedAt'),shiftEndedAt:unique('shiftEndedAt'),branch:unique('branch'),posNumber:unique('posNumber'),...summarize(receipts),deposits:deposit(receipts),orderIds:receipts.map(o=>o.id)};
  });
  return {rows,orders:selected,group:'shift',totals:{...summarize(selected),deposits:deposit(selected.filter(o=>!o.cancelledAt))}};
}

function buildPaymentReport(orders,scope){
  const selected=orders.filter(order=>matches(order,scope)),groups=new Map();
  for(const order of selected){
    if(order.cancelledAt)continue;
    const methods=order.paymentMethods.length?order.paymentMethods:['ไม่ระบุวิธีชำระเงิน'];
    const amounts=methods.map(method=>{
      if(methods.length===1)return Math.abs(order.total);
      const payments=order.payments.filter(p=>p.method===method);
      return payments.length&&payments.every(p=>number(p.amount)!==null)?round(payments.reduce((sum,p)=>sum+Math.abs(Number(p.amount)),0)):null;
    });
    const complete=amounts.every(value=>value!==null)&&Math.round(amounts.reduce((a,b)=>a+b,0)*100)===Math.round(Math.abs(order.total)*100);
    methods.forEach((method,index)=>{
      const key=JSON.stringify(['payment',method,order.channel]);
      if(!groups.has(key))groups.set(key,{key,label:method,channel:order.channel,orders:[],charged:0,refunded:0,complete:true});
      const row=groups.get(key);row.orders.push(order);
      if(!complete)row.complete=false;
      else if(order.kind==='return')row.refunded=round(row.refunded+amounts[index]);
      else row.charged=round(row.charged+amounts[index]);
    });
  }
  const rows=[...groups.values()].map(row=>({...summarize(row.orders),key:row.key,label:row.label,channel:row.channel,orderIds:[...new Set(row.orders.map(o=>o.id))],transactions:new Set(row.orders.map(o=>o.id)).size,charged:row.complete?row.charged:null,refunded:row.complete?row.refunded:null,paymentNet:row.complete?round(row.charged-row.refunded):null,preorderDeposit:null}));
  const live=selected.filter(o=>!o.cancelledAt),complete=rows.every(row=>row.charged!==null);
  const sum=key=>complete?round(rows.reduce((total,row)=>total+row[key],0)):null;
  return {rows,orders:selected,group:'payment',totals:{...summarize(selected),transactions:new Set(live.map(o=>o.id)).size,charged:sum('charged'),refunded:sum('refunded'),paymentNet:sum('paymentNet'),preorderDeposit:null}};
}

// Apportion recorded order amounts in integer cents. Prefer complete line snapshots.
function allocateRecordedAmount(amount,weights,snapshots){
  if(amount===null||amount===undefined)return weights.map(()=>null);
  const cents=Math.round(amount*100);
  const weightTotal=weights.reduce((sum,value)=>sum+value,0);
  if(!weightTotal)return weights.map(()=>0);
  if(snapshots.every(value=>value!==null)&&snapshots.reduce((sum,value)=>sum+Math.round(value*100),0)===cents)
    return snapshots.map(value=>Math.round(value*100)/100);
  let allocated=0,cumulativeWeight=0;
  return weights.map((weight,index)=>{
    cumulativeWeight+=weight;
    const next=index===weights.length-1?cents:Math.round(cents*cumulativeWeight/weightTotal);
    const value=next-allocated;
    allocated=next;
    return value/100;
  });
}

export function buildItemReport(orders,scope,group='product'){
  if(!BREAKDOWN_GROUPS.includes(group))throw Error('การจัดกลุ่มไม่ถูกต้อง');
  const selected=orders.filter(order=>matches(order,scope)),groups=new Map();
  const fields=['gross','discount','net','tax','charges','total','cost'];
  let allocatedOrders=0,missingMetadata=0,unallocatedOrders=0;
  const add=(key,label,order,item,amounts,missing=false)=>{
    if(!groups.has(key))groups.set(key,{key,label,missing,lines:[],receipts:new Set(),qty:0,categories:new Set(),skus:new Set(),productNames:new Set(),skuNames:new Set()});
    const bucket=groups.get(key);
    if(item.name)bucket.productNames.add(item.name);
    if(item.skuName||item.variantName||item.name)bucket.skuNames.add(item.skuName||item.variantName||item.name);
    if(item.category)bucket.categories.add(item.category);
    if(item.sku)bucket.skus.add(item.sku);
    bucket.lines.push({...order,...amounts,qty:item.quantity});
    if(order.kind!=='return')bucket.receipts.add(order.id);
    bucket.qty+=order.kind==='return'?-item.quantity:item.quantity;
  };
  for(const order of selected){
    if(order.cancelledAt)continue;
    const items=order.items.length?order.items:[{name:'',quantity:0,subtotal:null}];
    const weights=items.map(itemWeight);
    const hasWeights=weights.some(value=>value>0);
    const allocations={};
    for(const field of fields){
      const snapshots=items.map(item=>{
        if(field==='gross')return number(item.gross)??number(item.subtotal);
        if(field==='cost')return number(item.lineCost)??(number(item.unitCost??item.costAtSale)!==null?round(Number(item.unitCost??item.costAtSale)*item.quantity):null);
        return number(item[field]);
      });
      allocations[field]=allocateRecordedAmount(order[field],weights,snapshots);
    }
    if(items.length>1&&hasWeights)allocatedOrders++;
    for(const [index,item] of items.entries()){
      const {key,label,missing}=itemGroup(item,group);
      if(missing)missingMetadata++;
      add(key,label,order,item,Object.fromEntries(fields.map(field=>[field,allocations[field][index]])),missing);
    }
    // Keep money without a line-value basis visible rather than assigning it to a product.
    if(!hasWeights&&fields.some(field=>Number(order[field])!==0&&order[field]!==null)){
      unallocatedOrders++;
      add(JSON.stringify(['unallocated',group]),'ยอดที่ยังจัดสรรไม่ได้',order,{quantity:0},Object.fromEntries(fields.map(field=>[field,order[field]])),true);
    }
  }
  const rows=[...groups.values()].map(bucket=>{
    const totals=summarize(bucket.lines);
    totals.orders=bucket.receipts.size;
    totals.average=totals.net===null?null:totals.orders?round(totals.net/totals.orders):0;
    return {key:bucket.key,label:bucket.label,missing:bucket.missing,productName:[...bucket.productNames].sort().join(', ')||null,skuName:[...bucket.skuNames].sort().join(', ')||null,category:[...bucket.categories].sort().join(', ')||null,sku:[...bucket.skus].sort().join(', ')||null,orderIds:[...new Set(bucket.lines.map(order=>order.id))],...totals,qty:round(bucket.qty),...productReportMetrics(bucket.lines,totals,round(bucket.qty))};
  }).sort((a,b)=>(b.total??0)-(a.total??0)||a.label.localeCompare(b.label));
  const totals={...summarize(selected),qty:round(rows.reduce((sum,row)=>sum+row.qty,0))};
  Object.assign(totals,productReportMetrics(selected,totals,totals.qty));
  return {rows,totals,orders:selected,group,allocation:{allocatedOrders,missingMetadata,unallocatedOrders}};
}

function productReportMetrics(orders,totals,netQuantity){
  const sales=orders.filter(o=>!o.cancelledAt&&o.kind!=='return');
  const returns=orders.filter(o=>!o.cancelledAt&&o.kind==='return');
  const sum=(rows,get)=>round(rows.reduce((n,row)=>n+Math.round(get(row)*100),0)/100);
  return {
    soldQty:sum(sales,o=>o.qty||0),
    productValue:sum(sales,o=>(o.total??0)-(o.charges??0)),
    returnedValue:sum(returns,o=>(o.total??0)-(o.charges??0)),
    averageCost:totals.cost===null||!netQuantity?null:round(totals.cost/netQuantity),
    averageNet:totals.net===null||!netQuantity?null:round(totals.net/netQuantity),
  };
}
