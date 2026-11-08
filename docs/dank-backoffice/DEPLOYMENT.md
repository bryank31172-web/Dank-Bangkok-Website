# DANK BackOffice — Deployment Prep (Phase 7)

**Nothing has been deployed.** This is the checklist and the risk list for when Bryan is ready to do
it himself — per the brief's rule 14 and "do not deploy to production... without explicit approval."

## Release notes (v1.1 — this build)

New, additive-only surface on top of the existing site:

- **New page:** `/backoffice` (`backoffice.html`) — staff-gated, reuses the existing staffportal
  login/session (no new login screen, no new credentials). 11 tabs: Overview, Products, Inventory,
  Food & Drinks, Kitchen, Sales Reports, Suppliers, Purchase Orders, Expenses, Promotions, Settings.
- **New API:** `/api/backoffice/*` — stores (incl. editing), inventory ledger, suppliers, purchase
  orders, stocktakes, stock transfers, product cost/supplier settings, ingredients, recipes (live
  cost-per-serving), kitchen tickets, expenses (incl. receipt-photo attachments and a monthly
  cost-analysis view), and reports — 9 types (sales by product/category, sales by store [flagged
  unavailable], discounts, returns & corrections, COGS [revenue-only, see known gaps], stock value,
  waste costs, staff activity), each exportable to CSV from the UI.
- **New database tables:** `bo_*` in the same Supabase project, additive only — see
  `DATABASE_SCHEMA.md`. **Not yet applied to the live database.**
- **Staff roles & permissions:** added `kitchen` role; added BackOffice scopes to `manager`/
  `professional`; added a `settings` scope. Existing `owner`/`parttime` behavior is unchanged.
  **New:** owners/managers can grant one BackOffice scope to one person individually (Settings →
  Staff permissions) on top of their role, without changing their role — closes the gap with
  StoreHub's granular per-module permission model observed in Phase 1, without replacing the
  existing role system. A manager can never grant a scope they don't have themselves.
