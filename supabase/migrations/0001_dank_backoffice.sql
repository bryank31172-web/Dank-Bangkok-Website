-- DANK BackOffice schema — additive only, nothing existing is altered or dropped.
-- Mirrors site_kv's isolation: RLS on, no policies, service-role key only (same pattern
-- CLAUDE.md documents for site_kv). Run manually via Supabase SQL editor/CLI — not applied
-- automatically. Safe to re-run (IF NOT EXISTS throughout).

-- ========== Outlets ==========
create table if not exists bo_stores (
  id text primary key,                 -- matches branches.json "id" (pattanakarn, sathorn, ...)
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ========== Product extension (BRYAN POS owns name/price/category; this only adds BackOffice fields) ==========
create table if not exists bo_product_settings (
  product_key text primary key,        -- the product id/SKU as it appears from api/_menu.js
  supplier_id uuid,                    -- fk to bo_suppliers added below, once that table exists
  cost_price numeric(12,2),
  track_stock boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists bo_product_stock_settings (
  product_key text not null,
  store_id text not null references bo_stores(id),
  low_stock_threshold numeric(12,3),
  ideal_stock numeric(12,3),
  primary key (product_key, store_id)
);

-- ========== Append-only inventory ledger (products AND ingredients share this) ==========
-- item_type distinguishes a retail product (product_key from POS feed) from a kitchen
-- ingredient (bo_ingredients.id). Never UPDATE or DELETE a row here except to set approved_by;
-- a correction is a new row with a reversing qty_delta, same as a real ledger.
create table if not exists bo_inventory_ledger (
  id bigint generated always as identity primary key,
  item_type text not null check (item_type in ('product','ingredient')),
  item_key text not null,              -- product_key or bo_ingredients.id::text
  store_id text not null references bo_stores(id),
  qty_delta numeric(12,3) not null,
  balance_after numeric(12,3) not null,
  reason text not null,                -- 'receive_po','stocktake','transfer_in','transfer_out',
                                        -- 'manual_adjust','waste','damage','kitchen_consumption'
  ref_type text,                       -- 'purchase_order','stocktake','transfer','kitchen_ticket', null for manual
  ref_id text,
  staff_id text not null,
  approved_by text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists bo_inventory_ledger_item_idx on bo_inventory_ledger (item_type, item_key, store_id, created_at desc);

-- ========== Stock takes ==========
create table if not exists bo_stocktakes (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references bo_stores(id),
  status text not null default 'in_progress' check (status in ('in_progress','completed','cancelled')),
  started_by text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  note text
);
create table if not exists bo_stocktake_lines (
  stocktake_id uuid not null references bo_stocktakes(id) on delete cascade,
  item_type text not null check (item_type in ('product','ingredient')),
  item_key text not null,
  expected_qty numeric(12,3) not null,
  counted_qty numeric(12,3),
  primary key (stocktake_id, item_type, item_key)
);

-- ========== Stock transfers between outlets ==========
create table if not exists bo_stock_transfers (
  id uuid primary key default gen_random_uuid(),
  from_store_id text not null references bo_stores(id),
  to_store_id text not null references bo_stores(id),
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists bo_stock_transfer_lines (
  transfer_id uuid not null references bo_stock_transfers(id) on delete cascade,
  item_type text not null check (item_type in ('product','ingredient')),
  item_key text not null,
  qty numeric(12,3) not null,
  primary key (transfer_id, item_type, item_key)
);

-- ========== Suppliers ==========
create table if not exists bo_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- (fk from bo_product_settings.supplier_id is added here, now that bo_suppliers exists)
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'bo_product_settings_supplier_fk'
  ) then
    alter table bo_product_settings
      add constraint bo_product_settings_supplier_fk
      foreign key (supplier_id) references bo_suppliers(id);
  end if;
end $$;

-- ========== Purchase orders ==========
create table if not exists bo_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,      -- 'PO0001', assigned server-side, sequential
  supplier_id uuid not null references bo_suppliers(id),
  store_id text not null references bo_stores(id),
  status text not null default 'draft' check (status in ('draft','ordered','receiving','completed','cancelled')),
  order_date date,
  expected_date date,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists bo_purchase_order_lines (
  id bigint generated always as identity primary key,
  po_id uuid not null references bo_purchase_orders(id) on delete cascade,
  item_type text not null check (item_type in ('product','ingredient')),
  item_key text not null,
  qty_ordered numeric(12,3) not null,
  qty_received numeric(12,3) not null default 0,
  unit_cost numeric(12,2) not null default 0
);

-- ========== Food & beverage: ingredients + recipes ==========
create table if not exists bo_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,                  -- 'g','ml','pc', etc.
  cost_per_unit numeric(12,4) not null default 0,
  supplier_id uuid references bo_suppliers(id),
  track_stock boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists bo_recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_key text not null,         -- links to food-menu.json / POS menu item name-key
  name text not null,
  yield_qty numeric(12,3) not null default 1,
  instructions text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists bo_recipe_lines (
  recipe_id uuid not null references bo_recipes(id) on delete cascade,
  ingredient_id uuid not null references bo_ingredients(id),
  qty numeric(12,3) not null,
  primary key (recipe_id, ingredient_id)
);

-- ========== Kitchen tickets ==========
create table if not exists bo_kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references bo_stores(id),
  source text not null default 'manual' check (source in ('manual','order')),
  order_ref text,                      -- order:<id> from site_kv, if it came from an online order
  status text not null default 'new' check (status in ('new','preparing','ready','served','cancelled')),
  consumption_recorded boolean not null default false,  -- guards against double stock deduction
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists bo_kitchen_ticket_lines (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references bo_kitchen_tickets(id) on delete cascade,
  menu_item_key text not null,
  qty numeric(12,3) not null,
  special_instructions text,
  prepared_by text
);

-- ========== Expenses ==========
create table if not exists bo_expenses (
  id uuid primary key default gen_random_uuid(),
  store_id text references bo_stores(id),
  category text not null,              -- 'utilities','rent','staff','equipment','repairs','supplier','other'
  vendor text,
  amount numeric(12,2) not null,
  expense_date date not null,
  recurring text check (recurring in (null,'weekly','monthly','yearly')),
  note text,
  attachment_url text,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- ========== Atomic helpers (avoid read-then-write races from the API layer) ==========

-- Appends one ledger row with a correctly-serialized balance_after, even under
-- concurrent calls for the same item+store: the advisory lock makes concurrent
-- transactions queue instead of both reading the same "previous balance" and
-- racing to write. Scoped to item_type+item_key+store_id, not the whole table,
-- so unrelated products/stores are never blocked by each other.
create or replace function bo_ledger_adjust(
  p_item_type text, p_item_key text, p_store_id text, p_qty_delta numeric,
  p_reason text, p_ref_type text, p_ref_id text, p_staff_id text, p_note text
) returns bo_inventory_ledger
language plpgsql
as $$
declare
  v_prev numeric;
  v_row bo_inventory_ledger;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_item_type || ':' || p_item_key || ':' || p_store_id, 0));
  select balance_after into v_prev
    from bo_inventory_ledger
    where item_type = p_item_type and item_key = p_item_key and store_id = p_store_id
    order by created_at desc, id desc
    limit 1;
  if v_prev is null then v_prev := 0; end if;
  insert into bo_inventory_ledger
    (item_type, item_key, store_id, qty_delta, balance_after, reason, ref_type, ref_id, staff_id, note)
  values
    (p_item_type, p_item_key, p_store_id, p_qty_delta, v_prev + p_qty_delta, p_reason, p_ref_type, p_ref_id, p_staff_id, p_note)
  returning * into v_row;
  return v_row;
end;
$$;

-- Sequential PO numbers without a race between two staff creating a PO at once.
create sequence if not exists bo_po_number_seq;
create or replace function bo_next_po_number() returns text
language sql
as $$
  select 'PO' || lpad(nextval('bo_po_number_seq')::text, 4, '0');
$$;

-- ========== RLS: lock everything to service-role only, same posture as site_kv ==========
do $$
declare t text;
begin
  for t in select unnest(array[
    'bo_stores','bo_product_settings','bo_product_stock_settings','bo_inventory_ledger',
    'bo_stocktakes','bo_stocktake_lines','bo_stock_transfers','bo_stock_transfer_lines',
    'bo_suppliers','bo_purchase_orders','bo_purchase_order_lines',
    'bo_ingredients','bo_recipes','bo_recipe_lines',
    'bo_kitchen_tickets','bo_kitchen_ticket_lines','bo_expenses'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;
