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
| 9 | Expenses | none (standalone) | CRUD works, shows in a simple monthly total |
| 10 | QA pass | all above | see `PHASE6` test list below |
| 11 | Deployment prep | all above | release notes, env checklist, rollback note — no actual deploy |

## Out of scope for this build pass (explicitly, per the brief)

- Payment checkout/gateway/terminal integration of any kind.
- Replacing BRYAN POS as the catalogue source of truth.
- Thai cannabis compliance fields — blocked on legal research, tracked as an open unknown.
- StoreHub's full 11-report sales breakdown, loyalty/membership, online-store/Beep detail — only
  by-product and by-store sales reports ship now; others are additive later.
- Migrating `_staff-accounts.js` to StoreHub's fully granular per-module checkbox model — the flat
  role+scope extension is sufficient for v1; noted as a future option in `BACKOFFICE_REQUIREMENTS.md`.

## Branching / review

All work happens on the `dank-backoffice` branch (created this session), committed incrementally.
Nothing is pushed or merged without Bryan's review — per brief rule 14 (human approval for
production-sensitive actions) and rule 6 (feature branches).
