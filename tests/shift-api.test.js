/* Shift Maker API — authorization, validation, concurrency, publishing,
   staff visibility, copy-week idempotency and the change-request workflow.

   Uses a small in-memory PostgREST double (below) that reproduces the
   constraints that matter: primary keys, the per-employee exclusion
   constraint (Postgres 23P01), the partial unique indexes, ignore-duplicate
   inserts and the two RPCs. The real SQL is exercised separately in
   tests/shift-migration.test.js against PGlite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.ADMIN_SECRET = 'test-admin-secret';
process.env.BACKOFFICE_PASSWORD = 'test-bo-password';
process.env.STAFF_KEY = 'test-staff-key';

/* ---------------- fake PostgREST ---------------- */
const PK = { site_kv: 'key' };
const SERIAL = new Set(['bo_schedule_publications', 'bo_staff_notifications', 'bo_audit_log']);
const DEFAULTS = {
  bo_schedule_periods: { status: 'draft', version: 1, published_no: 0, published_version: null },
  bo_shift_assignments: { version: 1, deleted_at: null, split_override: false, break_minutes: 0, copy_source_id: null },
  bo_staff_leave: { status: 'pending' },
  bo_staff_availability: { status: 'active' },
  bo_shift_change_requests: { status: 'pending' },
  bo_shift_templates: { active: true, sort_order: 0, break_minutes: 0 },
  bo_staffing_requirements: { active: true },
  bo_staff_notifications: { read_at: null },
};
const db = {};
let serial = 0;
const hooks = {};
const table = (t) => (db[t] ||= []);
const pgErr = (code, msg) => ({ status: 409, body: { code, message: msg } });
const cmp = (a, b) => {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  const da = Date.parse(a), dbb = Date.parse(b);
  if (/^\d{4}-\d{2}-\d{2}/.test(a) && /^\d{4}-\d{2}-\d{2}/.test(b) && !Number.isNaN(da) && !Number.isNaN(dbb)) return da - dbb;
  return String(a).localeCompare(String(b));
};
function match(row, col, expr) {
  const v = row[col];
  if (expr === 'is.null') return v == null;
  if (expr === 'not.is.null') return v != null;
  let m = /^in\.\((.*)\)$/.exec(expr);
  if (m) return m[1].split(',').includes(String(v));
  m = /^(eq|neq|gt|gte|lt|lte)\.(.*)$/.exec(expr);
  if (!m) throw new Error('fake: unsupported filter ' + expr);
  const [, op, raw] = m;
  if (op === 'eq') return String(v) === raw;
  if (op === 'neq') return String(v) !== raw;
  if (v == null) return false;
  const c = cmp(v, raw);
  return { gt: c > 0, gte: c >= 0, lt: c < 0, lte: c <= 0 }[op];
}
function query(t, params) {
  let rows = table(t).slice(), order = null, limit = null;
  for (const [k, v] of params) {
    if (k === 'select' || k === 'on_conflict') continue;
    if (k === 'order') order = v; else if (k === 'limit') limit = Number(v);
    else rows = rows.filter((r) => match(r, k, v));
  }
  if (order) {
    const keys = order.split(',').map((s) => s.split('.'));
    rows.sort((a, b) => { for (const [c, dir] of keys) { const x = cmp(a[c] ?? '', b[c] ?? ''); if (x) return dir === 'desc' ? -x : x; } return 0; });
  }
  return limit != null ? rows.slice(0, limit) : rows;
}
const overlaps = (a, b) => Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);
function checkConstraints(t, row, selfIndex = -1) {
  const rows = table(t).filter((_, i) => i !== selfIndex);
  const pk = PK[t] || 'id';
  if (row[pk] != null && rows.some((r) => r[pk] === row[pk])) return pgErr('23505', 'pk');
  if (t === 'bo_schedule_periods' && rows.some((r) => r.store_id === row.store_id && r.week_start === row.week_start)) return pgErr('23505', 'period');
  if (t === 'bo_shift_assignments' && !row.deleted_at) {
    if (rows.some((r) => !r.deleted_at && r.employee_id === row.employee_id && overlaps(r, row))) return pgErr('23P01', 'bo_shift_no_self_overlap');
    if (row.copy_source_id && rows.some((r) => !r.deleted_at && r.period_id === row.period_id && r.copy_source_id === row.copy_source_id)) return pgErr('23505', 'copy once');
  }
  if (t === 'bo_shift_change_requests' && row.status === 'pending' && rows.some((r) => r.status === 'pending' && r.requester_id === row.requester_id && r.assignment_id === row.assignment_id)) return pgErr('23505', 'one open');
  if (t === 'bo_staff_notifications' && rows.some((r) => r.dedupe_key === row.dedupe_key)) return pgErr('23505', 'dedupe');
  return null;
}
function rpc(name, a) {
  if (name === 'bo_shift_bump_period') { const p = table('bo_schedule_periods').find((r) => r.id === a.p_period_id); if (!p) return null; p.version += 1; return p.version; }
  if (name === 'bo_shift_publish') {
    const p = table('bo_schedule_periods').find((r) => r.id === a.p_period_id);
    if (!p || p.version !== a.p_expected_version) return null;
    const row = { id: ++serial, period_id: p.id, publication_no: p.published_no + 1, period_version: p.version, assignments: a.p_assignments, warnings: a.p_warnings, acknowledged: a.p_acknowledged, published_by: a.p_actor, published_at: new Date().toISOString() };
    table('bo_schedule_publications').push(row);
    Object.assign(p, { status: 'published', published_no: row.publication_no, published_version: p.version, published_at: row.published_at, published_by: a.p_actor });
    return row;
  }
  throw new Error('fake: unknown rpc ' + name);
}
const reply = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  await new Promise((r) => setImmediate(r)); // let concurrent requests interleave like real network calls
  const path = u.pathname.replace('/rest/v1/', '');
  const params = [...u.searchParams.entries()];
  const method = init.method || 'GET';
  const prefer = String(init.headers?.Prefer || '');
  if (path.startsWith('rpc/')) return reply(200, rpc(path.slice(4), JSON.parse(init.body)));
  const t = path;
  if (method === 'GET') return reply(200, query(t, params));
  if (method === 'POST') {
    const out = [];
    for (const input of JSON.parse(init.body)) {
      const row = { ...(DEFAULTS[t] || {}), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...input };
      if (row[PK[t] || 'id'] == null) row.id = SERIAL.has(t) ? ++serial : crypto.randomUUID();
      if (t === 'bo_shift_assignments' && hooks.beforeAssignmentInsert) { const h = hooks.beforeAssignmentInsert; hooks.beforeAssignmentInsert = null; h(row); }
      const err = checkConstraints(t, row);
      if (err) {
        const pk = PK[t] || 'id';
        if (prefer.includes('merge-duplicates')) { const i = table(t).findIndex((r) => r[pk] === row[pk]); if (i >= 0) { Object.assign(table(t)[i], input); out.push(table(t)[i]); continue; } }
        if (prefer.includes('ignore-duplicates')) continue;
        return reply(err.status, err.body);
      }
      table(t).push(row); out.push(row);
    }
    return reply(201, prefer.includes('return=minimal') ? null : out);
  }
  if (method === 'PATCH') {
    const patch = JSON.parse(init.body), hit = query(t, params), out = [];
    for (const r of hit) {
      const i = table(t).indexOf(r), next = { ...r, ...patch };
      const err = checkConstraints(t, next, i);
      if (err) return reply(err.status, err.body);
      table(t)[i] = next; out.push(next);
    }
    return reply(200, out);
  }
  if (method === 'DELETE') { const hit = query(t, params); db[t] = table(t).filter((r) => !hit.includes(r)); return reply(200, hit); }
  return reply(405, {});
};

