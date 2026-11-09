/* Runs supabase/migrations/0001_dank_backoffice.sql against a REAL Postgres
   engine — @electric-sql/pglite, Postgres compiled to WASM, no Docker/server
   needed. This exists because tests/backoffice.test.js only proves the
   api/backoffice/*.js endpoint LOGIC is correct against an in-memory fake of
   Supabase's REST surface; it can't catch a real SQL bug (a bad foreign key,
   a typo'd check constraint, a function that doesn't actually compile) since
   the fake doesn't enforce any of that. This file is the thing that actually
   runs the migration's SQL and plpgsql functions for real.

   This is the first npm dependency this repo has ever declared (see
   package.json) — deliberately a devDependency only. Nothing shipped to
   Vercel imports it; it's purely a local test tool, the same role
   playwright-core already plays for page tests (PROJECT-HANDOVER.md's
   Testing section). It does not add a build step to the deployed site. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationSql = await readFile(join(here, '..', 'supabase', 'migrations', '0001_dank_backoffice.sql'), 'utf8');
const migrationSql2 = await readFile(join(here, '..', 'supabase', 'migrations', '0002_dank_backoffice_audit_import.sql'), 'utf8');

async function freshDb() {
  const db = new PGlite();
  await db.exec(migrationSql);
  await db.exec(migrationSql2);
  return db;
}

test('the migration runs against real Postgres with no errors', async () => {
  await assert.doesNotReject(freshDb());
});

test('the migration is idempotent — running it twice does not error', async () => {
  const db = await freshDb();
  await assert.doesNotReject(db.exec(migrationSql));
});

test('every bo_* table from the schema doc actually exists after migrating', async () => {
  const db = await freshDb();
  const { rows } = await db.query(
    `select table_name from information_schema.tables where table_schema='public' and table_name like 'bo_%' order by table_name`
  );
  const names = rows.map((r) => r.table_name);
  for (const t of [
    'bo_stores', 'bo_product_settings', 'bo_product_stock_settings', 'bo_inventory_ledger',
    'bo_stocktakes', 'bo_stocktake_lines', 'bo_stock_transfers', 'bo_stock_transfer_lines',
    'bo_suppliers', 'bo_purchase_orders', 'bo_purchase_order_lines',
    'bo_ingredients', 'bo_recipes', 'bo_recipe_lines',
    'bo_kitchen_tickets', 'bo_kitchen_ticket_lines', 'bo_expenses',
  ]) assert.ok(names.includes(t), `${t} is missing`);
});

test('foreign keys are actually enforced, not just declared', async () => {
  const db = await freshDb();
  await db.exec(`insert into bo_stores (id, name) values ('pattanakarn','DANK Pattanakarn')`);
  await assert.rejects(
    db.exec(`insert into bo_product_stock_settings (product_key, store_id, low_stock_threshold) values ('sku-1','not-a-real-store',5)`),
    /foreign key|violates/i
  );
});

test('check constraints reject invalid enum-like values', async () => {
  const db = await freshDb();
  await db.exec(`insert into bo_stores (id, name) values ('pattanakarn','DANK Pattanakarn')`);
  await assert.rejects(
    db.exec(`insert into bo_inventory_ledger (item_type,item_key,store_id,qty_delta,balance_after,reason,staff_id) values ('bogus','sku-1','pattanakarn',1,1,'manual_adjust','tester')`),
    /violates check constraint/i
  );
  await assert.rejects(
    db.exec(`insert into bo_kitchen_tickets (store_id,status,created_by) values ('pattanakarn','bogus-status','tester')`),
    /violates check constraint/i
  );
});

test('column defaults from the DDL actually apply on insert', async () => {
  const db = await freshDb();
  await db.exec(`insert into bo_stores (id, name) values ('pattanakarn','DANK Pattanakarn')`);
  const supplier = await db.query(`insert into bo_suppliers (name) values ('Test Supplier') returning id`);
  const po = await db.query(
    `insert into bo_purchase_orders (po_number,supplier_id,store_id,created_by) values ('PO0001','${supplier.rows[0].id}','pattanakarn','tester') returning status`
  );
  assert.equal(po.rows[0].status, 'draft');
});

test('bo_ledger_adjust() computes balance_after correctly across repeated calls, scoped per item+store', async () => {
  const db = await freshDb();
  await db.exec(`insert into bo_stores (id, name) values ('pattanakarn','DANK Pattanakarn'), ('sathorn','DANK Sathorn')`);

  const r1 = await db.query(`select * from bo_ledger_adjust('product','sku-1','pattanakarn',10,'manual_adjust',null,null,'tester',null)`);
  assert.equal(Number(r1.rows[0].balance_after), 10);

  const r2 = await db.query(`select * from bo_ledger_adjust('product','sku-1','pattanakarn',-3,'manual_adjust',null,null,'tester',null)`);
  assert.equal(Number(r2.rows[0].balance_after), 7, 'accumulates from the prior real row, computed inside Postgres, not pre-supplied');

  const r3 = await db.query(`select * from bo_ledger_adjust('product','sku-1','sathorn',100,'manual_adjust',null,null,'tester',null)`);
  assert.equal(Number(r3.rows[0].balance_after), 100, 'a different store starts its own balance at 0, proving the scoping is per item+store');

  const count = await db.query(`select count(*)::int as n from bo_inventory_ledger`);
  assert.equal(count.rows[0].n, 3, 'append-only — three calls produced three rows, nothing was overwritten');
});

test('bo_next_po_number() produces sequential PO#### values from a real sequence', async () => {
  const db = await freshDb();
  const a = await db.query(`select bo_next_po_number() as n`);
  const b = await db.query(`select bo_next_po_number() as n`);
  assert.notEqual(a.rows[0].n, b.rows[0].n);
  assert.match(a.rows[0].n, /^PO\d{4}$/);
  assert.match(b.rows[0].n, /^PO\d{4}$/);
});

test('ON DELETE CASCADE removes purchase order lines when their order is deleted', async () => {
  const db = await freshDb();
  await db.exec(`insert into bo_stores (id, name) values ('pattanakarn','DANK Pattanakarn')`);
  const supplier = await db.query(`insert into bo_suppliers (name) values ('Test Supplier') returning id`);
  const po = await db.query(
    `insert into bo_purchase_orders (po_number,supplier_id,store_id,created_by) values ('PO0001','${supplier.rows[0].id}','pattanakarn','tester') returning id`
  );
  await db.exec(`insert into bo_purchase_order_lines (po_id,item_type,item_key,qty_ordered) values ('${po.rows[0].id}','product','sku-1',5)`);
  await db.exec(`delete from bo_purchase_orders where id = '${po.rows[0].id}'`);
  const orphans = await db.query(`select count(*)::int as n from bo_purchase_order_lines where po_id = '${po.rows[0].id}'`);
  assert.equal(orphans.rows[0].n, 0);
});

test('row level security is enabled on every bo_* table (matches site_kv\'s posture)', async () => {
  const db = await freshDb();
  const { rows } = await db.query(
    `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'bo_%' and c.relrowsecurity = false`
  );
  assert.deepEqual(rows, [], `these bo_* tables do NOT have RLS enabled: ${rows.map((r) => r.relname).join(', ')}`);
});

/* ---- migration 0002: audit log, recurring expenses, import/reconciliation ---- */

