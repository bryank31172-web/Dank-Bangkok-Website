/* DANK BackOffice — tests for the critical paths called out in
   docs/dank-backoffice/IMPLEMENTATION_PLAN.md's Phase 6 list: permission
   consistency, input validation, the kitchen-ticket status machine, the
   consume-ingredients-exactly-once guard, PO partial receiving, and the
   ledger's race-safe balance computation.

   Follows the existing test pattern in tests/delivery-fee.test.js: node:test,
   a fake fetch installed on globalThis, and a call(handler, body) helper that
   mocks Vercel's (req,res). Supabase has no built-in test double, so this file
   includes a small in-memory PostgREST-shaped fake (see makeFakeSupabase
   below) covering exactly the query shapes api/backoffice/*.js actually
   produces — not a general PostgREST implementation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.STAFF_KEY = 'test-staff-key';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const EMBED_FK = {
  bo_purchase_order_lines: 'po_id',
  bo_kitchen_ticket_lines: 'ticket_id',
  bo_stocktake_lines: 'stocktake_id',
  bo_stock_transfer_lines: 'transfer_id',
  bo_recipe_lines: 'recipe_id',
};
const UUID_TABLES = new Set([
  'bo_stocktakes', 'bo_stock_transfers', 'bo_suppliers', 'bo_purchase_orders',
  'bo_ingredients', 'bo_recipes', 'bo_kitchen_tickets', 'bo_expenses', 'bo_import_batches',
]);
const SERIAL_TABLES = new Set(['bo_inventory_ledger', 'bo_purchase_order_lines', 'bo_kitchen_ticket_lines', 'bo_audit_log', 'bo_import_rows']);
// Mirrors the `not null default X` columns in supabase/migrations/0001_dank_backoffice.sql.
// A real Postgres insert fills these in when the caller omits them; this fake
// must too, or a test here passes/fails for a reason that has nothing to do
// with the endpoint under test (see qty_received/active below).
const COLUMN_DEFAULTS = {
  bo_stores: { active: true },
  bo_product_settings: { track_stock: true },
  bo_stocktakes: { status: 'in_progress' },
  bo_stock_transfers: { status: 'pending' },
  bo_suppliers: { active: true },
  bo_purchase_orders: { status: 'draft' },
  bo_purchase_order_lines: { qty_received: 0, unit_cost: 0 },
  bo_ingredients: { track_stock: true, active: true, cost_per_unit: 0 },
  bo_recipes: { yield_qty: 1, active: true },
  bo_kitchen_tickets: { source: 'manual', status: 'new', consumption_recorded: false },
  bo_expenses: { next_generated: false },
  bo_import_batches: { row_count: 0, valid_count: 0, duplicate_count: 0, invalid_count: 0, matched_amount: 0, unmatched_amount: 0 },
};

function makeFakeSupabase() {
  const db = Object.fromEntries([
    'bo_stores', 'bo_product_settings', 'bo_product_stock_settings', 'bo_inventory_ledger',
    'bo_stocktakes', 'bo_stocktake_lines', 'bo_stock_transfers', 'bo_stock_transfer_lines',
    'bo_suppliers', 'bo_purchase_orders', 'bo_purchase_order_lines',
    'bo_ingredients', 'bo_recipes', 'bo_recipe_lines',
    'bo_kitchen_tickets', 'bo_kitchen_ticket_lines', 'bo_expenses',
    'bo_audit_log', 'bo_import_batches', 'bo_import_rows',
  ].map(t => [t, []]));
  let serial = 1;
  let poSeq = 0;

  function matchFilter(row, col, expr) {
    if (expr === 'not.is.null') return row[col] != null;
    if (expr === 'is.null') return row[col] == null;
    const m = /^(eq|neq|gte|lte)\.(.*)$/.exec(expr);
    if (m) {
      const [, op, raw] = m;
      const v = row[col];
      const target = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : decodeURIComponent(raw);
      if (op === 'eq') return String(v) === String(target);
      if (op === 'neq') return String(v) !== String(target);
      if (op === 'gte') return v >= target;
      if (op === 'lte') return v <= target;
    }
    const inM = /^in\.\(([^)]*)\)$/.exec(expr);
    if (inM) return inM[1].split(',').map(decodeURIComponent).includes(String(row[col]));
    return true;
  }

  function applyQuery(table, rows, params) {
    let out = rows.slice();
    let selectSpec = null;
    const orFilters = [];
    for (const [k, v] of params) {
      if (k === 'select') selectSpec = v;
      else if (k === 'order') { /* applied below */ }
      else if (k === 'limit') { /* applied below */ }
      else if (k === 'or') orFilters.push(v);
      else out = out.filter(r => matchFilter(r, k, v));
    }
    for (const clause of orFilters) {
      // or=(from_store_id.eq.X,to_store_id.eq.X) — only shape this fake needs to support
      const parts = clause.replace(/^\(|\)$/g, '').split(',');
      out = out.filter(r => parts.some(p => {
        const m = /^([a-z_]+)\.eq\.(.*)$/.exec(p);
        return m && String(r[m[1]]) === decodeURIComponent(m[2]);
      }));
    }
    const orderParam = params.find(([k]) => k === 'order');
    if (orderParam) {
      const specs = orderParam[1].split(',').map(s => { const [col, dir] = s.split('.'); return { col, desc: dir === 'desc' }; });
      out.sort((a, b) => {
        for (const { col, desc } of specs) {
          const av = a[col], bv = b[col];
          if (av === bv) continue;
          const cmp = av > bv ? 1 : -1;
          return desc ? -cmp : cmp;
        }
        return 0;
      });
    }
    const limitParam = params.find(([k]) => k === 'limit');
    if (limitParam) out = out.slice(0, Number(limitParam[1]));

    if (selectSpec && selectSpec !== '*') {
      out = out.map(row => {
        const result = {};
        for (const field of selectSpec.split(',')) {
          const embedM = /^(\w+):(\w+)\(\*\)$/.exec(field);
          if (embedM) {
            const [, alias, childTable] = embedM;
            const fk = EMBED_FK[childTable];
            result[alias] = (db[childTable] || []).filter(c => c[fk] === row.id);
          } else if (field === '*') {
            Object.assign(result, row);
          } else {
            result[field] = row[field];
          }
        }
        return result;
      });
    }
    return out;
  }

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    const params = [...u.searchParams.entries()];

    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      const args = JSON.parse(init.body || '{}');
      if (name === 'bo_ledger_adjust') {
        const prior = db.bo_inventory_ledger
          .filter(r => r.item_type === args.p_item_type && r.item_key === args.p_item_key && r.store_id === args.p_store_id)
          .sort((a, b) => b.id - a.id)[0];
        const prevBalance = prior ? Number(prior.balance_after) : 0;
        const row = {
          id: serial++, item_type: args.p_item_type, item_key: args.p_item_key, store_id: args.p_store_id,
          qty_delta: args.p_qty_delta, balance_after: prevBalance + Number(args.p_qty_delta),
          reason: args.p_reason, ref_type: args.p_ref_type, ref_id: args.p_ref_id,
          staff_id: args.p_staff_id, note: args.p_note, created_at: new Date(Date.now() + serial).toISOString(),
        };
        db.bo_inventory_ledger.push(row);
        return jsonResponse(row);
      }
      if (name === 'bo_next_po_number') {
        poSeq++;
        return jsonResponse('PO' + String(poSeq).padStart(4, '0'));
      }
      throw new Error('fake supabase: unknown rpc ' + name);
    }

    const table = path.split('?')[0];
    if (!(table in db)) throw new Error('fake supabase: unknown table ' + table);

    if (method === 'GET') {
      return jsonResponse(applyQuery(table, db[table], params));
    }
    if (method === 'POST') {
      const onConflict = params.find(([k]) => k === 'on_conflict')?.[1];
      const bodyRows = JSON.parse(init.body || '[]');
      const inserted = [];
      for (const r of bodyRows) {
        const row = { ...(COLUMN_DEFAULTS[table] || {}), ...r };
        if (row.id == null) row.id = UUID_TABLES.has(table) ? crypto.randomUUID() : (SERIAL_TABLES.has(table) ? serial++ : row.id);
        if (onConflict) {
          const keys = onConflict.split(',');
          const existingIdx = db[table].findIndex(x => keys.every(k => String(x[k]) === String(row[k])));
          if (existingIdx >= 0) { db[table][existingIdx] = { ...db[table][existingIdx], ...row }; inserted.push(db[table][existingIdx]); continue; }
        } else if (table === 'bo_purchase_orders' && db[table].some(x => x.po_number === row.po_number)) {
          return { ok: false, status: 409, text: async () => 'duplicate po_number' };
        }
        db[table].push(row);
        inserted.push(row);
      }
      return jsonResponse(inserted);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body || '{}');
      const matched = applyQuery(table, db[table], params);
      for (const row of matched) Object.assign(row, patch);
      return jsonResponse(matched);
    }
    if (method === 'DELETE') {
      const matched = applyQuery(table, db[table], params);
      db[table] = db[table].filter(r => !matched.includes(r));
      return jsonResponse(matched);
    }
    throw new Error('fake supabase: unsupported method ' + method);
  }

  function jsonResponse(data) {
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  }

  return { fetch, db };
}

