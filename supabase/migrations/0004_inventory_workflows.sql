-- Inventory review: additive schema; apply after 0001 and 0002.
create table if not exists bo_inventory_items (
  item_type text not null check(item_type in ('product','ingredient')),
  item_key text not null, name text not null, sku text, barcode text, category text,
  unit text not null check(length(trim(unit)) between 1 and 30),
  precision integer not null default 0 check(precision between 0 and 3),
  updated_at timestamptz not null default now(), updated_by text not null,
  primary key(item_type,item_key)
);
create table if not exists bo_inventory_requests (
  request_id uuid primary key, action text not null, actor text not null,
  payload jsonb not null, response jsonb not null, created_at timestamptz not null default now()
);
alter table bo_inventory_items enable row level security;
alter table bo_inventory_requests enable row level security;
alter table bo_stocktake_lines add column if not exists expected_ledger_id bigint;
alter table bo_stocktake_lines add column if not exists expected_known boolean not null default true;
alter table bo_stock_transfers add column if not exists dispatched_at timestamptz;
alter table bo_stock_transfers add column if not exists dispatched_by text;
alter table bo_stock_transfers add column if not exists received_by text;
alter table bo_stock_transfers drop constraint if exists bo_stock_transfers_status_check;
alter table bo_stock_transfers add constraint bo_stock_transfers_status_check check(status in ('pending','dispatched','completed','cancelled'));

-- Same per-item lock as existing purchasing/kitchen writes. Wall-clock time
-- prevents an older waiting transaction from sorting ahead of a newer balance.
create or replace function bo_ledger_adjust(
  p_item_type text,p_item_key text,p_store_id text,p_qty_delta numeric,
  p_reason text,p_ref_type text,p_ref_id text,p_staff_id text,p_note text
) returns bo_inventory_ledger language plpgsql as $$
declare v_prev numeric; v_row bo_inventory_ledger;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_item_type||':'||p_item_key||':'||p_store_id,0));
  select balance_after into v_prev from bo_inventory_ledger
   where item_type=p_item_type and item_key=p_item_key and store_id=p_store_id order by id desc limit 1;
  insert into bo_inventory_ledger(item_type,item_key,store_id,qty_delta,balance_after,reason,ref_type,ref_id,staff_id,note,created_at)
   values(p_item_type,p_item_key,p_store_id,p_qty_delta,coalesce(v_prev,0)+p_qty_delta,p_reason,p_ref_type,p_ref_id,p_staff_id,p_note,clock_timestamp()) returning * into v_row;
  return v_row;
end $$;

create or replace function bo_inventory_command(p_action text,p_request_id uuid,p_payload jsonb,p_actor text)
returns jsonb language plpgsql set search_path=public as $$
declare
  cached bo_inventory_requests; meta bo_inventory_items; session bo_stocktakes;
  transfer bo_stock_transfers; latest bo_inventory_ledger; movement bo_inventory_ledger;
  item jsonb; line record; itemtype text; itemkey text; store text; quantity numeric;
  result jsonb; identifier uuid; lockkey text; difference numeric; changed integer:=0;
