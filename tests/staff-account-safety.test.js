import test from 'node:test';
import assert from 'node:assert/strict';

// These tests must never contact a configured production store.
for (const name of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY', 'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_REST_URL', 'REDIS_REST_TOKEN']) {
  delete process.env[name];
}
process.env.STAFF_SESSION_SECRET = 'local-test-secret';

const { createAccount, setAccountActive, setOwnAccountKey, updateAccount, listAccounts } =
  await import('../api/_staff-accounts.js');
const owner = { id: 'test-owner', role: 'owner' };

test('a disabled staff member cannot reactivate their account using an existing session', async () => {
  const { account } = await createAccount(owner, 'Test staff', 'parttime');
  const actor = { id: account.id, role: account.role };
  await setAccountActive(owner, account.id, false);
  await assert.rejects(setOwnAccountKey(actor, 'New!Password123'), /inactive|disabled|forbidden/i);
  const saved = (await listAccounts()).find(row => row.id === account.id);
  assert.equal(saved.active, false);
});

test('an account edit cannot disable the acting owner', async () => {
  const { account } = await createAccount(owner, 'Test owner', 'owner');
  const actor = { id: account.id, role: 'owner' };
  await assert.rejects(updateAccount(actor, account.id, { name: 'Test owner', active: false }), /forbidden/i);
  const saved = (await listAccounts()).find(row => row.id === account.id);
  assert.equal(saved.active, true);
});

test('active staff can change their own key and owners can disable another account', async () => {
  const { account } = await createAccount(owner, 'Another staff', 'parttime');
  await setOwnAccountKey({ id: account.id, role: account.role }, 'New!Password123');
  const changed = await setAccountActive(owner, account.id, false);
  assert.equal(changed.active, false);
});