test('0002 adds bo_audit_log, bo_import_batches and bo_import_rows', async () => {
  const db = await freshDb();
  const { rows } = await db.query(
    `select table_name from information_schema.tables where table_schema='public' and table_name in ('bo_audit_log','bo_import_batches','bo_import_rows')`
  );
  assert.equal(rows.length, 3);
});

test('0002 adds next_generated and generated_from to bo_expenses, defaulting correctly', async () => {
  const db = await freshDb();
  const { rows } = await db.query(`insert into bo_expenses (category, amount, expense_date, created_by) values ('rent', 1000, '2026-01-01', 'tester') returning next_generated, generated_from`);
  assert.equal(rows[0].next_generated, false);
  assert.equal(rows[0].generated_from, null);
});

test('bo_audit_log rejects an unknown action value', async () => {
  const db = await freshDb();
  await assert.rejects(
    db.exec(`insert into bo_audit_log (actor_id,action,entity_type,entity_id) values ('tester','bogus-action','supplier','x')`),
    /violates check constraint/i
  );
});

test('bo_import_batches/bo_import_rows enforce their check constraints and cascade delete', async () => {
  const db = await freshDb();
  await assert.rejects(
    db.exec(`insert into bo_import_batches (import_type, source_label, imported_by) values ('bogus','x','tester')`),
    /violates check constraint/i
  );
  const batch = await db.query(`insert into bo_import_batches (import_type, source_label, imported_by) values ('expenses','test.csv','tester') returning id`);
  await db.exec(`insert into bo_import_rows (batch_id, row_number, status) values ('${batch.rows[0].id}', 1, 'invalid')`);
  await assert.rejects(
    db.exec(`insert into bo_import_rows (batch_id, row_number, status) values ('${batch.rows[0].id}', 2, 'bogus-status')`),
    /violates check constraint/i
  );
  await db.exec(`delete from bo_import_batches where id = '${batch.rows[0].id}'`);
  const orphans = await db.query(`select count(*)::int as n from bo_import_rows where batch_id = '${batch.rows[0].id}'`);
  assert.equal(orphans.rows[0].n, 0, 'ON DELETE CASCADE removed the rows with their batch');
});