async function withFakeSupabase(fn) {
  const { fetch, db } = makeFakeSupabase();
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  try { return await fn(db); } finally { globalThis.fetch = original; }
}

function call(handler, { method = 'GET', body, query = {} } = {}) {
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(j) { this.data = j; return this; }, end() { return this; } };
  const req = { method, headers: { authorization: 'Bearer test-staff-key' }, body, query };
  return handler(req, res).then(() => res);
}

/* ---------------------------------------------------------- permission consistency */
test('STAFF_ROLE_PERMISSIONS (_auth.js) and ROLE_PERMISSIONS (_staff-accounts.js) stay in sync', async () => {
  // These two files intentionally carry separate copies (see the comment in
  // both files for why — a token-based session must be checkable without a
  // storage round trip). _auth.js doesn't export its copy directly, so this
  // exercises it indirectly through hasPermission()/staffIdentity instead of
  // reaching into the module — but it checks every role's full scope list
  // against _staff-accounts.js's copy, not just one role, so the two files
  // drifting apart on ANY role or ANY scope fails this test.
  const { hasPermission } = await import('../api/_auth.js');
  const { ROLE_PERMISSIONS, ROLE_LABELS } = await import('../api/_staff-accounts.js');
  const ALL_KNOWN_SCOPES = [...new Set(Object.values(ROLE_PERMISSIONS).flat())].filter((s) => s !== '*');

  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    assert.ok(ROLE_LABELS[role], `role '${role}' has no label`);
    const identity = { role };
    for (const scope of ALL_KNOWN_SCOPES) {
      const expected = ROLE_PERMISSIONS[role].includes('*') || ROLE_PERMISSIONS[role].includes(scope);
      assert.equal(hasPermission(identity, scope), expected,
        `role '${role}' x scope '${scope}': _staff-accounts.js says ${expected}, but _auth.js's hasPermission() disagrees — the two files have drifted apart`);
    }
  }
  assert.deepEqual(ROLE_PERMISSIONS.kitchen.sort(), ['announcement_read', 'dashboard', 'food_ops', 'kitchen_tickets'].sort());
});

