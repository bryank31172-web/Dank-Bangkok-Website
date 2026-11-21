import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import crypto from 'node:crypto';
export async function createInventoryFixture(extra=0){
  const db=new PGlite();
  for(const file of ['0001_dank_backoffice.sql','0002_dank_backoffice_audit_import.sql','0004_inventory_workflows.sql','0005_purchasing_receiving.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.exec("insert into bo_stores(id,name) values('a','DANK พัฒนาการ'),('b','DANK สาทร');");
  const products=[{id:'flower',name:'MAC1',sku:'00001',barcode:'885000001',category:'ดอกไม้',unit:'g',stock:99},{id:'water',name:'น้ำดื่ม',sku:'00002',barcode:'885000002',category:'เครื่องดื่ม',unit:'ขวด',stock:12},{id:'unknown',name:'สินค้าใหม่ — ยังไม่ตรวจนับ',sku:'00003',category:'อุปกรณ์',unit:'ชิ้น',stock:99},...Array.from({length:extra},(_,i)=>({id:'extra-'+i,name:'สินค้า '+String(i+1).padStart(2,'0'),sku:'E'+i,category:'อุปกรณ์',unit:'ชิ้น'}))];
  async function command(action,payload,id=crypto.randomUUID(),actor='fixture-owner'){
    return (await db.query('select bo_inventory_command($1,$2::uuid,$3::jsonb,$4) as value',[action,id,JSON.stringify(payload),actor])).rows[0].value;
  }
  for(const product of products)await command('register',{item_type:'product',item_key:product.id,name:product.name,sku:product.sku,barcode:product.barcode||'',category:product.category,unit:product.unit,precision:product.unit==='g'?3:0});
  for(const [key,store,amount] of [['flower','a',120.5],['flower','b',35],['water','a',24],['water','b',0]]){
    const count=await command('count_start',{store_id:store,items:[{item_type:'product',item_key:key}]});
    await command('count_save',{id:count.id,lines:[{item_type:'product',item_key:key,counted_qty:amount}]});await command('count_complete',{id:count.id});
  }
  await db.exec("insert into bo_product_settings(product_key,cost_price) values('flower',100),('water',5);insert into bo_product_stock_settings(product_key,store_id,low_stock_threshold,ideal_stock) values('flower','b',50,100),('water','b',12,48);");
  const values=new Map([
    ['menu:cache',{at:Date.now(),changedAt:Date.now(),source:'pos',data:products}],
    ['pos:feed',{at:Date.now(),products:[{id:'flower',name:'MAC1',stock:76.5,stockRecorded:true,inventoryUnit:'g'},{id:'unknown',name:'ค่าเก่าที่อาจเป็นค่าแทน',stock:99}]}]
  ]);
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  const ident=value=>{if(!/^[a-z_][a-z_0-9]*$/i.test(value))throw Error('unsafe test identifier');return '"'+value+'"';};
  async function fetcher(input,init={}){
    const url=new URL(String(input)),path=url.pathname.replace('/rest/v1/',''),method=init.method||'GET';
    if(url.hostname!=='inventory.test')throw Error('Unexpected external request in inventory fixture: '+url.hostname);
    try{
      if(path==='rpc/bo_inventory_snapshot')return reply((await db.query('select bo_inventory_snapshot() as value')).rows[0].value);
      if(path==='rpc/bo_inventory_command'){
        const args=JSON.parse(init.body);return reply(await command(args.p_action,args.p_payload,args.p_request_id,args.p_actor));
      }
      if(path==='rpc/bo_supply_command'){const a=JSON.parse(init.body);return reply((await db.query('select bo_supply_command($1,$2::uuid,$3::jsonb,$4) as value',[a.p_action,a.p_request_id,JSON.stringify(a.p_payload),a.p_actor])).rows[0].value);}
      if(path==='site_kv'){
        if(method==='GET'){const key=(url.searchParams.get('key')||'').replace(/^eq\./,'');return reply(values.has(key)?[{value:values.get(key)}]:[]);}
        const rows=JSON.parse(init.body);for(const row of rows)values.set(row.key,row.value);return reply(null);
      }
      if(!path.startsWith('bo_'))throw Error('Unexpected fixture route: '+path);
      const table=ident(path),args=[],where=[];
      for(const [key,value] of url.searchParams){
        if(['select','order','limit','offset','on_conflict'].includes(key))continue;
        if(value.startsWith('in.(')&&value.endsWith(')')){const placeholders=value.slice(4,-1).split(',').map(entry=>{args.push(entry);return '$'+args.length;});where.push(ident(key)+' in ('+placeholders.join(',')+')');continue;}
        if(value.startsWith('ilike.')){args.push(value.slice(6).replaceAll('*','%'));where.push(ident(key)+' ilike $'+args.length);continue;}
        const filter=/^(eq|lt|lte|gte|gt)\.(.*)$/.exec(value);if(!filter)throw Error('Unsupported fixture filter '+key+':'+value);
        args.push(filter[2]);where.push(ident(key)+({eq:'=',lt:'<',lte:'<=',gte:'>=',gt:'>'}[filter[1]])+'$'+args.length);
      }
      if(method==='GET'){
        let query='select * from '+table+(where.length?' where '+where.join(' and '):'');
        const order=url.searchParams.get('order');if(order)query+=' order by '+order.split(',').map(v=>{const [key,dir]=v.split('.');return ident(key)+(dir==='desc'?' desc':' asc');}).join(',');
        if(url.searchParams.has('limit'))query+=' limit '+Number(url.searchParams.get('limit'));
        if(url.searchParams.has('offset'))query+=' offset '+Number(url.searchParams.get('offset'));
        const rows=(await db.query(query,args)).rows;
        if(path==='bo_stocktakes')for(const row of rows)row.lines=(await db.query('select * from bo_stocktake_lines where stocktake_id=$1',[row.id])).rows;
        if(path==='bo_stock_transfers')for(const row of rows)row.lines=(await db.query('select * from bo_stock_transfer_lines where transfer_id=$1',[row.id])).rows;
        if(path==='bo_purchase_orders')for(const row of rows)row.lines=(await db.query('select * from bo_purchase_order_lines where po_id=$1 order by id',[row.id])).rows;
        const select=url.searchParams.get('select');
        if(select&&select!=='*'&&!select.includes(':'))return reply(rows.map(row=>Object.fromEntries(select.split(',').map(key=>[key,row[key]]))));
        return reply(rows);
      }
      if(method==='POST'){
        const entries=JSON.parse(init.body),results=[];
        for(const row of entries){
          const keys=Object.keys(row),vals=Object.values(row),conflict=url.searchParams.get('on_conflict');
          let query='insert into '+table+'('+keys.map(ident).join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')';
          if(conflict)query+=' on conflict('+conflict.split(',').map(ident).join(',')+') do update set '+keys.filter(k=>!conflict.split(',').includes(k)).map(k=>ident(k)+'=excluded.'+ident(k)).join(',');
          results.push(...(await db.query(query+' returning *',vals)).rows);
        }
        return reply(results);
      }
      throw Error('Unsupported fixture method '+method);
    }catch(error){return reply({code:error.code||'P0001',message:error.message},409);}
  }
  return {db,fetcher,command,products,values};
}