- **Promotions:** the existing `api/_promotion.js` module gained two additive, backward-compatible
  fields — `categories` (only enforced when a caller explicitly passes the cart's categories; the
  public checkout endpoint still doesn't, so existing behavior is unchanged) and redemption history
  (logged from `api/order.js` in its own try/catch, after the order is already confirmed saved, so a
  logging failure can never affect checkout). BackOffice's Promotions tab surfaces usage + redemption
  history; creating/editing codes still happens in the existing staffportal editor.
- **Touches existing checkout-adjacent files** (new this round, flagged explicitly): `api/order.js`
  (one new, defensively-isolated write after order save succeeds) and `api/staff-tools.js` (the
  existing promo editor gained a `categories` field and an optional `?redemptions=1` read). Both are
  additive and covered by `tests/promotion-categories.test.js`; the full existing suite (154 tests
  pre-dating this work) still passes unchanged.
- **Explicitly NOT included:** any payment/checkout/gateway code, any change to BRYAN POS's feed, any
  change to the storefront's own pages, any change to existing order/pricing behavior.

## Pre-deployment checklist

1. **Apply the migration.** Run `supabase/migrations/0001_dank_backoffice.sql` via the Supabase SQL
   editor or CLI against the same project (`SUPABASE_URL` already in Vercel — Tokyo region). It's
   written to be safe to re-run (`IF NOT EXISTS` throughout) if it's interrupted partway.
2. **No new environment variables are required.** BackOffice reuses `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, already set for `site_kv`, and the existing `STAFF_KEY`/
   `ADMIN_SECRET`/`STAFF_SESSION_SECRET` for auth. Confirm via `/api/health` that
   `wired.supabase` (or equivalent) is already true before relying on BackOffice — if Supabase is
   misconfigured, every `/api/backoffice/*` endpoint answers `503`, loudly, rather than silently
   doing nothing (same fail-closed posture as the rest of this repo's single-purpose secrets).
3. **Run the test suite:** `node --test tests/` — 160 tests as of this build, including
   `tests/backoffice.test.js` (13 tests: kitchen double-deduction guard, PO partial receiving, ledger
   balance accumulation, full cross-file permission-table sync, recipe costing, expense attachment
   validation, monthly cost analysis) and `tests/promotion-categories.test.js` (4 tests covering the
   promotions category-restriction and redemption-history additions). All must pass.
4. **Syntax-check `backoffice.html`'s inline script** the same way the rest of the repo does (extract
   `<script>` blocks without `src=`, run `node --check`) — done once already this session, redo after
   any further edits.
5. **Smoke-test on staging/preview** (a Vercel preview deployment, not production): log into
   `/staffportal`, navigate to `/backoffice`, confirm the Overview tab loads (it will show
   `sales.source:"unavailable"` gracefully if orders:index is empty, and `inventory` sections will
   read `"not configured"` if the migration hasn't been applied yet on that environment — both are
   expected, not bugs).
6. **Seed real data before trusting any report:** `bo_stores` seeds itself from `branches.json` on
   first read; everything else (suppliers, product cost/par levels, ingredients, recipes) starts
   empty and needs real entry — the Dashboard and Reports tabs will look empty/zero until then. This
   is expected, not a bug: nothing is pre-filled with guessed data.

## Verification actually performed this session (not just claimed)

Two things flagged earlier as "unverified claims" were genuinely tested, not just asserted:

- **The migration against real Postgres.** `tests/backoffice-migration.test.js` runs the actual
  `0001_dank_backoffice.sql` against `@electric-sql/pglite` (Postgres compiled to WASM — a real
  Postgres engine, no Docker needed), now a devDependency (the first one this repo has ever
  declared — see note in that test file for why that's fine: it's test-only, nothing deployed to
  Vercel imports it). It proved: the migration runs clean and is idempotent, all 17 tables exist,
  foreign keys and check constraints actually reject bad data (not just declared — the in-memory
  fake in `tests/backoffice.test.js` couldn't catch a real constraint bug), column defaults apply,
  `bo_ledger_adjust()` and `bo_next_po_number()` work correctly as real plpgsql/sequence objects,
  cascade deletes work, and RLS is enabled on every table. **This is still not the same as running
  it against Bryan's actual production Supabase project** — that needs his own credentials and his
  own execution, per the checklist above. What changed is that the SQL itself is now proven
  correct Postgres, not just "looks right."
- **`backoffice.html` in an actual browser.** Served locally with a stub API (static files + canned
  JSON responses, the same `http.createServer` + API-stubbing technique `PROJECT-HANDOVER.md`
  documents for Playwright page tests), then driven with a real browser: logged in, clicked through
  all 11 tabs, added/removed purchase-order lines, advanced a kitchen ticket (watched the error
  toast appear on a 404, then the success toast once stubbed), exported a CSV, toggled light/dark
  theme (confirmed the background actually changes color, not just an attribute flip), and
  previewed the mobile nav layout. This found and fixed one real bug: ingredient cost-per-unit
  (e.g. ฿0.05/g for rice) was rendering as "฿0" because it reused the whole-baht rounding helper
  meant for totals — now has its own precise formatter. **One real limitation:** the harness's
  window-resize tool didn't actually change the page's viewport width, so true narrow-phone
  rendering (versus the ~767px width tested, and a forced-CSS preview of the `@media` block) wasn't
  verified on a real small screen — worth a quick check on an actual phone before relying on it.

## Rollback plan

- **Code:** this is all on the `dank-backoffice` branch, not merged. Rollback = don't merge (or
  revert the merge commit if it's already landed). No existing file's prior behavior was changed —
  `_auth.js`/`_staff-accounts.js` only had new entries *added* to existing objects, nothing removed
  or renamed, so reverting is a plain revert with no data migration needed on that side.
- **Database:** the migration is purely additive (new `bo_*` tables, one new sequence, two new
  functions). Rollback is `drop table if exists bo_<name> cascade;` for each table, in reverse
  dependency order (lines tables before header tables, e.g. `bo_purchase_order_lines` before
  `bo_purchase_orders`), or simply dropping them all — nothing outside the `bo_*` namespace
  references them, so this cannot touch `site_kv`, `kv_state`, `audit_log`, or any existing table.
- **No data loss risk to existing systems** either way: BackOffice never writes to `site_kv` except
  reading order records for sales reporting (read-only), and never writes to BRYAN POS's tables at
  all.

## Known risks / remaining gaps (documented, not hidden)

1. **Thai cannabis compliance fields are not implemented** — `THAI_CANNABIS_COMPLIANCE.md` is
   research, not a finished design, and explicitly needs a licensed Thai lawyer's review before any
   batch/lot/prescription-reference field is added to the ledger.
2. **Sales-by-store reporting is still not possible** — orders aren't tagged with which outlet they
   came from in the current order-write path (`api/order.js`). `reports.js`'s `sales-by-store`
   returns an explicit "not available" response rather than a guessed number; fixing this means
   adding a `store_id` field at order-creation time, which is a change outside BackOffice's own
   surface and needs its own review. Likewise, **COGS is revenue-only** — order lines are recorded
   by product name, not the BackOffice `product_key`, so cost can't be reliably joined per line
   without that same order-write change.
3. **`backoffice.html`'s UI is functional, not polished — but it has now actually been opened in a
   browser** (see "Verification actually performed this session" above), not just syntax-checked.
   11 tabs including Settings (store management + per-employee BackOffice permission grants) and a
   real Promotions view (usage + redemption history). Reports cover 9 types with CSV export.
   Detailed UX passes (richer tables, bulk actions) remain follow-up work; true narrow-phone
   rendering specifically still wants a check on a real device (see that section for why).
4. **StoreHub modules not surveyed:** Stock Transfers/Return detail screens, the 11 individual sales
   report types, Loyalty/Membership, Online Store/Beep detail, Billing — `STOREHUB_FEATURE_ANALYSIS.md`
   lists these as open unknowns. DANK BackOffice's own Stock Transfer and Expenses modules were built
   from the brief's spec directly rather than blocked on surveying StoreHub's exact UI for them.
5. **Staff permission grants expire with the session token (12h).** A scope granted via Settings →
   Staff permissions takes effect on that person's next login, same staleness window the existing
   role field already has — not a new limitation introduced by this feature.
6. **DB-level tests now run against real Postgres** (`tests/backoffice-migration.test.js`, see
   above) — `tests/backoffice.test.js`'s in-memory fake still covers the endpoint logic on top.
   What's still not tested: `bo_ledger_adjust`'s advisory lock under genuine multi-connection
   concurrency (PGlite is single-connection; the lock's correctness is standard Postgres behavior,
   trusted, but a real concurrent-write load test against an actual Postgres server hasn't been run).
7. **No backup/restore test was performed** — this needs access to the actual Supabase project
   (service-role key), which this session didn't have reason to use destructively. Recommend Bryan
   (or whoever applies the migration) takes a Supabase backup/snapshot immediately before and
   confirms Supabase's point-in-time-recovery window before trusting BackOffice with real data.

## What "done" means for this build

Per the brief's Module-by-module ask: Dashboard, Products (extension), Inventory (full ledger +
stocktakes + transfers + supply-needs via low-stock queries), Suppliers, Purchase Orders (4-state +
partial receiving), Food & Beverage (ingredients + recipes + live costing), Kitchen (ticket board,
consume-once), Expenses, and Sales Reports (by-product, stock-value) are all implemented and tested.
Promotions and Staff management intentionally reuse the existing `staffportal.html` modules rather
than being rebuilt, per `FEATURE_GAP_MATRIX.md`'s "reuse, don't duplicate" guidance — BackOffice links
out to them rather than re-implementing what already works.