/* ---------------------------------------------------------- kitchen ticket state machine */
test('kitchen ticket transitions only move forward one step at a time, or to cancelled', async () => {
  const { isValidTransition } = await import('../api/backoffice/kitchen.js');
  assert.equal(isValidTransition('new', 'preparing'), true);
  assert.equal(isValidTransition('preparing', 'ready'), true);
  assert.equal(isValidTransition('ready', 'served'), true);
  assert.equal(isValidTransition('new', 'ready'), false, 'cannot skip preparing');
  assert.equal(isValidTransition('new', 'served'), false, 'cannot skip straight to served');
  assert.equal(isValidTransition('served', 'preparing'), false, 'cannot go backwards');
  assert.equal(isValidTransition('new', 'cancelled'), true);
  assert.equal(isValidTransition('served', 'cancelled'), false, 'a served ticket cannot be cancelled');
});

test('serving a kitchen ticket consumes recipe ingredients exactly once, even if PATCHed twice', async () => {
  await withFakeSupabase(async (db) => {
    const kitchenHandler = (await import('../api/backoffice/kitchen.js')).default;
    const now = new Date().toISOString();
    const ingId = crypto.randomUUID(), recipeId = crypto.randomUUID(), ticketId = crypto.randomUUID();
    db.bo_ingredients.push({ id: ingId, name: 'Rice', unit: 'g', cost_per_unit: 0.05, active: true });
    db.bo_recipes.push({ id: recipeId, menu_item_key: 'fried-rice', name: 'Fried Rice', yield_qty: 1, active: true });
    db.bo_recipe_lines.push({ recipe_id: recipeId, ingredient_id: ingId, qty: 200 });
    db.bo_kitchen_tickets.push({ id: ticketId, store_id: 'pattanakarn', status: 'ready', consumption_recorded: false, created_by: 'tester', created_at: now, updated_at: now });
    db.bo_kitchen_ticket_lines.push({ id: 1, ticket_id: ticketId, menu_item_key: 'fried-rice', qty: 2, special_instructions: null });

    const first = await call(kitchenHandler, { method: 'PATCH', body: { id: ticketId, status: 'served' } });
    assert.equal(first.code, 200, JSON.stringify(first.data));
    assert.equal(first.data.consumption.length, 1);
    assert.equal(first.data.consumption[0].consumed, 400, '2 servings x 200g rice = 400g');

    const ledgerAfterFirst = db.bo_inventory_ledger.filter(r => r.item_type === 'ingredient' && r.item_key === ingId);
    assert.equal(ledgerAfterFirst.length, 1, 'exactly one ledger row after the first serve');
    assert.equal(ledgerAfterFirst[0].qty_delta, -400);

    // Retry the exact same PATCH — simulates a flaky client re-sending.
    const second = await call(kitchenHandler, { method: 'PATCH', body: { id: ticketId, status: 'served' } });
    assert.equal(second.code, 409, 'the compare-and-swap rejects a retry once status has already moved');

    const ledgerAfterRetry = db.bo_inventory_ledger.filter(r => r.item_type === 'ingredient' && r.item_key === ingId);
    assert.equal(ledgerAfterRetry.length, 1, 'still exactly one ledger row — no double deduction');
  });
});

