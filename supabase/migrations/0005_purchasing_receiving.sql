-- Run after 0004. Transactional purchasing and partial transfer receipts.
alter table bo_purchase_orders add column if not exists revision bigint not null default 0;
alter table bo_purchase_order_lines add column if not exists item_name text;
alter table bo_purchase_order_lines add column if not exists unit text;
alter table bo_purchase_order_lines add column if not exists qty_cancelled numeric(12,3) not null default 0;
alter table bo_purchase_orders drop constraint if exists bo_purchase_orders_status_check;
alter table bo_purchase_orders add constraint bo_purchase_orders_status_check check(status in ('draft','ordered','receiving','completed','cancelled','closed'));
alter table bo_stock_transfers add column if not exists receipt_version bigint not null default 0;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='bo_stock_transfer_lines' and column_name='qty_received') then
  alter table bo_stock_transfer_lines add column qty_received numeric(12,3) not null default 0;
  update bo_stock_transfer_lines l set qty_received=l.qty from bo_stock_transfers t where t.id=l.transfer_id and t.status='completed';
 end if;
end $$;
alter table bo_stock_transfer_lines add column if not exists qty_missing numeric(12,3) not null default 0;
create table if not exists bo_supply_events (
 id uuid primary key default gen_random_uuid(),
 entity_type text not null check(entity_type in ('purchase_order','transfer')),
 entity_id uuid not null,
 action text not null,
 actor text not null,
 data jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists bo_supply_events_document on bo_supply_events(entity_type,entity_id,created_at);
alter table bo_supply_events enable row level security;

create or replace function bo_supply_command(p_action text,p_request_id uuid,p_payload jsonb,p_actor text)
returns jsonb language plpgsql set search_path=public as $$
declare
 prior bo_inventory_requests; po bo_purchase_orders; tr bo_stock_transfers;
 meta bo_inventory_items; line record; entry jsonb; doc uuid; n numeric;
 result jsonb; details jsonb:='[]'::jsonb; action_name text:='supply:'||p_action;
 before_doc jsonb; event_type text; event_action text; note_text text:=left(coalesce(p_payload->>'note',''),500);
begin
 if p_request_id is null or coalesce(p_actor,'')='' then raise exception 'request_id and actor required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into prior from bo_inventory_requests where request_id=p_request_id;
 if found then
  if prior.action<>action_name or prior.actor<>p_actor or prior.payload<>p_payload then raise exception 'request_id already used';end if;
  return prior.response;
 end if;
 if p_action like 'po_%' then
  event_type:='purchase_order';
  if p_action='po_create' then
   if not exists(select 1 from bo_suppliers where id=(p_payload->>'supplier_id')::uuid and active) then raise exception 'active supplier required';end if;
   if not exists(select 1 from bo_stores where id=p_payload->>'store_id' and active) then raise exception 'active store required';end if;
   insert into bo_purchase_orders(po_number,supplier_id,store_id,order_date,expected_date,note,created_by)
   values(bo_next_po_number(),(p_payload->>'supplier_id')::uuid,p_payload->>'store_id',coalesce(nullif(p_payload->>'order_date','')::date,current_date),nullif(p_payload->>'expected_date','')::date,note_text,p_actor) returning * into po;
  else
   select * into po from bo_purchase_orders where id=(p_payload->>'id')::uuid for update;
   if not found then raise exception 'purchase order not found';end if;
   if (p_payload->>'expected_revision')::bigint is distinct from po.revision then raise exception 'document changed; refresh before confirming';end if;
  end if;
  doc:=po.id;before_doc:=case when p_action='po_create' then null else to_jsonb(po)||jsonb_build_object('lines',(select coalesce(jsonb_agg(l order by l.id),'[]'::jsonb) from bo_purchase_order_lines l where po_id=po.id)) end;
  if p_action in ('po_create','po_edit') then
   if po.status<>'draft' then raise exception 'only draft orders can be edited';end if;
   if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'choose 1 to 200 items';end if;
   if (select count(*) from jsonb_array_elements(p_payload->'lines'))<>(select count(distinct value->>'item_type'||':'||(value->>'item_key')) from jsonb_array_elements(p_payload->'lines')) then raise exception 'duplicate item';end if;
   if p_action='po_edit' then
    if not exists(select 1 from bo_suppliers where id=(p_payload->>'supplier_id')::uuid and active) or not exists(select 1 from bo_stores where id=p_payload->>'store_id' and active) then raise exception 'active supplier and store required';end if;
    update bo_purchase_orders set supplier_id=(p_payload->>'supplier_id')::uuid,store_id=p_payload->>'store_id',expected_date=nullif(p_payload->>'expected_date','')::date,note=note_text where id=doc;
    delete from bo_purchase_order_lines where po_id=doc;
   end if;
   for entry in select value from jsonb_array_elements(p_payload->'lines') loop
    select * into meta from bo_inventory_items where item_type=entry->>'item_type' and item_key=entry->>'item_key';
    n:=(entry->>'qty_ordered')::numeric;
    if meta.item_key is null then raise exception 'register item unit first';end if;
    if n is null or n<=0 or n>999999999 or n<>round(n,meta.precision) then raise exception 'invalid quantity precision';end if;
    if (entry->>'unit_cost')::numeric is null or (entry->>'unit_cost')::numeric<0 or (entry->>'unit_cost')::numeric>999999999 or (entry->>'unit_cost')::numeric<>round((entry->>'unit_cost')::numeric,2) then raise exception 'invalid unit cost';end if;
    insert into bo_purchase_order_lines(po_id,item_type,item_key,qty_ordered,unit_cost,item_name,unit)
    values(doc,meta.item_type,meta.item_key,n,(entry->>'unit_cost')::numeric,meta.name,meta.unit);
   end loop;
  elsif p_action='po_send' then
   if po.status<>'draft' then raise exception 'only draft orders can be sent';end if;
   if not exists(select 1 from bo_purchase_order_lines where po_id=doc) then raise exception 'choose items first';end if;
   update bo_purchase_orders set status='ordered' where id=doc;
  elsif p_action='po_cancel' then
   if po.status not in ('draft','ordered') then raise exception 'cannot cancel after receiving';end if;
   if length(trim(note_text))<3 then raise exception 'explanation required';end if;
   update bo_purchase_orders set status='cancelled' where id=doc;
  elsif p_action='po_close' then
   if po.status not in ('ordered','receiving') then raise exception 'order is not open for receiving';end if;
   if length(trim(note_text))<3 then raise exception 'explanation required';end if;
   update bo_purchase_order_lines set qty_cancelled=qty_ordered-qty_received where po_id=doc;
   update bo_purchase_orders set status='closed' where id=doc;
   select coalesce(jsonb_agg(jsonb_build_object('item_type',item_type,'item_key',item_key,'qty_cancelled',qty_cancelled,'unit',unit)),'[]'::jsonb) into details from bo_purchase_order_lines where po_id=doc;
  elsif p_action='po_receive' then
   if po.status not in ('ordered','receiving') then raise exception 'order is not open for receiving';end if;
   if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'choose receipt lines';end if;
   if (select count(*) from jsonb_array_elements(p_payload->'lines'))<>(select count(distinct value->>'line_id') from jsonb_array_elements(p_payload->'lines')) then raise exception 'duplicate receipt line';end if;
   -- Validate every line before any stock changes; transaction also rolls back on failure.
   for entry in select value from jsonb_array_elements(p_payload->'lines') loop
    select * into line from bo_purchase_order_lines where id=(entry->>'line_id')::bigint and po_id=doc;
    if not found then raise exception 'receipt line not found';end if;
    select * into meta from bo_inventory_items where item_type=line.item_type and item_key=line.item_key;
    if meta.item_key is null then raise exception 'register item unit first';end if;
    n:=(entry->>'qty_received')::numeric;
    if line.unit is not null and line.unit<>meta.unit then raise exception 'item unit changed; review purchase order';end if;
    if n is null or n<=0 or n>999999999 or n<>round(n,meta.precision) or line.qty_received+n>line.qty_ordered then raise exception 'receipt exceeds remaining quantity or invalid precision';end if;
   end loop;
   for line in select l.*, (e.value->>'qty_received')::numeric as received_now from bo_purchase_order_lines l join jsonb_array_elements(p_payload->'lines') e on l.id=(e.value->>'line_id')::bigint where l.po_id=doc order by l.item_type,l.item_key loop
    perform pg_advisory_xact_lock(hashtextextended(line.item_type||':'||line.item_key||':'||po.store_id,0));
    if not exists(select 1 from bo_inventory_ledger where item_type=line.item_type and item_key=line.item_key and store_id=po.store_id) then raise exception 'initial stock count required before receipt';end if;
    perform bo_ledger_adjust(line.item_type,line.item_key,po.store_id,line.received_now,'receive_po','purchase_order',doc::text,p_actor,note_text);
    update bo_purchase_order_lines set qty_received=qty_received+line.received_now where id=line.id;
    details:=details||jsonb_build_array(jsonb_build_object('line_id',line.id,'item_type',line.item_type,'item_key',line.item_key,'qty',line.received_now,'unit',line.unit));
   end loop;
   update bo_purchase_orders set status=case when exists(select 1 from bo_purchase_order_lines where po_id=doc and qty_received<qty_ordered) then 'receiving' else 'completed' end where id=doc;
  else raise exception 'unsupported purchase action';end if;
  update bo_purchase_orders set revision=revision+1,updated_at=clock_timestamp() where id=doc returning * into po;
  result:=jsonb_build_object('ok',true,'row',to_jsonb(po),'id',doc);
  insert into bo_audit_log(actor_id,action,entity_type,entity_id,before,after,note) values(p_actor,case when p_action='po_create' then 'create' when p_action='po_edit' then 'update' else 'status_change' end,event_type,doc::text,before_doc,to_jsonb(po)||jsonb_build_object('lines',(select coalesce(jsonb_agg(l order by l.id),'[]'::jsonb) from bo_purchase_order_lines l where po_id=doc)),note_text);
 elsif p_action in ('transfer_receive','transfer_close') then
  event_type:='transfer';doc:=(p_payload->>'id')::uuid;
  select * into tr from bo_stock_transfers where id=doc for update;
  if not found then raise exception 'transfer not found';end if;
  if tr.status<>'dispatched' then raise exception 'transfer must be dispatched and still open';end if;
  if (p_payload->>'expected_revision')::bigint is distinct from tr.receipt_version then raise exception 'document changed; refresh before confirming';end if;
  if p_action='transfer_close' then
   if length(trim(note_text))<3 then raise exception 'explanation required';end if;
   update bo_stock_transfer_lines set qty_missing=qty-qty_received where transfer_id=doc;
   select coalesce(jsonb_agg(jsonb_build_object('item_type',item_type,'item_key',item_key,'qty_missing',qty_missing)),'[]'::jsonb) into details from bo_stock_transfer_lines where transfer_id=doc;
   update bo_stock_transfers set status='completed',completed_at=clock_timestamp(),received_by=p_actor where id=doc;
  else
   if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'choose receipt lines';end if;
   if (select count(*) from jsonb_array_elements(p_payload->'lines'))<>(select count(distinct value->>'item_type'||':'||(value->>'item_key')) from jsonb_array_elements(p_payload->'lines')) then raise exception 'duplicate receipt line';end if;
   for entry in select value from jsonb_array_elements(p_payload->'lines') loop
    select * into line from bo_stock_transfer_lines where transfer_id=doc and item_type=entry->>'item_type' and item_key=entry->>'item_key';
    if not found then raise exception 'receipt line not found';end if;
    select * into meta from bo_inventory_items where item_type=line.item_type and item_key=line.item_key;
    n:=(entry->>'qty_received')::numeric;
    if meta.item_key is null or n is null or n<=0 or n>999999999 or n<>round(n,meta.precision) or n+line.qty_received>line.qty then raise exception 'receipt exceeds remaining quantity or invalid precision';end if;
   end loop;
   for line in select l.*, (e.value->>'qty_received')::numeric as received_now from bo_stock_transfer_lines l join jsonb_array_elements(p_payload->'lines') e on l.item_type=e.value->>'item_type' and l.item_key=e.value->>'item_key' where l.transfer_id=doc order by l.item_type,l.item_key loop
    perform pg_advisory_xact_lock(hashtextextended(line.item_type||':'||line.item_key||':'||tr.to_store_id,0));
    if not exists(select 1 from bo_inventory_ledger where item_type=line.item_type and item_key=line.item_key and store_id=tr.to_store_id) then raise exception 'initial stock count required before receipt';end if;
    perform bo_ledger_adjust(line.item_type,line.item_key,tr.to_store_id,line.received_now,'transfer_in','transfer',doc::text,p_actor,note_text);
    update bo_stock_transfer_lines set qty_received=qty_received+line.received_now where transfer_id=doc and item_type=line.item_type and item_key=line.item_key;
    details:=details||jsonb_build_array(jsonb_build_object('item_type',line.item_type,'item_key',line.item_key,'qty',line.received_now));
   end loop;
   if not exists(select 1 from bo_stock_transfer_lines where transfer_id=doc and qty_received<qty) then
    update bo_stock_transfers set status='completed',completed_at=clock_timestamp(),received_by=p_actor where id=doc;
   end if;
  end if;
  update bo_stock_transfers set receipt_version=receipt_version+1 where id=doc returning * into tr;
  result:=jsonb_build_object('ok',true,'row',to_jsonb(tr),'id',doc);
 else raise exception 'unsupported supply action';end if;
 insert into bo_supply_events(entity_type,entity_id,action,actor,data) values(event_type,doc,p_action,p_actor,jsonb_build_object('lines',details,'note',note_text));
 insert into bo_inventory_requests(request_id,action,actor,payload,response) values(p_request_id,action_name,p_actor,p_payload,result);
 return result;
end $$;
revoke all on function bo_supply_command(text,uuid,jsonb,text) from public;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function bo_supply_command(text,uuid,jsonb,text) to service_role;
end if;end $$;
