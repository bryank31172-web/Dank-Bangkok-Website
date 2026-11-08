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

Items 12-14 were a second pass closing gaps identified against the original master prompt after the
first 11 shipped — see `DEPLOYMENT.md`'s release notes for what changed and which existing files
(`api/order.js`, `api/staff-tools.js`) were touched to do it.

## Out of scope for this build pass (explicitly, per the brief)

- Payment checkout/gateway/terminal integration of any kind.
- Replacing BRYAN POS as the catalogue source of truth.
- Thai cannabis compliance fields — blocked on legal research, tracked as an open unknown.
- Sales-by-store and a cost-joined COGS report — both need `order.js` to write a `store_id`/
  `product_key` onto each order line at checkout time, which is a bigger, separate change to
  checkout-path code than this build's "additive, defensively-isolated" touches to `order.js`
  warranted on its own.
- Migrating `_staff-accounts.js` fully to StoreHub's per-module checkbox model (one toggle per
  screen) — the per-account scope-grant mechanism built in item 12 covers the same real gap (a
  specific person getting one extra permission without a role change) without a bigger auth rewrite.

## Branching / review

All work happens on the `dank-backoffice` branch (created this session), committed incrementally.
Nothing is pushed or merged without Bryan's review — per brief rule 14 (human approval for
production-sensitive actions) and rule 6 (feature branches).