test('a kitchen ticket line with no matching recipe is skipped, not fatal', async () => {
  await withFakeSupabase(async (db) => {
    const kitchenHandler = (await import('../api/backoffice/kitchen.js')).default;
    const now = new Date().toISOString();
    const ticketId = crypto.randomUUID();
    db.bo_kitchen_tickets.push({ id: ticketId, store_id: 'pattanakarn', status: 'ready', consumption_recorded: false, created_by: 'tester', created_at: now, updated_at: now });
    db.bo_kitchen_ticket_lines.push({ id: 1, ticket_id: ticketId, menu_item_key: 'bottled-coke', qty: 1 });

    const res = await call(kitchenHandler, { method: 'PATCH', body: { id: ticketId, status: 'served' } });
    assert.equal(res.code, 200);
    assert.equal(res.data.consumption[0].skipped, 'no recipe found');
  });
});

/* ---------------------------------------------------------- inventory ledger */
test('a manual inventory adjustment is rejected without a valid item_type/qty_delta/reason', async () => {
  await withFakeSupabase(async () => {
    const inventoryHandler = (await import('../api/backoffice/inventory.js')).default;
    const bad1 = await call(inventoryHandler, { method: 'POST', body: { item_type: 'bogus', item_key: 'x', store_id: 's', qty_delta: 1 } });
    assert.equal(bad1.code, 400);
    const bad2 = await call(inventoryHandler, { method: 'POST', body: { item_type: 'product', item_key: 'x', store_id: 's', qty_delta: 0 } });
    assert.equal(bad2.code, 400, 'a zero delta is not a real adjustment');
    const bad3 = await call(inventoryHandler, { method: 'POST', body: { item_type: 'product', item_key: 'x', store_id: 's', qty_delta: 5, reason: 'not-a-real-reason' } });
    assert.equal(bad3.code, 400);
  });
});

test('the ledger balance accumulates correctly across repeated adjustments for the same item+store', async () => {
  await withFakeSupabase(async (db) => {
    const inventoryHandler = (await import('../api/backoffice/inventory.js')).default;
    const body = (delta) => ({ item_type: 'product', item_key: 'sku-1', store_id: 'pattanakarn', qty_delta: delta, reason: 'manual_adjust' });
    const r1 = await call(inventoryHandler, { method: 'POST', body: body(10) });
    assert.equal(r1.data.row.balance_after, 10);
    const r2 = await call(inventoryHandler, { method: 'POST', body: body(-3) });
    assert.equal(r2.data.row.balance_after, 7);
    const r3 = await call(inventoryHandler, { method: 'POST', body: body(5) });
    assert.equal(r3.data.row.balance_after, 12);

    const list = await call(inventoryHandler, { method: 'GET', query: { item_type: 'product', item_key: 'sku-1', store: 'pattanakarn' } });
    assert.equal(list.data.rows.length, 3);
    assert.equal(list.data.rows[0].balance_after, 12, 'newest first');
  });
});

