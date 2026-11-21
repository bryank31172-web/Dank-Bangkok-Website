/* Runs supabase/migrations/0003_shift_maker.sql against real Postgres
   (PGlite, with the btree_gist extension Supabase also ships). The API tests
   use a fake PostgREST and cannot prove the exclusion constraint actually
   exists or does what the comments say — this file does. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sql = (f) => readFile(join(here, '..', 'supabase', 'migrations', f), 'utf8');
const [m1, m2, m3] = await Promise.all([sql('0001_dank_backoffice.sql'), sql('0002_dank_backoffice_audit_import.sql'), sql('0003_shift_maker.sql')]);

async function freshDb() {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(m1); await db.exec(m2); await db.exec(m3);
  await db.exec(`insert into bo_stores (id,name) values ('pattanakarn','Pattanakarn')`);
  const { rows } = await db.query(`insert into bo_schedule_periods (store_id,week_start) values ('pattanakarn','2026-11-16') returning id`);
  return { db, period: rows[0].id };
}
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const shift = (db, period, emp, s, e) => db.query(
  `insert into bo_shift_assignments (id,period_id,store_id,employee_id,starts_at,ends_at,created_by) values ($1,$2,'pattanakarn',$3,$4,$5,'test')`,
  [uuid(), period, emp, s, e]);

test('0003 runs on top of 0001+0002 and is idempotent', async () => {
  const { db } = await freshDb();
  await assert.doesNotReject(db.exec(m3));
  const { rows } = await db.query(`select table_name from information_schema.tables where table_name like 'bo_s%' order by 1`);
  const names = rows.map(r => r.table_name);
  for (const t of ['bo_shift_settings', 'bo_shift_templates', 'bo_staffing_requirements', 'bo_schedule_periods',
    'bo_shift_assignments', 'bo_schedule_publications', 'bo_staff_availability', 'bo_staff_leave',
    'bo_shift_change_requests', 'bo_staff_notifications']) assert.ok(names.includes(t), t);
});

test('same employee overlapping shifts are refused by the database (23P01)', async () => {
  const { db, period } = await freshDb();
  await shift(db, period, 'emma', '2026-11-17T09:00+07', '2026-11-17T17:00+07');
  await assert.rejects(shift(db, period, 'emma', '2026-11-17T13:00+07', '2026-11-17T21:00+07'), e => e.code === '23P01');
});

test('different employees at the same time are allowed (shared coverage)', async () => {
  const { db, period } = await freshDb();
  await shift(db, period, 'emma', '2026-11-17T09:00+07', '2026-11-17T17:00+07');
  await assert.doesNotReject(shift(db, period, 'noah', '2026-11-17T13:00+07', '2026-11-17T21:00+07'));
});

test('adjacent shifts (17:00 end, 17:00 start) do not overlap', async () => {
  const { db, period } = await freshDb();
  await shift(db, period, 'emma', '2026-11-17T09:00+07', '2026-11-17T17:00+07');
  await assert.doesNotReject(shift(db, period, 'emma', '2026-11-17T17:00+07', '2026-11-17T21:00+07'));
});

test('overnight overlap is caught across midnight', async () => {
  const { db, period } = await freshDb();
  await shift(db, period, 'liam', '2026-11-17T20:00+07', '2026-11-18T04:00+07');
  await assert.rejects(shift(db, period, 'liam', '2026-11-18T02:00+07', '2026-11-18T10:00+07'), e => e.code === '23P01');
});

test('a soft-deleted shift frees the slot again', async () => {
  const { db, period } = await freshDb();
  await shift(db, period, 'emma', '2026-11-17T09:00+07', '2026-11-17T17:00+07');
  await db.query(`update bo_shift_assignments set deleted_at = now() where employee_id='emma'`);
  await assert.doesNotReject(shift(db, period, 'emma', '2026-11-17T10:00+07', '2026-11-17T18:00+07'));
});

test('end before start and periods not starting Monday are rejected', async () => {
  const { db, period } = await freshDb();
  await assert.rejects(shift(db, period, 'emma', '2026-11-17T17:00+07', '2026-11-17T09:00+07'));
  await assert.rejects(db.query(`insert into bo_schedule_periods (store_id,week_start) values ('pattanakarn','2026-11-18')`));
});

test('publish is compare-and-swap on the period version', async () => {
  const { db, period } = await freshDb();
  const bumped = await db.query(`select bo_shift_bump_period($1) as v`, [period]);
  assert.equal(bumped.rows[0].v, 2);
  const stale = await db.query(`select * from bo_shift_publish($1,1,'[]','[]','[]','mgr')`, [period]);
  assert.equal(stale.rows[0].id, null, 'stale version publishes nothing');
  const ok = await db.query(`select * from bo_shift_publish($1,2,'[{"id":"a"}]','[]','[]','mgr')`, [period]);
  assert.equal(ok.rows[0].publication_no, 1);
  const again = await db.query(`select * from bo_shift_publish($1,2,'[]','[]','[]','mgr')`, [period]);
  assert.equal(again.rows[0].publication_no, 2);
  const p = await db.query(`select status, published_no from bo_schedule_periods where id=$1`, [period]);
  assert.deepEqual(p.rows[0], { status: 'published', published_no: 2 });
});

test('only one pending change request per person per shift', async () => {
  const { db, period } = await freshDb();
  await shift(db, period, 'emma', '2026-11-17T09:00+07', '2026-11-17T17:00+07');
  const { rows } = await db.query(`select id from bo_shift_assignments limit 1`);
  const ins = () => db.query(`insert into bo_shift_change_requests (requester_id,assignment_id,kind,reason) values ('emma',$1,'absence','sick')`, [rows[0].id]);
  await ins();
  await assert.rejects(ins());
});