/* ---------------- harness ---------------- */
const { staffIdentity, makeBackofficeToken, hasPermission } = await import('../api/_auth.js');
const { setJSON } = await import('../api/_store.js');
const { ROLE_PERMISSIONS } = await import('../api/_staff-accounts.js');
const manage = (await import('../api/backoffice/shifts.js')).default;
const mine = (await import('../api/my-shifts.js')).default;
const E = await import('../assets/shift-engine.js');

const ACCOUNTS = [
  { id: 'owner1', name: 'Bryan', role: 'owner' }, { id: 'mgr1', name: 'Bank', role: 'manager' },
  { id: 'emma', name: 'Emma W.', role: 'professional' }, { id: 'noah', name: 'Noah T.', role: 'parttime' },
  { id: 'ava', name: 'Ava R.', role: 'parttime' },
];
const tok = Object.fromEntries(ACCOUNTS.map((a) => [a.id, staffIdentity.makeToken(a)]));
const BO = makeBackofficeToken();
const WEEK = '2026-11-16', TUE = '2026-11-17';

function call(handler, url, { method = 'GET', body = {}, token = BO, query = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method, url, body, query, headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
      json(d) { resolve({ code: this.code, data: d }); }, end() { resolve({ code: this.code, data: null }); } };
    handler(req, res);
  });
}
const api = (method, resource, body = {}, token = BO, query = {}) =>
  call(manage, `/api/backoffice/shifts?resource=${resource}`, { method, body: { ...body }, token, query: { resource, ...query } });