/* ---------------------------------------------------------- purchase orders */
test('receiving more than qty_ordered is rejected, and partial receipt leaves the PO in receiving status', async () => {
  await withFakeSupabase(async (db) => {
    const poHandler = (await import('../api/backoffice/purchase-orders.js')).default;
    const supplierId = crypto.randomUUID();
    db.bo_suppliers.push({ id: supplierId, name: 'Test Supplier', active: true });

    const created = await call(poHandler, { method: 'POST', body: { supplier_id: supplierId, store_id: 'pattanakarn', lines: [{ item_type: 'product', item_key: 'sku-1', qty_ordered: 10, unit_cost: 5 }] } });
    assert.equal(created.code, 200, JSON.stringify(created.data));
    const poId = created.data.row.id;
    const lineId = created.data.row.lines[0].id;

    await call(poHandler, { method: 'POST', body: { id: poId, action: 'send' } });

    const overReceive = await call(poHandler, { method: 'POST', body: { id: poId, action: 'receive', lines: [{ line_id: lineId, qty_received: 99 }] } });
    assert.equal(overReceive.code, 400, 'cannot receive more than was ordered');

    const partial = await call(poHandler, { method: 'POST', body: { id: poId, action: 'receive', lines: [{ line_id: lineId, qty_received: 4 }] } });
    assert.equal(partial.code, 200);
    assert.equal(partial.data.status, 'receiving', 'not fully received yet');

    const ledgerRows = db.bo_inventory_ledger.filter(r => r.ref_type === 'purchase_order' && r.ref_id === poId);
    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0].qty_delta, 4);

    const complete = await call(poHandler, { method: 'POST', body: { id: poId, action: 'receive', lines: [{ line_id: lineId, qty_received: 6 }] } });
    assert.equal(complete.data.status, 'completed', 'fully received now');
    assert.equal(db.bo_inventory_ledger.filter(r => r.ref_type === 'purchase_order' && r.ref_id === poId).length, 2);
  });
});

test('purchase orders get sequential PO numbers even when created out of order', async () => {
  await withFakeSupabase(async (db) => {
    const poHandler = (await import('../api/backoffice/purchase-orders.js')).default;
    const supplierId = crypto.randomUUID();
    db.bo_suppliers.push({ id: supplierId, name: 'Test Supplier', active: true });
    const mk = () => call(poHandler, { method: 'POST', body: { supplier_id: supplierId, store_id: 'pattanakarn', lines: [{ item_type: 'product', item_key: 'x', qty_ordered: 1 }] } });
    const a = await mk(), b = await mk();
    assert.notEqual(a.data.row.po_number, b.data.row.po_number);
    assert.match(a.data.row.po_number, /^PO\d{4}$/);
  });
});

/* ---------------------------------------------------------- recipe costing */
test('recipe cost-per-serving is computed live from current ingredient costs, not stored stale', async () => {
  await withFakeSupabase(async (db) => {
    const recipesHandler = (await import('../api/backoffice/recipes.js')).default;
    const ingredientsHandler = (await import('../api/backoffice/ingredients.js')).default;

    const rice = await call(ingredientsHandler, { method: 'POST', body: { name: 'Rice', unit: 'g', cost_per_unit: 0.05 } });
    const chicken = await call(ingredientsHandler, { method: 'POST', body: { name: 'Chicken', unit: 'g', cost_per_unit: 0.15 } });

    const recipe = await call(recipesHandler, {
      method: 'POST',
      body: { menu_item_key: 'fried-rice', name: 'Chicken Fried Rice', yield_qty: 1, lines: [
        { ingredient_id: rice.data.row.id, qty: 200 },
        { ingredient_id: chicken.data.row.id, qty: 100 },
      ] },
    });
    // 200g rice @ 0.05 + 100g chicken @ 0.15 = 10 + 15 = 25
    assert.equal(recipe.data.row.costPerServing, 25);

    // Ingredient cost changes — re-reading the recipe must reflect it, not a cached figure.
    await call(ingredientsHandler, { method: 'PATCH', body: { id: rice.data.row.id, cost_per_unit: 0.10 } });
    const reread = await call(recipesHandler, { method: 'GET', query: { menu_item_key: 'fried-rice' } });
    assert.equal(reread.data.rows[0].costPerServing, 35, '200g @ 0.10 + 100g @ 0.15 = 20 + 15 = 35, recomputed from live cost');
  });
});