begin
  if nullif(trim(p_actor),'') is null or p_request_id is null then raise exception 'actor and request_id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-request:'||p_request_id::text,0));
  select * into cached from bo_inventory_requests where request_id=p_request_id;
  if found then
    if cached.action<>p_action or cached.actor<>p_actor or cached.payload<>p_payload then raise exception 'request_id reused with different data'; end if;
    return cached.response;
  end if;

  if p_action='register' then
    itemtype:=p_payload->>'item_type';itemkey:=p_payload->>'item_key';
    if itemtype not in ('product','ingredient') or nullif(trim(itemkey),'') is null or nullif(trim(p_payload->>'name'),'') is null then raise exception 'invalid item'; end if;
    perform pg_advisory_xact_lock(hashtextextended('inventory-unit:'||itemtype||':'||itemkey,0));
    select * into meta from bo_inventory_items where item_type=itemtype and item_key=itemkey;
    if found and (meta.unit<>p_payload->>'unit' or meta.precision<>(p_payload->>'precision')::integer)
      and exists(select 1 from bo_inventory_ledger where item_type=itemtype and item_key=itemkey) then
      raise exception 'cannot change a unit after stock movements; a reviewed conversion is required';
    end if;
    insert into bo_inventory_items(item_type,item_key,name,sku,barcode,category,unit,precision,updated_by)
      values(itemtype,itemkey,p_payload->>'name',p_payload->>'sku',p_payload->>'barcode',p_payload->>'category',p_payload->>'unit',(p_payload->>'precision')::integer,p_actor)
      on conflict(item_type,item_key) do update set name=excluded.name,sku=excluded.sku,barcode=excluded.barcode,category=excluded.category,
        unit=excluded.unit,precision=excluded.precision,updated_by=p_actor,updated_at=clock_timestamp();
    result:=jsonb_build_object('ok',true);

  elsif p_action='adjust' then
    itemtype:=p_payload->>'item_type';itemkey:=p_payload->>'item_key';store:=p_payload->>'store_id';quantity:=(p_payload->>'qty_delta')::numeric;
    if not exists(select 1 from bo_stores where id=store and active) then raise exception 'active store required';end if;
    select * into meta from bo_inventory_items where item_type=itemtype and item_key=itemkey;
    if not found then raise exception 'register and verify the item unit first';end if;
    if quantity is null or quantity=0 or quantity<>round(quantity,meta.precision) or abs(quantity)>999999999 then raise exception 'invalid quantity or precision';end if;
    if p_payload->>'reason' not in ('manual_adjust','waste','damage') or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'reason and explanation required';end if;
    if p_payload->>'reason' in ('waste','damage') and quantity>0 then raise exception 'waste and damage must reduce stock';end if;
    perform pg_advisory_xact_lock(hashtextextended(itemtype||':'||itemkey||':'||store,0));
    select * into latest from bo_inventory_ledger where item_type=itemtype and item_key=itemkey and store_id=store order by id desc limit 1;
    if not found then raise exception 'initial stock count required';end if;
    if (p_payload->>'expected_ledger_id') is null or latest.id<>(p_payload->>'expected_ledger_id')::bigint then raise exception 'stock changed; refresh and review the adjustment';end if;
    if latest.balance_after+quantity<0 then raise exception 'insufficient stock';end if;
    movement:=bo_ledger_adjust(itemtype,itemkey,store,quantity,p_payload->>'reason','inventory_request',p_request_id::text,p_actor,p_payload->>'note');
    result:=jsonb_build_object('ok',true,'row',to_jsonb(movement));

  elsif p_action='count_start' then
    store:=p_payload->>'store_id';
    if not exists(select 1 from bo_stores where id=store and active) then raise exception 'active store required';end if;
    if jsonb_array_length(p_payload->'items') not between 1 and 200 then raise exception 'choose 1 to 200 items';end if;
    insert into bo_stocktakes(store_id,status,started_by,note) values(store,'in_progress',p_actor,p_payload->>'note') returning id into identifier;
    for item in select value from jsonb_array_elements(p_payload->'items') order by value->>'item_type',value->>'item_key' loop
      itemtype:=item->>'item_type';itemkey:=item->>'item_key';
      if not exists(select 1 from bo_inventory_items where item_type=itemtype and item_key=itemkey) then raise exception 'register item unit first';end if;
      perform pg_advisory_xact_lock(hashtextextended(itemtype||':'||itemkey||':'||store,0));
      select * into latest from bo_inventory_ledger where item_type=itemtype and item_key=itemkey and store_id=store order by id desc limit 1;
      insert into bo_stocktake_lines(stocktake_id,item_type,item_key,expected_qty,expected_ledger_id,expected_known)
        values(identifier,itemtype,itemkey,coalesce(latest.balance_after,0),latest.id,latest.id is not null);
    end loop;
    result:=jsonb_build_object('ok',true,'id',identifier);

  elsif p_action in ('count_save','count_complete','count_cancel') then
    select * into session from bo_stocktakes where id=(p_payload->>'id')::uuid for update;
    if not found then raise exception 'count not found';end if;
    if session.status='completed' and p_action='count_complete' then result:=jsonb_build_object('ok',true,'session',to_jsonb(session));
    else
      if session.status<>'in_progress' then raise exception 'count is no longer editable';end if;
      if p_action='count_cancel' then
        update bo_stocktakes set status='cancelled' where id=session.id;
      elsif p_action='count_save' then
        for item in select value from jsonb_array_elements(p_payload->'lines') loop
          itemtype:=item->>'item_type';itemkey:=item->>'item_key';
          select * into meta from bo_inventory_items where item_type=itemtype and item_key=itemkey;
          quantity:=(item->>'counted_qty')::numeric;
          if meta.item_key is null or (quantity is not null and (quantity<0 or quantity<>round(quantity,meta.precision) or quantity>999999999)) then raise exception 'invalid count quantity';end if;
          update bo_stocktake_lines set counted_qty=quantity where stocktake_id=session.id and item_type=itemtype and item_key=itemkey;
          if not found then raise exception 'count item not found';end if;
        end loop;
      else
        if not exists(select 1 from bo_stocktake_lines where stocktake_id=session.id and counted_qty is not null) then raise exception 'enter at least one count';end if;
        for line in select * from bo_stocktake_lines where stocktake_id=session.id and counted_qty is not null order by item_type,item_key loop
          perform pg_advisory_xact_lock(hashtextextended(line.item_type||':'||line.item_key||':'||session.store_id,0));
          select * into latest from bo_inventory_ledger where item_type=line.item_type and item_key=line.item_key and store_id=session.store_id order by id desc limit 1;
          if latest.id is distinct from line.expected_ledger_id then raise exception 'stock moved after counting began; review and start a fresh count';end if;
          difference:=line.counted_qty-line.expected_qty;
          if difference<>0 or not line.expected_known then
            movement:=bo_ledger_adjust(line.item_type,line.item_key,session.store_id,difference,'stocktake','stocktake',session.id::text,p_actor,'reviewed physical count');
            update bo_inventory_ledger set approved_by=p_actor where id=movement.id;
            changed:=changed+1;
          end if;
        end loop;
        update bo_stocktakes set status='completed',completed_at=clock_timestamp() where id=session.id;
      end if;
      result:=jsonb_build_object('ok',true,'id',session.id,'adjustments',changed);
    end if;

  elsif p_action='transfer_start' then
    if p_payload->>'from_store_id'=p_payload->>'to_store_id' then raise exception 'choose different stores';end if;
    if (select count(*) from bo_stores where active and id in (p_payload->>'from_store_id',p_payload->>'to_store_id'))<>2 then raise exception 'two active stores required';end if;
    if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'choose 1 to 200 items';end if;
    insert into bo_stock_transfers(from_store_id,to_store_id,created_by) values(p_payload->>'from_store_id',p_payload->>'to_store_id',p_actor) returning id into identifier;
    for item in select value from jsonb_array_elements(p_payload->'lines') loop
      select * into meta from bo_inventory_items where item_type=item->>'item_type' and item_key=item->>'item_key';
      quantity:=(item->>'qty')::numeric;
      if meta.item_key is null or quantity is null or quantity<=0 or quantity<>round(quantity,meta.precision) or quantity>999999999 then raise exception 'invalid transfer quantity';end if;
      insert into bo_stock_transfer_lines(transfer_id,item_type,item_key,qty) values(identifier,meta.item_type,meta.item_key,quantity);
    end loop;
    result:=jsonb_build_object('ok',true,'id',identifier);

  elsif p_action in ('transfer_dispatch','transfer_receive','transfer_cancel') then
    select * into transfer from bo_stock_transfers where id=(p_payload->>'id')::uuid for update;
    if not found then raise exception 'transfer not found';end if;
    if (p_action='transfer_dispatch' and transfer.status in ('dispatched','completed')) or (p_action='transfer_receive' and transfer.status='completed') then
      result:=jsonb_build_object('ok',true,'row',to_jsonb(transfer));
    else
      if p_action='transfer_cancel' then
        if transfer.status<>'pending' then raise exception 'only pending transfers can be cancelled';end if;
        update bo_stock_transfers set status='cancelled' where id=transfer.id;
      else
        if p_action='transfer_dispatch' and transfer.status<>'pending' then raise exception 'transfer is not pending';end if;
        if p_action='transfer_receive' and transfer.status<>'dispatched' then raise exception 'dispatch goods before receiving';end if;
        store:=case when p_action='transfer_dispatch' then transfer.from_store_id else transfer.to_store_id end;
        for line in select * from bo_stock_transfer_lines where transfer_id=transfer.id order by item_type,item_key loop
          perform pg_advisory_xact_lock(hashtextextended(line.item_type||':'||line.item_key||':'||store,0));
          if p_action='transfer_dispatch' then
            select * into latest from bo_inventory_ledger where item_type=line.item_type and item_key=line.item_key and store_id=store order by id desc limit 1;
            if latest.id is null or latest.balance_after<line.qty then raise exception 'insufficient source stock';end if;
          end if;
          movement:=bo_ledger_adjust(line.item_type,line.item_key,store,case when p_action='transfer_dispatch' then -line.qty else line.qty end,
             case when p_action='transfer_dispatch' then 'transfer_out' else 'transfer_in' end,'transfer',transfer.id::text,p_actor,null);
        end loop;
        if p_action='transfer_dispatch' then update bo_stock_transfers set status='dispatched',dispatched_at=clock_timestamp(),dispatched_by=p_actor where id=transfer.id;
        else update bo_stock_transfers set status='completed',completed_at=clock_timestamp(),received_by=p_actor where id=transfer.id;end if;
      end if;
      select * into transfer from bo_stock_transfers where id=transfer.id;
      result:=jsonb_build_object('ok',true,'row',to_jsonb(transfer));
    end if;
  else raise exception 'unsupported inventory action';end if;

  insert into bo_inventory_requests(request_id,action,actor,payload,response) values(p_request_id,p_action,p_actor,p_payload,result);
  return result;