const me = (method, token, body = {}, query = {}) => call(mine, '/api/my-shifts', { method, body, token, query });
const newShift = (employeeId, date, start, end, extra = {}) => api('POST', 'assignment', { id: crypto.randomUUID(), employeeId, storeId: 'pattanakarn', date, start, end, ...extra });

async function reset() {
  for (const k of Object.keys(db)) delete db[k];
  table('bo_stores').push({ id: 'pattanakarn', name: 'Pattanakarn', active: true }, { id: 'ari', name: 'Ari', active: true });
  await setJSON('staff:accounts:v1', ACCOUNTS.map((a) => ({ ...a, active: true, keyHash: 'x' })));
}

/* ---------------- tests ---------------- */

test('both role tables grant the same shift scopes', () => {
  for (const [role, list] of Object.entries(ROLE_PERMISSIONS))
    for (const scope of ['shifts_manage', 'shifts_settings', 'shifts_self'])
      assert.equal(hasPermission({ role }, scope), list.includes('*') || list.includes(scope), `${role} ${scope}`);
});

test('management API: no login 401, staff 403, manager and BackOffice allowed, settings owner-only', async () => {
  await reset();
  assert.equal((await api('GET', 'bootstrap', {}, '')).code, 401);
  assert.equal((await api('GET', 'bootstrap', {}, tok.emma)).code, 403);
  assert.equal((await api('GET', 'bootstrap', {}, tok.noah)).code, 403);
  const m = await api('GET', 'bootstrap', {}, tok.mgr1);
  assert.equal(m.code, 200);
  assert.equal(m.data.can.settings, false);
  assert.equal((await api('PATCH', 'settings', { settings: { incrementMinutes: 15 } }, tok.mgr1)).code, 403);
  assert.equal((await api('POST', 'templates', { name: 'Morning', startTime: '09:00', endTime: '17:00' }, tok.mgr1)).code, 403);
  const bo = await api('GET', 'bootstrap');
  assert.equal(bo.code, 200);
  assert.equal(bo.data.employees.length, 5);
  assert.equal((await api('PATCH', 'settings', { settings: { incrementMinutes: 15 } }, tok.owner1)).code, 200);
  assert.equal((await api('POST', 'templates', { name: 'Morning', startTime: '09:00', endTime: '17:00', breakMinutes: 60 })).code, 200);
});