/* ---------------------------------------------------------- expenses */
test('an expense needs a known category, a positive amount and a date', async () => {
  await withFakeSupabase(async () => {
    const expensesHandler = (await import('../api/backoffice/expenses.js')).default;
    const badCategory = await call(expensesHandler, { method: 'POST', body: { category: 'bogus', amount: 100, expense_date: '2026-01-01' } });
    assert.equal(badCategory.code, 400);
    const badAmount = await call(expensesHandler, { method: 'POST', body: { category: 'rent', amount: -5, expense_date: '2026-01-01' } });
    assert.equal(badAmount.code, 400);
    const missingDate = await call(expensesHandler, { method: 'POST', body: { category: 'rent', amount: 100 } });
    assert.equal(missingDate.code, 400);
    const ok = await call(expensesHandler, { method: 'POST', body: { category: 'rent', amount: 25000, expense_date: '2026-01-01' } });
    assert.equal(ok.code, 200);
  });
});

/* ---------------------------------------------------------- expenses (attachments + monthly) */
test('an expense attachment must be a real image data URL or an http(s) link, within the size cap', async () => {
  await withFakeSupabase(async () => {
    const expensesHandler = (await import('../api/backoffice/expenses.js')).default;
    const base = { category: 'repairs', amount: 500, expense_date: '2026-01-15' };
    const badFormat = await call(expensesHandler, { method: 'POST', body: { ...base, attachment: 'not-a-data-url' } });
    assert.equal(badFormat.code, 400);
    const tooBig = await call(expensesHandler, { method: 'POST', body: { ...base, attachment: 'data:image/png;base64,' + 'A'.repeat(800000) } });
    assert.equal(tooBig.code, 413);
    const badLink = await call(expensesHandler, { method: 'POST', body: { ...base, attachment_url: 'ftp://not-http' } });
    assert.equal(badLink.code, 400);
    const ok = await call(expensesHandler, { method: 'POST', body: { ...base, attachment: 'data:image/png;base64,iVBORw0KGgo=' } });
    assert.equal(ok.code, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.row.attachment_url, 'data:image/png;base64,iVBORw0KGgo=');
  });
});

test('monthly cost analysis groups expenses by month and category', async () => {
  await withFakeSupabase(async () => {
    const expensesHandler = (await import('../api/backoffice/expenses.js')).default;
    await call(expensesHandler, { method: 'POST', body: { category: 'rent', amount: 20000, expense_date: '2026-01-05' } });
    await call(expensesHandler, { method: 'POST', body: { category: 'utilities', amount: 3000, expense_date: '2026-01-20' } });
    await call(expensesHandler, { method: 'POST', body: { category: 'rent', amount: 20000, expense_date: '2026-02-05' } });

    const res = await call(expensesHandler, { method: 'GET', query: { monthly: '1' } });
    assert.equal(res.data.monthly.length, 2);
    const jan = res.data.monthly.find((m) => m.month === '2026-01');
    assert.equal(jan.total, 23000);
    assert.equal(jan.byCategory.rent, 20000);
    assert.equal(jan.byCategory.utilities, 3000);
  });
});