end $$;
revoke all on function bo_inventory_command(text,uuid,jsonb,text) from public;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function bo_inventory_command(text,uuid,jsonb,text) to service_role;
end if; end $$;

-- One database snapshot: balances and in-transit documents cannot be read
-- from opposite sides of the same dispatch/receive transaction.
create or replace function bo_inventory_snapshot() returns jsonb language sql set search_path=public as $$
 select jsonb_build_object(
  'version',1,'at',clock_timestamp(),
  'stores',coalesce((select jsonb_agg(s order by s.name) from bo_stores s),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(i) from bo_inventory_items i),'[]'::jsonb),
  'ingredients',coalesce((select jsonb_agg(i) from bo_ingredients i),'[]'::jsonb),
  'settings',coalesce((select jsonb_agg(s) from bo_product_settings s),'[]'::jsonb),
  'thresholds',coalesce((select jsonb_agg(s) from bo_product_stock_settings s),'[]'::jsonb),
  'balances',coalesce((select jsonb_agg(b) from (
    select distinct on(item_type,item_key,store_id) id,item_type,item_key,store_id,balance_after,created_at
      from bo_inventory_ledger order by item_type,item_key,store_id,id desc
  ) b),'[]'::jsonb),
  'counts',coalesce((select jsonb_agg(c) from (
    select s.*,coalesce((select jsonb_agg(l order by l.item_type,l.item_key) from bo_stocktake_lines l where l.stocktake_id=s.id),'[]'::jsonb) as lines
    from bo_stocktakes s order by started_at desc,id desc limit 100
  ) c),'[]'::jsonb),
  'transfers',coalesce((select jsonb_agg(t) from (
    select s.*,coalesce((select jsonb_agg(l order by l.item_type,l.item_key) from bo_stock_transfer_lines l where l.transfer_id=s.id),'[]'::jsonb) as lines
    from bo_stock_transfers s order by created_at desc,id desc
  ) t),'[]'::jsonb)
 );
$$;
revoke all on function bo_inventory_snapshot() from public;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function bo_inventory_snapshot() to service_role;
end if; end $$;