test('every other /api/backoffice route still refuses a personal staff token', () => {
  assert.equal(staffIdentity({ url: '/api/backoffice/stores', headers: { authorization: `Bearer ${tok.mgr1}` } }), null);
  assert.equal(staffIdentity({ url: '/api/backoffice/shifts', headers: { authorization: `Bearer ${tok.mgr1}` } })?.id, 'mgr1');
});

test('shared coverage is saved; the same person overlapping is refused with a clear reason; adjacent is fine', async () => {
  await reset();
  assert.equal((await newShift('emma', TUE, '09:00', '17:00')).code, 200);
  assert.equal((await newShift('noah', TUE, '13:00', '21:00')).code, 200, 'different employee, same hours: allowed');
  const clash = await newShift('emma', TUE, '13:00', '21:00');
  assert.equal(clash.code, 422);
  assert.equal(clash.data.errors[0].code, 'overlap');
  assert.match(clash.data.error, /Emma W\. is already scheduled Tue 17 Nov 09:00–17:00/);
  const adjacent = await newShift('ava', TUE, '09:00', '17:00');
  assert.equal(adjacent.code, 200);
  assert.equal((await newShift('ava', TUE, '17:00', '21:00', { splitOverride: true })).code, 422, 'split shifts are off by default');
  assert.equal(table('bo_shift_assignments').filter((r) => !r.deleted_at).length, 3);
});

test('a retried create with the same id never makes a second row', async () => {
  await reset();
  const id = crypto.randomUUID();
  const body = { id, employeeId: 'emma', storeId: 'pattanakarn', date: TUE, start: '09:00', end: '17:00' };
  assert.equal((await api('POST', 'assignment', body)).code, 200);
  const again = await api('POST', 'assignment', body);
  assert.equal(again.code, 200);
  assert.equal(again.data.replayed, true);
  assert.equal(table('bo_shift_assignments').length, 1);
});

test('two managers racing: the database constraint turns the loser into a 409', async () => {
  await reset();
  // Another manager's insert lands after our validation read and before our insert.
  hooks.beforeAssignmentInsert = () => table('bo_shift_assignments').push({ id: crypto.randomUUID(), period_id: 'x', store_id: 'pattanakarn', employee_id: 'emma',
    starts_at: E.localToRange(TUE, '08:00', '12:00').startsAt, ends_at: E.localToRange(TUE, '08:00', '12:00').endsAt, deleted_at: null, version: 1 });
  const r = await newShift('emma', TUE, '09:00', '17:00');
  assert.equal(r.code, 409);
  assert.equal(r.data.code, 'overlap_race');
  // And genuinely concurrent duplicates: exactly one wins.
  await reset();
  const both = await Promise.all([newShift('noah', TUE, '09:00', '17:00'), newShift('noah', TUE, '10:00', '18:00')]);
  assert.deepEqual(both.map((x) => x.code).sort(), [200, both.find((x) => x.code !== 200).code]);
  assert.ok([409, 422].includes(both.find((x) => x.code !== 200).code));
  assert.equal(table('bo_shift_assignments').filter((r) => r.employee_id === 'noah').length, 1);
});

test('edits need the current version; moving a shift re-validates', async () => {
  await reset();
  const a = (await newShift('emma', TUE, '09:00', '17:00')).data.assignment;
  await newShift('emma', '2026-11-18', '09:00', '17:00');
  const stale = await api('PATCH', 'assignment', { id: a.id, version: a.version + 5, start: '10:00', end: '18:00', date: TUE });
  assert.equal(stale.code, 409);
  assert.equal(stale.data.code, 'stale');
  const moved = await api('PATCH', 'assignment', { id: a.id, version: a.version, date: TUE, start: '10:00', end: '18:00' });
  assert.equal(moved.code, 200);
  assert.equal(moved.data.assignment.version, 2);
  const onto = await api('PATCH', 'assignment', { id: a.id, version: 2, date: '2026-11-18', start: '12:00', end: '20:00' });
  assert.equal(onto.code, 422, 'cannot be moved on top of her Wednesday shift');
  const del = await api('DELETE', 'assignment', { id: a.id, version: 2 });
  assert.equal(del.code, 200);
  assert.equal((await api('PATCH', 'assignment', { id: a.id, version: 3, start: '09:00' })).code, 404);
});

