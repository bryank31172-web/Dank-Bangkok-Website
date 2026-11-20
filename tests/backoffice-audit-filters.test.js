import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://audit-test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'audit-test-key';
process.env.STAFF_KEY = 'audit-test-staff-key';
const { default: handler } = await import('../api/backoffice/audit-log.js');

function response() {
  return { code: 200, setHeader() {}, status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; }, end() { return this; } };
}

test('audit filters apply a staff ID and an inclusive/exclusive timestamp range', async () => {
  let requestUrl;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => { requestUrl = new URL(url); return {ok:true, text:async()=>'[]'}; };
  try {
    const res = response();
    await handler({method:'GET',headers:{authorization:'Bearer audit-test-staff-key'},query:{
      actor:'staff-1', from:'2026-11-01T00:00:00+07:00', to:'2026-11-03T00:00:00+07:00',
    }},res);
    assert.equal(res.code, 200);
    assert.equal(requestUrl.searchParams.get('actor_id'), 'eq.staff-1');
    assert.deepEqual(requestUrl.searchParams.getAll('created_at'), [
      'gte.2026-10-31T17:00:00.000Z', 'lt.2026-11-02T17:00:00.000Z',
    ]);
  } finally { globalThis.fetch = oldFetch; }
});

test('invalid date ranges are rejected before querying the database', async () => {
  let called = false;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; throw new Error('unexpected database call'); };
  try {
    for (const query of [
      {from:'not-a-date'},
      {from:'2026-02-30T00:00:00Z'},
      {from:'2026-11-03T00:00:00Z',to:'2026-11-01T00:00:00Z'},
      {to:'2026-11-01'},
    ]) {
      const res = response();
      await handler({method:'GET',headers:{authorization:'Bearer audit-test-staff-key'},query},res);
      assert.equal(res.code, 400);
    }
    assert.equal(called, false);
  } finally { globalThis.fetch = oldFetch; }
});

test('audit filters do not bypass authorization', async () => {
  const res = response();
  await handler({method:'GET',headers:{},query:{actor:'staff-1'}},res);
  assert.equal(res.code, 401);
});
