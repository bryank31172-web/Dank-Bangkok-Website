# DANK BackOffice — Feature Gap Matrix

Comparing what DANK's repo already has, what StoreHub has (per `STOREHUB_FEATURE_ANALYSIS.md`), and
what the brief asks for. "Reuse" = extend existing DANK code/data. "New" = nothing to build on.

| Module | DANK repo today | StoreHub reference | Gap / build approach |
|---|---|---|---|
| A. Dashboard | None (staff.html has Sales tab only) | Rich: KPI cards, trend chart, channel split, per-outlet bar, top products | **New**, but data source = existing order/sales records in `site_kv`, not re-derived from scratch |
| B. Products | Exists (BRYAN POS feed → `_menu.js`, `product-images.json`, `strain-db.json`) | Full CRUD, per-store stock, supplier link, UoM, multi-barcode | **Extend**: BRYAN POS already owns name/price/category/stock-count; BackOffice adds cost price, supplier link, per-store par/low-stock thresholds StoreHub has but BRYAN POS feed doesn't carry |
| C. Inventory ledger | None — `site_kv` has no stock-movement history | Full: audit trail, stock takes, transfers, wastage, supply-needs/reorder | **New** relational tables (append-only ledger), modeled directly on StoreHub's audit-trail + supply-needs pattern |
| D. Food & Beverage / Recipes | `food.html`/`food-menu.json` is menu display only, no ingredients/recipes | **Not present in StoreHub at all** | **Fully new** — no reference system, design from DANK's own requirements (e.g. Chicken Fried Rice example in brief) |
| E. Kitchen | None | **Not present in StoreHub at all** | **Fully new** |
| F. Suppliers & Purchasing | None | Suppliers directory (lightweight: name/email/phone only) + 4-step PO workflow (Create→Editing→Receiving→Completed) | **New**, PO state machine modeled on StoreHub's; supplier record can start lighter (name/contact) and grow |
| G. Sales & Reports | `staff.html` Sales tab (CSV export, month view), `analytics.html` | 11 distinct sales-report breakdowns + stock value + wastage reports | **Extend** existing Sales tab's data source; add report *views* incrementally, not all 11 at once |
| H. Staff/Permissions | 4 roles, ~8 flat scopes (`_staff-accounts.js`) | Fully granular per-module checkbox permissions, PIN-based, role + restricted-access combo | **Extend** `ROLE_PERMISSIONS`: keep existing roles, add `kitchen`, and move toward per-module scopes (inventory, purchasing, expenses, food_ops, kitchen_tickets) rather than a parallel auth system |
| I. Discounts/Promotions | DANK has an existing promo-code module (per brief) | Priority-ordered list, date-bounded, store-scoped, reward-flag | **Reuse DANK's existing module**; only add store-scoping/priority-order if not already present (needs a look at the actual promo code module, not yet audited this pass) |
| J. Expenses | None | **Not present in StoreHub at all** | **Fully new** |
| Multi-outlet | `branches.json` exists in repo root (not yet inspected) | First-class dimension across almost every module | Check whether `branches.json` already models DANK's outlets before designing a new stores table |

## Priority read for sequencing (suggested, not decided)

Lowest risk / highest reuse first:
1. **Staff permission extension** (H) — smallest surface area, builds directly on existing code.
2. **Inventory ledger + Product cost/supplier fields** (B/C) — the foundational schema everything
   else (F, G's COGS reporting, D's recipe costing) depends on.
3. **Suppliers & Purchase Orders** (F) — depends on C's ledger existing (receiving writes to it).
4. **Dashboard** (A) — depends on C/G existing to have real numbers to show instead of placeholders.
5. **Sales Reports expansion** (G) — incremental, can grow report-by-report.
6. **Food & Beverage + Kitchen** (D/E) — biggest net-new scope, no reference system; do after the
   core ledger exists since recipe costing depends on ingredient stock.
7. **Expenses** (J) — standalone, can slot in anytime, lowest dependency.

## Unresolved before Phase 2 architecture work

- Whether `branches.json` already covers the two-outlet model StoreHub shows (DANK pattanakarn,
  dank sathorn) — needs inspection.
- Whether DANK's existing promo-code module already has store-scoping/date-bounds, or whether that's
  a real StoreHub-inspired addition.
- Thai legal/regulatory requirements for cannabis retail recordkeeping (flagged in AUDIT.md) — not
  researched yet, needed before finalizing Module C/compliance fields for cannabis SKUs specifically.