test('approved leave blocks new shifts and blocks publishing an existing one', async () => {
  await reset();
  const a = (await newShift('emma', TUE, '09:00', '17:00')).data.assignment;
  const leave = await api('POST', 'leave', { employeeId: 'emma', fromDate: TUE, toDate: TUE, leaveType: 'sick', reason: 'flu' });
  assert.equal(leave.code, 200);
  assert.equal(leave.data.affected.length, 1, 'the clashing shift is surfaced, not silently removed');
  assert.equal(table('bo_shift_assignments').find((r) => r.id === a.id).deleted_at, null);
  assert.equal((await newShift('emma', TUE, '18:00', '22:00')).code, 422);
  const p = await api('GET', 'period', {}, BO, { store: 'pattanakarn', week: WEEK });
  assert.equal(p.data.validation.errors[0].code, 'leave');
  const pub = await api('POST', 'publish', { storeId: 'pattanakarn', weekStart: WEEK, version: p.data.period.version });
  assert.equal(pub.code, 422);
});

test('publish: drafts invisible to staff, warnings need acknowledgment, staff see only their own published shifts', async () => {
  await reset();
  await api('POST', 'requirements', { startTime: '09:00', endTime: '12:00', minStaff: 3 });
  await newShift('emma', TUE, '09:00', '17:00');
  await newShift('noah', TUE, '13:00', '21:00');
  assert.deepEqual((await me('GET', tok.emma, {}, { from: WEEK, to: '2026-11-22' })).data.shifts, [], 'draft is invisible');
  let p = (await api('GET', 'period', {}, BO, { store: 'pattanakarn', week: WEEK })).data;
  assert.equal(p.validation.errors.length, 0);
  assert.ok(p.validation.shared.length === 1, 'Emma+Noah shared coverage reported, not as an error');
  const noAck = await api('POST', 'publish', { storeId: 'pattanakarn', weekStart: WEEK, version: p.period.version });
  assert.equal(noAck.code, 409);
  assert.equal(noAck.data.code, 'needs_ack');
  const ok = await api('POST', 'publish', { storeId: 'pattanakarn', weekStart: WEEK, version: p.period.version, acknowledge: noAck.data.needsAck }, tok.mgr1);
  assert.equal(ok.code, 200);
  assert.equal(ok.data.publicationNo, 1);
  assert.equal(ok.data.notified, 2);
  const emma = (await me('GET', tok.emma, {}, { from: WEEK, to: '2026-11-22' })).data;
  assert.equal(emma.shifts.length, 1);
  assert.ok(emma.shifts.every((s) => s.employeeId === 'emma'), 'never a colleague’s shift');
  assert.equal(emma.hours[0].minutes, 8 * 60);
  assert.equal(emma.notifications.length, 1);
  // A draft edit after publishing is still invisible until republished.
  await newShift('emma', '2026-11-19', '09:00', '13:00');
  assert.equal((await me('GET', tok.emma, {}, { from: WEEK, to: '2026-11-22' })).data.shifts.length, 1);
  p = (await api('GET', 'period', {}, BO, { store: 'pattanakarn', week: WEEK })).data;
  assert.equal(p.dirty, true);
  assert.equal((await api('POST', 'publish', { storeId: 'pattanakarn', weekStart: WEEK, version: p.period.version - 1, acknowledge: p.validation.needsAck })).code, 409, 'stale review');
  const re = await api('POST', 'publish', { storeId: 'pattanakarn', weekStart: WEEK, version: p.period.version, acknowledge: p.validation.needsAck });
  assert.equal(re.data.publicationNo, 2);
  assert.equal(re.data.notified, 1, 'only Emma changed, only Emma is told');
  assert.equal((await me('GET', tok.emma, {}, { from: WEEK, to: '2026-11-22' })).data.shifts.length, 2);
  assert.equal((await me('GET', tok.noah, {}, { from: WEEK, to: '2026-11-22' })).data.notifications.length, 1, 'no duplicate notice for Noah');
  const hist = (await api('GET', 'period', {}, BO, { store: 'pattanakarn', week: WEEK })).data.history;
  assert.deepEqual(hist.map((h) => h.no), [2, 1]);
});

