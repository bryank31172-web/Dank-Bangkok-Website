-- DANK BackOffice — audit log, recurring expenses, import/reconciliation.
-- Additive only, same posture as 0001 (RLS on, no policies, service-role only).
-- Run after 0001. Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING throughout).

-- ========== Unified audit log ==========
-- Stock movements already have their own append-only trail (bo_inventory_ledger,
-- with staff_id/reason/reference built in) — this table deliberately does NOT
-- duplicate that. It covers the administrative/configuration mutations nothing
-- else records: who created/edited/deleted a supplier, recipe, ingredient,
-- store, expense, or changed a purchase order's status, or granted a staff
-- member an extra permission scope. before/after are nullable jsonb so a
-- create (before=null) and a delete (after=null) both fit the same row shape.
create table if not exists bo_audit_log (
  id bigint generated always as identity primary key,
  actor_id text not null,
  action text not null check (action in ('create','update','delete','status_change')),
  entity_type text not null,           -- 'supplier','purchase_order','recipe','ingredient',
                                        -- 'store','expense','staff_scope','kitchen_ticket', ...
  entity_id text not null,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists bo_audit_log_entity_idx on bo_audit_log (entity_type, entity_id, created_at desc);
create index if not exists bo_audit_log_actor_idx on bo_audit_log (actor_id, created_at desc);

-- ========== Recurring expenses ==========
-- bo_expenses already has a `recurring` column (weekly/monthly/yearly) that,
-- until now, was a label nobody acted on. These two columns make it real:
-- `next_generated` guards against a row spawning its successor twice (the
-- generator checks it before inserting, same compare-and-swap shape as the
-- kitchen ticket consume-once guard in api/backoffice/kitchen.js), and
-- `generated_from` traces a generated row back to the one that spawned it,
-- so a staff member looking at a ฿20,000 rent line in month 7 can follow the
-- chain back to the original entry rather than wondering where it came from.
alter table bo_expenses add column if not exists next_generated boolean not null default false;
alter table bo_expenses add column if not exists generated_from uuid references bo_expenses(id);

-- ========== Import batches + reconciliation ==========
-- Deliberately NOT a way to inject unverified external data as confirmed
-- expenses or sales — the brief is explicit ("never fabricate financial
-- information or treat unverified sales as confirmed revenue"). An import
-- batch is a snapshot of what an external file said, checked AGAINST what
-- BackOffice already has recorded; reconciliation is the output (matched /
-- unmatched / variance), not a side door to create new authoritative rows.
-- bo_import_rows are evidence for that comparison, not expense records —
-- they live in their own table, never merged into bo_expenses automatically.
create table if not exists bo_import_batches (
  id uuid primary key default gen_random_uuid(),
  import_type text not null check (import_type in ('expenses','sales')),
  source_label text not null,          -- e.g. filename or "Kasikorn statement Jan 2026"
  imported_by text not null,
  row_count int not null default 0,
  valid_count int not null default 0,
  duplicate_count int not null default 0,
  invalid_count int not null default 0,
  matched_amount numeric(14,2) not null default 0,   -- sum of rows that matched an existing record
  unmatched_amount numeric(14,2) not null default 0, -- sum of rows with no match (needs follow-up)
  created_at timestamptz not null default now()
);
create table if not exists bo_import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references bo_import_batches(id) on delete cascade,
  row_number int not null,
  raw_date text,
  raw_amount text,
  raw_description text,
  parsed_date date,
  parsed_amount numeric(14,2),
  status text not null check (status in ('valid','duplicate','invalid','matched','unmatched')),
  reason text,                         -- why invalid, or what it matched/didn't match against
  matched_entity_type text,            -- 'expense' | 'order', when status is 'matched'
  matched_entity_id text
);
create index if not exists bo_import_rows_batch_idx on bo_import_rows (batch_id, row_number);

-- ========== RLS: same posture as 0001 ==========
do $$
declare t text;
begin
  for t in select unnest(array['bo_audit_log','bo_import_batches','bo_import_rows'])
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;
