# DANK BackOffice — Implementation Plan

## Sequencing (per `FEATURE_GAP_MATRIX.md`, confirmed here)

| # | Work | Depends on | Acceptance criteria |
|---|---|---|---|
| 1 | `api/_bo-db.js` DB helper + migration SQL | none | helper functions unit-testable against a mocked fetch; migration file reviewed, not yet applied |
| 2 | Staff permission extension (`kitchen` role, new scopes) | none | existing roles unaffected; new scopes default to false for existing accounts |
| 3 | `bo_stores` seed + `/api/backoffice/stores` | 1 | returns 4 branches from `branches.json` |
| 4 | Inventory ledger API + Products settings extension | 1,3 | manual adjustment produces a correct `balance_after`; concurrent adjustments don't race (tested) |
| 5 | Suppliers + Purchase Orders (incl. receiving → ledger) | 4 | receiving a PO writes ledger rows; partial receipt leaves PO `receiving` not `completed` |
| 6 | Dashboard API + `backoffice.html` shell + Dashboard tab | 3,4,5 | KPIs load for a real store; figures tagged recorded/estimated |
| 7 | Sales reports (by-product, by-store) | 6 | reads existing `site_kv` order data, no duplicate sales table |
| 8 | Recipes + Ingredients + Kitchen tickets | 4 | serving a ticket twice does not double-deduct stock (tested) |
| 9 | Expenses (incl. receipt attachments + monthly cost analysis) | none (standalone) | CRUD works, attachment validated, monthly breakdown grouped correctly (tested) |
| 10 | QA pass | all above | see `PHASE6` test list below |
| 11 | Deployment prep | all above | release notes, env checklist, rollback note — no actual deploy |
| 12 | Settings tab (store management + per-employee BackOffice scope grants) | 2,3 | a manager can never grant a scope they don't have themselves (tested) |
| 13 | Sales Reports breadth (category, discounts, returns/corrections, COGS, waste, staff activity) + CSV export | 7 | each report tags its data as recorded/derived/unavailable, never guesses |
| 14 | Promotions: applicable categories + redemption history on the existing `_promotion.js` | none | both additions are backward compatible — omitting the new params reproduces pre-existing behavior exactly (tested) |
| 15 | Unified audit log (`bo_audit_log`) across suppliers, purchase orders, recipes, ingredients, stores, expenses and staff account/role/scope changes | 1 | every create/update/delete writes a before/after row; a logging failure never blocks or rolls back the real write (tested) |
| 16 | Recurring expenses made real (`next_generated`/`generated_from` on `bo_expenses`) | 9,15 | a due recurring expense generates its successor exactly once per read, chain is traceable, generation itself is audit-logged (tested) |
| 17 | Import validation, duplicate detection and reconciliation (Module G, `/api/backoffice/import`) | 9 | never creates expenses/orders from an uploaded file — only reports matched/unmatched/duplicate/invalid against existing records (tested) |
| 18 | PDF export (Expenses, Reports) via the browser's native print-to-PDF | 7,9 | no new client-side dependency; `@media print` hides nav/forms, prints only the current tab's tables |
| 19 | Sales-by-store + COGS: `storeId`/`productKey` tagged on each order at write time (`api/order.js`); `reports.js`'s `sales-by-store`/`cogs` join on them | 7 | delivery branch used as-is from the existing road-distance quote, dine-in attributed to DANK's one confirmed physical location, never a guessed branch or cost; untagged/uncosted data reported explicitly, not silently dropped (tested) |
| 20 | UX pass (Phase 11): sortable columns + bulk actions on Purchase Orders, Expenses, Inventory | 7,9 | bulk-send (drafts) and bulk-delete (expenses) fan out to the existing single-item endpoints — no new API surface; verified click-through in a real browser against a stub API, zero console errors |
| 21 | Stock Takes + Stock Transfers UI on the Inventory tab, calling the already-built `stocktakes.js`/`transfers.js` | 1,4 | start → count → complete and create → complete both verified end-to-end in a real browser; an uncounted item posts no adjustment (never assumed zero); no new API/DB/scopes |
| 22 | Dashboard charts (StoreHub parity): hourly today-vs-yesterday trend, sales-by-fulfilment donut, sales-by-store bar chart, top products (+days sold), %-change-vs-prior-period KPI | 19,20 | hand-rolled inline SVG, same validated series colours as `analytics.html` — no chart library; every figure genuinely computed from the order sweep, never guessed (tested); "sales by fulfilment" is explicitly labeled as delivery/table/pickup, not StoreHub's online/offline split, since DANK has no in-store POS sales data to compare against |
| 23 | Phase 6 QA follow-up: mobile responsiveness re-check at a genuinely narrow (502px) viewport | 10 | found and fixed a real bug — a wide table (Expenses, 8 columns) forced page-level horizontal scroll; `.card{overflow-x:auto}` contains it to the card instead. Confirmed via `document.body.scrollWidth` before/after, not just visually. True sub-400px phone rendering is still unverified — this session's browser tool clamps the window to ~502px minimum regardless of the width requested |

Items 12-14 were a second pass closing gaps identified against the original master prompt after the
first 11 shipped — see `DEPLOYMENT.md`'s release notes for what changed and which existing files
(`api/order.js`, `api/staff-tools.js`) were touched to do it.

Items 15-18 are a third pass, closing further gaps against the original master prompt (audit
trail, recurring-expense automation, Module G's import/reconciliation requirement, and PDF export) —
see `DEPLOYMENT.md`'s release notes for v1.2.

Item 19 (Phase 8) is the one deferred item that touches checkout-adjacent code (`api/order.js`) a
third time, after the promotion-redemption logging in the second pass — same posture: additive,
isolated try/catches placed after pricing/totals are already finalized, never able to affect them.
See `DEPLOYMENT.md`'s known-gaps section #2 for exactly what this does and does not cover.

## Out of scope for this build pass (explicitly, per the brief)

- Payment checkout/gateway/terminal integration of any kind.
- Replacing BRYAN POS as the catalogue source of truth.
- Thai cannabis compliance fields — blocked on legal research, tracked as an open unknown.
- Migrating `_staff-accounts.js` fully to StoreHub's per-module checkbox model (one toggle per
  screen) — the per-account scope-grant mechanism built in item 12 covers the same real gap (a
  specific person getting one extra permission without a role change) without a bigger auth rewrite.

## Branching / review

All work happens on the `dank-backoffice` branch (created this session), committed incrementally.
Nothing is pushed or merged without Bryan's review — per brief rule 14 (human approval for
production-sensitive actions) and rule 6 (feature branches).