test('copy previous week: preview flags leave, apply creates drafts, re-running is a no-op', async () => {
  await reset();
  await newShift('emma', '2026-11-10', '09:00', '17:00', { notes: 'opening' });
  await newShift('noah', '2026-11-11', '13:00', '21:00');
  await api('POST', 'leave', { employeeId: 'noah', fromDate: '2026-11-18', toDate: '2026-11-18' });
  const preview = await api('POST', 'copy-week', { storeId: 'pattanakarn', fromWeek: '2026-11-09', toWeek: WEEK });
  assert.equal(preview.code, 200);
  assert.equal(preview.data.proposals.length, 2);
  assert.equal(preview.data.proposals.find((p) => p.employeeId === 'noah').errors[0].code, 'leave');
  assert.equal(table('bo_shift_assignments').length, 2, 'preview writes nothing');
  const applied = await api('POST', 'copy-week', { storeId: 'pattanakarn', fromWeek: '2026-11-09', toWeek: WEEK, apply: true });
  assert.equal(applied.data.created.length, 1);
  assert.equal(applied.data.failed.length, 1);
  assert.equal(applied.data.created[0].notes, 'opening');
  assert.equal(E.fmtRange(applied.data.created[0]), '09:00–17:00');
  const again = await api('POST', 'copy-week', { storeId: 'pattanakarn', fromWeek: '2026-11-09', toWeek: WEEK, apply: true });
  assert.equal(again.data.created.length, 0);
  assert.equal(again.data.skipped.length, 1);
  const p = table('bo_schedule_periods').find((x) => x.week_start === WEEK);
  assert.equal(p.status, 'draft', 'copying never publishes');
});

test('change requests: only for your own published shift, one open at a time, approval re-validates', async () => {
  await reset();
  const a = (await newShift('emma', TUE, '09:00', '17:00')).data.assignment;
  const n = (await newShift('noah', TUE, '13:00', '21:00')).data.assignment;
  const early = await me('POST', tok.emma, { action: 'change', assignmentId: a.id, kind: 'absence', reason: 'doctor' });
  assert.equal(early.code, 404, 'not published yet, so it does not exist for staff');
  const p = (await api('GET', 'period', {}, BO, { store: 'pattanakarn', week: WEEK })).data;
  await api('POST', 'publish', { storeId: 'pattanakarn', weekStart: WEEK, version: p.period.version, acknowledge: p.validation.needsAck });
  assert.equal((await me('POST', tok.emma, { action: 'change', assignmentId: n.id, kind: 'absence', reason: 'x' })).code, 404, 'not her shift');
  const r = await me('POST', tok.emma, { action: 'change', assignmentId: a.id, kind: 'change', date: TUE, start: '10:00', end: '18:00', reason: 'class until 9:30' });
  assert.equal(r.code, 200);
  assert.equal((await me('POST', tok.emma, { action: 'change', assignmentId: a.id, kind: 'absence', reason: 'again' })).code, 409);
  const ok = await api('PATCH', 'change-requests', { id: r.data.request.id, status: 'approved' }, tok.mgr1);
  assert.equal(ok.code, 200);
  assert.equal(E.fmtRange(ok.data.applied.assignment), '10:00–18:00');
  // A swap onto someone already working then is refused and stays pending.
  const swap = await me('POST', tok.noah, { action: 'change', assignmentId: n.id, kind: 'swap', swapEmployeeId: 'emma', reason: 'exam' });
  assert.equal(swap.code, 200);
  const bad = await api('PATCH', 'change-requests', { id: swap.data.request.id, status: 'approved' });
  assert.equal(bad.code, 422);
  assert.equal(table('bo_shift_change_requests').find((x) => x.id === swap.data.request.id).status, 'pending');
  assert.equal((await api('PATCH', 'change-requests', { id: swap.data.request.id, status: 'rejected', note: 'Emma is on' })).code, 200);
  const emma = (await me('GET', tok.emma)).data;
  assert.ok(emma.notifications.some((x) => x.kind === 'request_approved'));
});

