-- DANK BackOffice — Shift Maker & workforce scheduling.
-- Additive only: creates new bo_shift*/bo_schedule*/bo_staff* tables and two
-- functions. Alters nothing that exists. Same posture as 0001/0002: RLS on,
-- no policies, service-role only. Safe to re-run.
-- Run after 0001 and 0002. Spec: docs/dank-backoffice/SHIFT_MAKER.md.
--
-- employee_id everywhere is the staff ACCOUNT id from api/_staff-accounts.js
-- (site_kv key staff:accounts:v1). That list lives in site_kv, not in a table,
-- so it cannot be a foreign key; the API checks it exists on every write.

-- The exclusion constraint below needs btree_gist (gist index over a plain
-- text column). Supabase ships it; it installs into the "extensions" schema.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ========== Settings (one row per store, '*' = all stores) ==========
create table if not exists bo_shift_settings (
  store_id text primary key,
  settings jsonb not null default '{}'::jsonb,
  version int not null default 1,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ========== Shift templates ==========
create table if not exists bo_shift_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  role text,
  start_time time not null,
  end_time time not null,                  -- end <= start means it ends next day
  break_minutes int not null default 0 check (break_minutes between 0 and 600),
  store_id text references bo_stores(id),  -- null = every store
  sort_order int not null default 0,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== Minimum staffing targets ==========
create table if not exists bo_staffing_requirements (
  id uuid primary key default gen_random_uuid(),
  store_id text references bo_stores(id),  -- null = every store
  weekday smallint check (weekday between 0 and 6),  -- 0 = Monday … 6 = Sunday, null = every day
  on_date date,                            -- a one-off date overrides the weekday rule
  start_time time not null,
  end_time time not null,
  role text,                               -- null = any role
  min_staff int not null check (min_staff between 0 and 100),
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  check (weekday is null or on_date is null)
);
create index if not exists bo_staffing_requirements_store_idx on bo_staffing_requirements (store_id, active);

-- ========== Schedule periods (one per store per Monday-start week) ==========
create table if not exists bo_schedule_periods (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references bo_stores(id),
  week_start date not null,
  status text not null default 'draft' check (status in ('draft','published')),
  version int not null default 1,          -- bumped on every change inside the period
  published_no int not null default 0,     -- latest publication number, 0 = never
  published_version int,                   -- period version that publication captured
  published_at timestamptz,
  published_by text,
  created_at timestamptz not null default now(),
  unique (store_id, week_start),
  check (extract(isodow from week_start) = 1)
);

-- ========== Assignments (the editable draft) ==========
create table if not exists bo_shift_assignments (
  id uuid primary key,                     -- client-generated, so a retried create is a no-op
  period_id uuid not null references bo_schedule_periods(id),
  store_id text not null references bo_stores(id),
  employee_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  role text,
  template_id uuid references bo_shift_templates(id),
  break_minutes int not null default 0 check (break_minutes between 0 and 600),
  notes text check (notes is null or length(notes) <= 500),
  split_override boolean not null default false,
  copy_source_id uuid,                     -- set when created by Copy Previous Week
  version int not null default 1,
  deleted_at timestamptz,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  -- The authoritative double-booking guard. One employee can never hold two
  -- live shifts whose half-open ranges [start,end) intersect, however many
  -- managers are writing at once. Different employees are not constrained:
  -- two people on at the same time is shared coverage, not a conflict.
  constraint bo_shift_no_self_overlap exclude using gist (
    employee_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (deleted_at is null)
);
create index if not exists bo_shift_assignments_range_idx on bo_shift_assignments (store_id, starts_at) where deleted_at is null;
create index if not exists bo_shift_assignments_employee_idx on bo_shift_assignments (employee_id, starts_at) where deleted_at is null;
create index if not exists bo_shift_assignments_period_idx on bo_shift_assignments (period_id) where deleted_at is null;
create unique index if not exists bo_shift_assignments_copy_once on bo_shift_assignments (period_id, copy_source_id)
  where deleted_at is null and copy_source_id is not null;

-- ========== Publications (immutable snapshots staff actually read) ==========
create table if not exists bo_schedule_publications (
  id bigint generated always as identity primary key,
  period_id uuid not null references bo_schedule_periods(id),
  publication_no int not null,
  period_version int not null,
  assignments jsonb not null,              -- snapshot of the live rows at publish time
  warnings jsonb not null default '[]'::jsonb,
  acknowledged jsonb not null default '[]'::jsonb,  -- warnings the publisher accepted
  published_by text not null,
  published_at timestamptz not null default now(),
  unique (period_id, publication_no)
);

-- ========== Availability (informal; never a hard block on its own) ==========
create table if not exists bo_staff_availability (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  kind text not null check (kind in ('unavailable','preferred','available')),
  weekday smallint check (weekday between 0 and 6),
  on_date date,
  start_time time,                         -- null start+end = all day
  end_time time,
  reason text check (reason is null or length(reason) <= 300),
  status text not null default 'active' check (status in ('active','withdrawn')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (weekday is not null or on_date is not null)
);
create index if not exists bo_staff_availability_employee_idx on bo_staff_availability (employee_id, status);

-- ========== Leave (approved leave is a hard block) ==========
create table if not exists bo_staff_leave (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  leave_type text not null default 'personal' check (leave_type in ('annual','sick','personal','unpaid','other')),
  reason text check (reason is null or length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by text not null,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists bo_staff_leave_employee_idx on bo_staff_leave (employee_id, starts_at);

-- ========== Shift change requests from staff ==========
create table if not exists bo_shift_change_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id text not null,
  assignment_id uuid not null references bo_shift_assignments(id),
  kind text not null check (kind in ('change','absence','swap')),
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  swap_employee_id text,
  reason text not null check (length(reason) between 1 and 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'change' or (proposed_starts_at is not null and proposed_ends_at > proposed_starts_at)),
  check (kind <> 'swap' or swap_employee_id is not null)
);
-- One open request per person per shift; a double tap cannot file two.
create unique index if not exists bo_shift_change_requests_one_open
  on bo_shift_change_requests (requester_id, assignment_id) where status = 'pending';

-- ========== Internal notifications (deduplicated) ==========
create table if not exists bo_staff_notifications (
  id bigint generated always as identity primary key,
  employee_id text not null,
  kind text not null,
  title text not null,
  body text,
  ref_type text,
  ref_id text,
  dedupe_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bo_staff_notifications_employee_idx on bo_staff_notifications (employee_id, created_at desc);

-- ========== Atomic period version counter ==========
-- PostgREST cannot express "version = version + 1"; this does it in one
-- statement so two managers editing the same week always get distinct versions.
create or replace function bo_shift_bump_period(p_period_id uuid) returns int
language sql
as $$
  update bo_schedule_periods set version = version + 1 where id = p_period_id returning version;
$$;

-- Publish = compare-and-swap on the period version + snapshot insert, in one
-- transaction. Returns null when the period changed since the manager
-- reviewed it (the API turns that into a 409), so a stale review can never
-- publish over someone else's newer edit.
create or replace function bo_shift_publish(
  p_period_id uuid, p_expected_version int, p_assignments jsonb,
  p_warnings jsonb, p_acknowledged jsonb, p_actor text
) returns bo_schedule_publications
language plpgsql
as $$
declare
  v_period bo_schedule_periods;
  v_row bo_schedule_publications;
begin
  select * into v_period from bo_schedule_periods where id = p_period_id for update;
  if v_period.id is null or v_period.version <> p_expected_version then
    return null;
  end if;
  insert into bo_schedule_publications
    (period_id, publication_no, period_version, assignments, warnings, acknowledged, published_by)
  values
    (p_period_id, v_period.published_no + 1, v_period.version, coalesce(p_assignments,'[]'::jsonb),
     coalesce(p_warnings,'[]'::jsonb), coalesce(p_acknowledged,'[]'::jsonb), p_actor)
  returning * into v_row;
  update bo_schedule_periods
     set status = 'published', published_no = v_row.publication_no, published_version = v_period.version,
         published_at = v_row.published_at, published_by = p_actor
   where id = p_period_id;
  return v_row;
end;
$$;

-- ========== RLS: service-role only, same as 0001/0002 ==========
do $$
declare t text;
begin
  for t in select unnest(array[
    'bo_shift_settings','bo_shift_templates','bo_staffing_requirements','bo_schedule_periods',
    'bo_shift_assignments','bo_schedule_publications','bo_staff_availability','bo_staff_leave',
    'bo_shift_change_requests','bo_staff_notifications'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- The browser-facing keys must not be able to call the two functions either.
-- (Guarded: these roles exist on Supabase but not in a bare Postgres.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function bo_shift_bump_period(uuid) from anon, authenticated, public;
    revoke execute on function bo_shift_publish(uuid,int,jsonb,jsonb,jsonb,text) from anon, authenticated, public;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function bo_shift_bump_period(uuid) to service_role;
    grant execute on function bo_shift_publish(uuid,int,jsonb,jsonb,jsonb,text) to service_role;
  end if;
end $$;
