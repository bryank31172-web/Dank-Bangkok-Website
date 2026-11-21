// Stock quantities are never inferred from storefront availability defaults.
export const qty=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
export const identity=(type,key)=>type+':'+key;
export function buildInventory(snapshot,catalog=[],pos=null,{costs=false}={}){
  const registry=new Map((snapshot.items||[]).map(item=>[identity(item.item_type,item.item_key),item]));
  const candidates=new Map(),warnings=[];
  for(const product of catalog){
    const key=String(product.id??product.sku??'');if(!key)continue;
    const id=identity('product',key);
    if(candidates.has(id)){warnings.push('รหัสสินค้าซ้ำ: '+key);continue;}
    candidates.set(id,{item_type:'product',item_key:key,name:product.name||key,sku:product.sku||'',barcode:product.barcode||'',category:product.category||'',suggested_unit:product.inventoryUnit??product.unit??'',unit:null,precision:null,registered:false});
  }
  for(const item of snapshot.ingredients||[])candidates.set(identity('ingredient',item.id),{item_type:'ingredient',item_key:String(item.id),name:item.name,sku:'',barcode:'',category:'วัตถุดิบ',suggested_unit:item.unit||'',unit:null,registered:false});
  for(const [id,item] of registry)candidates.set(id,{...candidates.get(id),...item,registered:true});
  for(const row of snapshot.balances||[]){const id=identity(row.item_type,row.item_key);if(!candidates.has(id)){candidates.set(id,{item_type:row.item_type,item_key:row.item_key,name:row.item_key,sku:'',category:'ยังไม่จับคู่สินค้า',unit:null,precision:null,registered:false});warnings.push('รหัสในสมุดสต็อกยังไม่ตรงกับรายการสินค้า: '+row.item_key);}}
  const skuOwners=new Map();
  for(const item of candidates.values())if(item.sku){const owners=skuOwners.get(item.sku)||[];owners.push(item.item_key);skuOwners.set(item.sku,owners);}
  for(const [sku,owners] of skuOwners)if(owners.length>1)warnings.push('SKU ซ้ำ ต้องตรวจสอบ: '+sku);
  const balances=new Map((snapshot.balances||[]).map(row=>[identity(row.item_type,row.item_key)+'@'+row.store_id,row]));
  const settings=new Map((snapshot.settings||[]).map(s=>[s.product_key,s]));
  const ingredients=new Map((snapshot.ingredients||[]).map(s=>[String(s.id),s]));
  const thresholds=new Map((snapshot.thresholds||[]).map(s=>[s.product_key+'@'+s.store_id,s]));
  const rows=[];
  const stores=(snapshot.stores||[]).filter(s=>s.active!==false);
  for(const item of candidates.values()){
    const relevant=[...stores];
    for(const b of snapshot.balances||[])if(identity(b.item_type,b.item_key)===identity(item.item_type,item.item_key)&&!relevant.some(s=>s.id===b.store_id))relevant.push({id:b.store_id,name:b.store_id,active:false});
    for(const store of relevant){
      const balance=balances.get(identity(item.item_type,item.item_key)+'@'+store.id);
      const threshold=qty(thresholds.get(item.item_key+'@'+store.id)?.low_stock_threshold);
      const count=balance?qty(balance.balance_after):null;
      const cost=costs?qty(item.item_type==='product'?settings.get(item.item_key)?.cost_price:ingredients.get(item.item_key)?.cost_per_unit):null;
      const inTransit=(snapshot.transfers||[]).filter(t=>t.status==='dispatched'&&t.to_store_id===store.id).flatMap(t=>t.lines||[]).filter(l=>identity(l.item_type,l.item_key)===identity(item.item_type,item.item_key)).reduce((sum,l)=>sum+Math.max(0,Number(l.qty)-Number(l.qty_received||0)-Number(l.qty_missing||0)),0);
      rows.push({...item,id:identity(item.item_type,item.item_key)+'@'+store.id,store_id:store.id,store_name:store.name,store_active:store.active!==false,
        quantity:count,ledger_id:balance?.id??null,updated_at:balance?.created_at??null,threshold,in_transit:inTransit,
        status:count===null?'unknown':count<0?'negative':count===0?'out':threshold!==null&&count<threshold?'low':'available',
        source:'ledger',...(costs?{cost,value:count===null||cost===null?null:Math.round(count*cost*100)/100}:{})});
    }
  }
  // Flat POS snapshots do not identify a branch. Keep them in a separate,
  // read-only scope; never add them to ledger balances or copy to every store.
  for(const p of pos?.products||[]){
    const key=String(p.id??p.sku??'');if(!key)continue;
    const count=p.stockRecorded===true?qty(p.stock):null;
    rows.push({id:'pos:'+key,item_type:'product',item_key:key,name:p.name||key,sku:p.sku||'',barcode:p.barcode||'',category:p.category||'',unit:p.inventoryUnit||null,precision:null,
      registered:false,store_id:'__pos__',store_name:'POS — ไม่ระบุสาขา',quantity:count,ledger_id:null,updated_at:pos.at?new Date(pos.at).toISOString():null,threshold:null,in_transit:0,
      status:count===null?'unknown':count<0?'negative':count===0?'out':'available',source:'pos',read_only:true});
  }
  return {items:[...candidates.values()],rows,warnings:[...new Set(warnings)]};
}
export function filterStock(rows,filters={}){
  const search=String(filters.search||'').trim().toLowerCase();
  return rows.filter(row=>(!filters.store||filters.store==='all'||row.store_id===filters.store)&&
    (!filters.category||row.category===filters.category)&&(!filters.status||row.status===filters.status)&&
    (!search||[row.name,row.sku,row.barcode,row.item_key].some(value=>String(value||'').toLowerCase().includes(search))));
}