test('staff leave and availability: own only, cancellable while pending, manager decides', async () => {
  await reset();
  const l = await me('POST', tok.noah, { action: 'leave', fromDate: '2026-11-20', toDate: '2026-11-21', leaveType: 'annual', reason: 'trip' });
  assert.equal(l.code, 200);
  assert.equal(l.data.leave.status, 'pending');
  assert.equal(l.data.leave.employeeId, 'noah');
  const av = await me('POST', tok.noah, { action: 'availability', kind: 'unavailable', weekday: 0, startTime: '09:00', endTime: '12:00', reason: 'class' });
  assert.equal(av.code, 200);
  assert.equal((await me('POST', tok.emma, { action: 'cancel-leave', id: l.data.leave.id })).code, 404, 'cannot cancel a colleague’s leave');
  assert.equal((await me('POST', tok.emma, { action: 'withdraw-availability', id: av.data.row.id })).code, 404);
  const mon = await newShift('noah', '2026-11-16', '09:00', '17:00');
  assert.equal(mon.code, 200, 'unavailability warns by default…');
  assert.equal(mon.data.warnings[0].code, 'unavailable');
  const decided = await api('PATCH', 'leave', { id: l.data.leave.id, status: 'approved' }, tok.mgr1);
  assert.equal(decided.code, 200);
  assert.equal((await api('PATCH', 'leave', { id: l.data.leave.id, status: 'rejected' })).code, 409, 'decided once');
  assert.equal((await newShift('noah', '2026-11-20', '09:00', '17:00')).code, 422, '…approved leave blocks');
  assert.equal((await me('POST', tok.noah, { action: 'cancel-leave', id: l.data.leave.id })).code, 409, 'approved leave needs a manager');
  const mineView = (await me('GET', tok.noah)).data;
  assert.equal(mineView.leave.length, 1);
  assert.ok(!('assignments' in mineView));
  assert.ok(mineView.colleagues.every((c) => Object.keys(c).join() === 'id,name'), 'colleagues are names only');
});

test('My Shifts refuses the shared keys, and the print data needs management rights', async () => {
  await reset();
  assert.equal((await me('GET', BO)).code, 401, 'BackOffice session is not a person');
  assert.equal((await me('GET', 'test-staff-key')).code, 403, 'legacy owner key is not a person');
  assert.equal((await api('GET', 'print', {}, tok.emma, { store: 'pattanakarn', week: WEEK })).code, 403);
  await newShift('emma', TUE, '09:00', '17:00');
  const pr = await api('GET', 'print', {}, BO, { store: 'pattanakarn', week: WEEK });
  assert.equal(pr.code, 200);
  assert.equal(pr.data.weeks[0].assignments.length, 1);
  assert.equal(pr.data.weeks[0].status, 'Draft');
  const pub = await api('GET', 'print', {}, BO, { store: 'pattanakarn', week: WEEK, source: 'published' });
  assert.equal(pub.data.weeks[0].assignments.length, 0);
});
