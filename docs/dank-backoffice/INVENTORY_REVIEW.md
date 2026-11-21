# Inventory: audit and improve the existing page

This change extends the existing Inventory tab and APIs. It does not create a
second stock system or implement automatic POS sale deductions.

## Findings and data authority

- The browser CSV catalog is local product metadata, not a branch stock ledger.
  Users may explicitly register its item IDs, names and units; imported quantities
  are never copied into branch balances.
- The POS feed is a flat snapshot without branch identity. Its quantities remain
  read-only and unallocated. Existing storefront fallback stock (99 when omitted)
  is marked unrecorded for inventory. Storefront availability behavior is unchanged.
- DANK branch balances come from the latest `bo_inventory_ledger` row by ledger ID.
  No row means unknown; a recorded zero means zero. Exact item type/key identity
  prevents name-based merging. Duplicate SKUs and orphan ledger keys are surfaced.
- Units and decimal precision must be reviewed before new inventory workflows.
  Units cannot change after ledger movements. Pack conversions are not inferred.
- Home low-stock alerts use the same per-product/per-store thresholds once the
  new snapshot RPC is installed. Before migration, Home retains its legacy policy.

## Existing page improvements

The page provides branch/category/status filters, name/SKU/barcode search,
pagination, full filtered CSV export, mobile stock cards, and branch-specific
details. It retains the all-movements view and adds direct links to count,
transfer and purchase documents. Costs require the `settings` permission.

Adjustments show the previous/resulting balance and require a reason and
confirmation. Counts distinguish an uncounted line from zero, preview variances,
and refuse completion after intervening movements. Transfers have explicit
draft, dispatched and received states: dispatch reduces the source, transit is
shown separately, and receipt increases the destination. Cancellation is allowed
before dispatch. The interface never adds incompatible units into one total.

## Database and API rollout

Apply `supabase/migrations/0004_inventory_workflows.sql` after the existing
inventory migrations (`0001` and `0002`) using the normal Supabase migration
workflow. This adds metadata, request deduplication, count snapshots and transfer
state columns, plus service-role-only `bo_inventory_command` and
`bo_inventory_snapshot` RPCs. The migration is additive and repeatable.

All inventory writes use a UUID `request_id`. Commands run within a database
transaction and lock affected items in deterministic order. Replaying a request
does not duplicate stock movements. Adjustments require the last ledger ID used
for their preview. Old one-step transfer completion is deliberately rejected;
clients must dispatch then receive. Missing schema disables new inventory writes
and shows a setup message rather than inventing balances.

Existing shared BackOffice sessions remain supported and audit as `backoffice`.
Personal staff sessions on inventory APIs use their actual staff ID and role
permissions. Named attribution requires a personal session; a shared password
does not identify the individual using it.

No production migration or deployment was performed as part of this change.

## Validation

Tests execute the real SQL with PGlite, covering initial zero balances,
fractional/integer units, retry deduplication, stale adjustments, concurrent count
changes, transactional rollback, and dispatch/receipt exactly once. API tests
cover authorization, cost redaction and preserved threshold targets. Browser QA
uses an isolated database fixture for adjustment, count approval, transfer stages,
history, search, full CSV, CSV metadata registration and mobile layout.