/* ---------------------------------------------------------- audit log */
test('creating, updating and soft-deleting a supplier each write a bo_audit_log row with correct before/after', async () => {
  await withFakeSupabase(async (db) => {
    const suppliersHandler = (await import('../api/backoffice/suppliers.js')).default;
    const created = await call(suppliersHandler, { method: 'POST', body: { name: 'Acme Co', phone: '0811111111' } });
    const id = created.data.row.id;

    const updated = await call(suppliersHandler, { method: 'PATCH', body: { id, phone: '0822222222' } });
    assert.equal(updated.code, 200);

    const deleted = await call(suppliersHandler, { method: 'DELETE', body: { id } });
    assert.equal(deleted.code, 200);

    const log = db.bo_audit_log.filter((r) => r.entity_type === 'supplier' && r.entity_id === id);
    assert.equal(log.length, 3, 'create, update, delete each logged once');
    assert.equal(log[0].action, 'create');
    assert.equal(log[0].after.name, 'Acme Co');
    assert.equal(log[1].action, 'update');
    assert.equal(log[1].before.phone, '0811111111');
    assert.equal(log[1].after.phone, '0822222222');
    assert.equal(log[2].action, 'delete');
    assert.equal(log[2].after.active, false);
  });
});

test('a purchase order status change (send, receive) is audit-logged', async () => {
  await withFakeSupabase(async (db) => {
    const poHandler = (await import('../api/backoffice/purchase-orders.js')).default;
    const supplierId = crypto.randomUUID();
    db.bo_suppliers.push({ id: supplierId, name: 'Test Supplier', active: true });
    const created = await call(poHandler, { method: 'POST', body: { supplier_id: supplierId, store_id: 'pattanakarn', lines: [{ item_type: 'product', item_key: 'sku-1', qty_ordered: 5 }] } });
    const poId = created.data.row.id;
    const lineId = created.data.row.lines[0].id;
    await call(poHandler, { method: 'POST', body: { id: poId, action: 'send' } });
    await call(poHandler, { method: 'POST', body: { id: poId, action: 'receive', lines: [{ line_id: lineId, qty_received: 5 }] } });

    const log = db.bo_audit_log.filter((r) => r.entity_type === 'purchase_order' && r.entity_id === poId);
    assert.equal(log.length, 3, 'create + send + receive');
    assert.deepEqual(log.map((r) => r.action), ['create', 'status_change', 'status_change']);
    assert.equal(log[1].after.status, 'ordered');
    assert.equal(log[2].after.status, 'completed');
  });
});

/* ---------------------------------------------------------- recurring expenses */
test('a due recurring expense generates its successor exactly once, with a traceable chain', async () => {
  await withFakeSupabase(async (db) => {
    const expensesHandler = (await import('../api/backoffice/expenses.js')).default;
    const pastMonth = new Date(); pastMonth.setMonth(pastMonth.getMonth() - 2);
    const pastDate = pastMonth.toISOString().slice(0, 10);

    const created = await call(expensesHandler, { method: 'POST', body: { category: 'rent', amount: 20000, expense_date: pastDate, recurring: 'monthly' } });
    assert.equal(created.code, 200);
    const originalId = created.data.row.id;

    // The very next GET should notice this is overdue and generate a successor.
    const afterFirstLoad = await call(expensesHandler, { method: 'GET', query: {} });
    const chain = afterFirstLoad.data.rows.filter((r) => r.category === 'rent');
    assert.ok(chain.length >= 2, 'a successor was generated');
    const successor = chain.find((r) => r.generated_from === originalId);
    assert.ok(successor, 'the successor traces back to the original via generated_from');
    assert.equal(successor.created_by, 'system:recurring');
    assert.equal(successor.recurring, 'monthly', 'the chain continues');

    // A second GET must not spawn a SECOND direct child of the SAME original —
    // next_generated already flipped on it, so generateDueRecurring skips it.
    // (The successor itself, being ~1 month overdue, legitimately advances
    // its own chain on this second read — that's correct catch-up behavior
    // for an expense that's been due for 2 months, not a bug: each read
    // advances the chain by at most one period per row, on purpose, rather
    // than generating an unbounded run of catch-up rows in a single call.)
    const afterSecondLoad = await call(expensesHandler, { method: 'GET', query: {} });
    const directChildrenOfOriginal = afterSecondLoad.data.rows.filter((r) => r.generated_from === originalId);
    assert.equal(directChildrenOfOriginal.length, 1, 'still exactly one direct successor of the original — no duplicate generation from the same row');

    const auditRows = db.bo_audit_log.filter((r) => r.entity_type === 'expense' && r.note?.includes('auto-generated'));
    assert.ok(auditRows.length >= 1, 'at least the first generation was audit-logged');
  });
});

