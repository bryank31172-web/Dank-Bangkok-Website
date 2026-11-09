/* ============================================================
   DANK BackOffice — Supabase REST helper.

   Separate from api/_store.js on purpose: _store.js is a key/value adapter
   with a memory/Redis fallback for the storefront, which must never go down
   over a credential problem. BackOffice tables are relational (bo_* tables,
   see supabase/migrations/0001_dank_backoffice.sql) and have no fallback —
   if Supabase isn't configured, BackOffice endpoints answer 503, same as any
   other single-purpose secret in this repo (api/_auth.js's requireEnv/
   notConfigured pattern). Staff lose a back-office screen, not the shop.
   ============================================================ */

const env = (name) => String(process.env[name] || "").trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();

const SB_URL = (env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/+$/, "");
const SB_KEY = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_KEY") || env("SUPABASE_KEY");
const SB_REST = SB_URL ? `${SB_URL}/rest/v1` : "";

export const boConfigured = () => Boolean(SB_URL && SB_KEY) && /^https?:\/\//i.test(SB_URL);

async function req(path, init = {}) {
  const r = await fetch(`${SB_REST}${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const err = new Error(`bo-db ${r.status}: ${body.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/** SELECT. `query` is a raw PostgREST query string, e.g. "status=eq.open&order=created_at.desc". */
export function boSelect(table, query = "") {
  return req(`/${table}${query ? `?${query}` : ""}`);
}

/** INSERT one or more rows. Returns the inserted row(s) (Prefer: return=representation). */
export function boInsert(table, rows) {
  return req(`/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
}

/** UPDATE rows matching a PostgREST filter query string. Returns the updated rows. */
export function boUpdate(table, query, patch) {
  return req(`/${table}?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

/** Upsert: insert, or merge onto the existing row if `conflictCols` already exists.
    `conflictCols` is the comma-separated unique/PK column list PostgREST should match on
    (e.g. "product_key" or "product_key,store_id"). */
export function boUpsert(table, rows, conflictCols) {
  return req(`/${table}?on_conflict=${encodeURIComponent(conflictCols)}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
}

/** Soft or hard delete, matching a PostgREST filter query string. */
export function boDelete(table, query) {
  return req(`/${table}?${query}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
}

/** Call a Postgres function exposed via PostgREST's /rpc/<name>. */
export function boRpc(name, args) {
  return req(`/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
}

/** Append one inventory ledger row with a race-safe balance_after (see migration's bo_ledger_adjust). */
export function boLedgerAdjust({ itemType, itemKey, storeId, qtyDelta, reason, refType = null, refId = null, staffId, note = null }) {
  return boRpc("bo_ledger_adjust", {
    p_item_type: itemType,
    p_item_key: itemKey,
    p_store_id: storeId,
    p_qty_delta: qtyDelta,
    p_reason: reason,
    p_ref_type: refType,
    p_ref_id: refId,
    p_staff_id: staffId,
    p_note: note,
  });
}

/** Latest balance for an item at a store (0 if it has never moved). */
export async function boLatestBalance(itemType, itemKey, storeId) {
  const enc = encodeURIComponent;
  const rows = await boSelect(
    "bo_inventory_ledger",
    `item_type=eq.${enc(itemType)}&item_key=eq.${enc(itemKey)}&store_id=eq.${enc(storeId)}&select=balance_after&order=created_at.desc,id.desc&limit=1`
  );
  return rows?.[0]?.balance_after ?? 0;
}

export const enc = encodeURIComponent;

/* Unified audit log (bo_audit_log, migration 0002) — covers the
   administrative mutations bo_inventory_ledger doesn't (suppliers, recipes,
   ingredients, stores, expenses, purchase order status, staff scope grants).
   Deliberately swallows its own errors: an audit-log write failing must
   never roll back or fail the actual action it's recording — a missing
   audit row is a smaller problem than a supplier edit silently not saving
   because logging it hit a network blip. Call it AFTER the real write
   succeeds, never before. */
export async function boAudit({ actorId, action, entityType, entityId, before = null, after = null, note = null }) {
  if (!boConfigured()) return; // same fail-soft posture as everything else when Supabase isn't set up
  try {
    await boInsert("bo_audit_log", {
      actor_id: actorId, action, entity_type: entityType, entity_id: String(entityId),
      before, after, note,
    });
  } catch (e) {
    console.error("bo_audit_log write failed:", e.message);
  }
}
