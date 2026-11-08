# DANK BackOffice — Database Schema

Full DDL: `supabase/migrations/0001_dank_backoffice.sql`. Additive only — no existing table is
altered. Not applied automatically; Bryan (or whoever holds the Supabase service-role key) runs it
via the Supabase SQL editor or CLI. This doc explains the *why* behind the shape; the `.sql` file is
the source of truth for the actual DDL.

## Design decisions

1. **One ledger table for both retail products and kitchen ingredients** (`bo_inventory_ledger`,
   `item_type` discriminator) instead of two parallel ledgers. Both need the exact same shape
   (qty delta, balance, reason, reference, staff, timestamp) per the brief's Module C requirement,
   and StoreHub's own audit trail treats all stock the same way regardless of category — splitting it
   would just mean every report has to union two tables.
2. **Append-only, never UPDATE/DELETE qty on a ledger row.** A correction is a new row with a
   reversing `qty_delta`. This directly satisfies "never allow staff to silently overwrite historical
   stock records" from the brief, and matches what StoreHub's own audit trail does (it explicitly
   starts logging from a point in time rather than rewriting history).
3. **Products stay owned by BRYAN POS.** `bo_product_settings`/`bo_product_stock_settings` key off
   `product_key` (the id/SKU `api/_menu.js` already assigns) rather than duplicating name/price/
   category. This is a deliberate join, not a second catalogue — avoids the "duplicate product
   databases" trap the brief explicitly warns against.
4. **`bo_stores` seeded from `branches.json`**, not StoreHub's 2-store list (see
   `BACKOFFICE_REQUIREMENTS.md` — DANK has 4 real locations, StoreHub only has 2 configured).
5. **Purchase orders and kitchen tickets both drive the ledger, never bypass it.** Receiving a PO
   line or serving a kitchen ticket is required to produce a `bo_inventory_ledger` row with
   `ref_type`/`ref_id` pointing back to the PO or ticket — this is what makes "prevent duplicate
   stock deductions" (brief, Module D) and "every inventory change must record... reference document"
   (Module C) enforceable at the application layer; `bo_kitchen_tickets.consumption_recorded` is the
   guard flag the API checks before writing consumption so a ticket can't double-deduct ingredient
   stock if marked "served" twice.
6. **RLS on, no policies** — identical posture to `site_kv` (`CLAUDE.md`'s documented pattern): only
   the service-role key can reach any `bo_*` table. No `anon`/`authenticated` access is ever granted,
   so there's no path for a client-side bug to read or write BackOffice data directly; every read and
   write goes through an `api/backoffice/*.js` function that checks staff auth first.
7. **No payment table anywhere in this schema.** `bo_purchase_orders`/`bo_expenses` track money owed
   or spent, never money collected — enforces the brief's payment-checkout exclusion at the data layer,
   not just the UI layer.

## Table summary

| Table | Purpose |
|---|---|
| `bo_stores` | Outlet master (seeded from `branches.json`) |
| `bo_product_settings` | Per-product BackOffice fields: supplier, cost, stock-tracking flag |
| `bo_product_stock_settings` | Per-product-per-store low-stock threshold + ideal/par level |
| `bo_inventory_ledger` | Append-only stock movement history, products + ingredients |
| `bo_stocktakes` / `bo_stocktake_lines` | Stock-count sessions and their counted lines |
| `bo_stock_transfers` / `bo_stock_transfer_lines` | Inter-outlet transfers |
| `bo_suppliers` | Supplier directory |
| `bo_purchase_orders` / `bo_purchase_order_lines` | PO header + line items, 4-state workflow |
| `bo_ingredients` | Kitchen ingredient master + cost |
| `bo_recipes` / `bo_recipe_lines` | Menu item → ingredient-quantity mapping |
| `bo_kitchen_tickets` / `bo_kitchen_ticket_lines` | Prep tickets, New→Preparing→Ready→Served |
| `bo_expenses` | Operating expense records |

## Not yet designed (deferred to a later pass)

- Sales report materialization — Phase 3 reads directly from existing `site_kv` order records rather
  than a new sales table, to avoid a second source of truth for sales; a dedicated `bo_sales_summary`
  rollup table can be added later if direct queries get slow.
- Any schema for the Thai cannabis-compliance recordkeeping fields (batch/lot tracking,
  traceability) — blocked on the legal research flagged in `BACKOFFICE_REQUIREMENTS.md`. Adding a
  `batch_no`/`lot_no` nullable column to `bo_inventory_ledger` later is a non-breaking change when
  that research lands.