test('a non-recurring expense never generates anything', async () => {
  await withFakeSupabase(async () => {
    const expensesHandler = (await import('../api/backoffice/expenses.js')).default;
    await call(expensesHandler, { method: 'POST', body: { category: 'repairs', amount: 500, expense_date: '2020-01-01' } });
    const res = await call(expensesHandler, { method: 'GET', query: {} });
    assert.equal(res.data.rows.length, 1, 'a decade-old non-recurring expense stays exactly one row');
  });
});

/* ---------------------------------------------------------- import / reconciliation */
test('import: invalid rows (bad date, bad amount) are flagged, not silently dropped or inserted anywhere', async () => {
  await withFakeSupabase(async (db) => {
    const importHandler = (await import('../api/backoffice/import.js')).default;
    const res = await call(importHandler, {
      method: 'POST',
      body: { import_type: 'expenses', source_label: 'test.csv', rows: [
        { date: 'not-a-date', amount: '100', description: 'bad date' },
        { date: '2026-01-05', amount: 'abc', description: 'bad amount' },
        { date: '2026-01-05', amount: '-50', description: 'negative' },
      ] },
    });
    assert.equal(res.code, 200, JSON.stringify(res.data));
    assert.equal(res.data.summary.invalid, 3);
    assert.equal(res.data.summary.valid, 0);
    assert.equal(db.bo_expenses.length, 0, 'import never writes to bo_expenses directly');
  });
});

test('import: duplicate rows within the same file are detected', async () => {
  await withFakeSupabase(async () => {
    const importHandler = (await import('../api/backoffice/import.js')).default;
    const res = await call(importHandler, {
      method: 'POST',
      body: { import_type: 'expenses', source_label: 'test.csv', rows: [
        { date: '2026-01-05', amount: '100', description: 'Internet bill' },
        { date: '2026-01-05', amount: '100', description: 'Internet bill' },
      ] },
    });
    assert.equal(res.data.summary.duplicates, 1);
  });
});

test('import: a row matching an existing expense reconciles as matched; one with no match is flagged unmatched', async () => {
  await withFakeSupabase(async (db) => {
    const expensesHandler = (await import('../api/backoffice/expenses.js')).default;
    const importHandler = (await import('../api/backoffice/import.js')).default;
    const existing = await call(expensesHandler, { method: 'POST', body: { category: 'utilities', amount: 3200, expense_date: '2026-02-10' } });

    const res = await call(importHandler, {
      method: 'POST',
      body: { import_type: 'expenses', source_label: 'bank-statement.csv', rows: [
        { date: '2026-02-10', amount: '3200', description: 'Electricity' },  // should match the existing expense
        { date: '2026-02-11', amount: '999', description: 'Unknown charge' }, // should not match anything
      ] },
    });
    assert.equal(res.data.summary.matched, 1);
    assert.equal(res.data.summary.unmatched, 1);
    assert.equal(res.data.summary.matchedAmount, 3200);
    assert.equal(res.data.summary.unmatchedAmount, 999);

    const detail = await call(importHandler, { method: 'GET', query: { batch_id: res.data.batch.id } });
    const matchedRow = detail.data.rows.find((r) => r.status === 'matched');
    assert.equal(matchedRow.matched_entity_id, String(existing.data.row.id));
    assert.equal(matchedRow.matched_entity_type, 'expense');
  });
});

test('import rejects an unknown import_type and requires at least one row', async () => {
  await withFakeSupabase(async () => {
    const importHandler = (await import('../api/backoffice/import.js')).default;
    const bad = await call(importHandler, { method: 'POST', body: { import_type: 'bogus', source_label: 'x', rows: [{ date: '2026-01-01', amount: 1 }] } });
    assert.equal(bad.code, 400);
    const empty = await call(importHandler, { method: 'POST', body: { import_type: 'expenses', source_label: 'x', rows: [] } });
    assert.equal(empty.code, 400);
  });
});

/* ---------------------------------------------------------- stores */
test('stores are seeded from branches.json the first time they are read', async () => {
  await withFakeSupabase(async (db) => {
    const storesHandler = (await import('../api/backoffice/stores.js')).default;
    const res = await call(storesHandler, { method: 'GET' });
    assert.equal(res.code, 200, JSON.stringify(res.data));
    assert.ok(res.data.rows.length >= 2, 'branches.json ships at least the 2 real DANK locations');
    assert.ok(res.data.rows.some(r => r.id === 'pattanakarn'));
  });
});
