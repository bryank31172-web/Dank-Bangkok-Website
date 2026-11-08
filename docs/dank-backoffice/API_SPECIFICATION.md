# DANK BackOffice — API Specification

All endpoints live under `/api/backoffice/`. Every request requires a staff key/session recognized
by `api/_staff-accounts.js` (same header/cookie convention as the existing staff console) and is
rejected `401` if missing/invalid, `403` if the authenticated staff member lacks the required
permission scope. Every write captures `staff_id` server-side from the authenticated session — the
client never supplies who performed an action.

Response envelope matches the existing API style in this repo (plain JSON, `{error: "..."}` on
failure, `503 {error:"not configured"}` if `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are unset).

## `/api/backoffice/stores`
- `GET` → list of outlets (seeded from `branches.json`, synced into `bo_stores` on first read).
  Scope: any authenticated staff.

## `/api/backoffice/dashboard?range=today|week|month&store=<id|all>`
- `GET` → aggregated KPIs: sales (from `site_kv` order records), low-stock count (from
  `bo_product_stock_settings` vs latest ledger balance), open PO count/value, pending kitchen
  tickets, recent stock adjustments (last 10 ledger rows), ingredient alerts. Every figure tagged
  `source: "recorded" | "estimated"` per the brief's compliance rule. Scope: `dashboard`.

## `/api/backoffice/inventory`
- `GET ?item_type=&item_key=&store=&from=&to=` → ledger rows (paginated, newest first). Scope:
  `inventory_view`.
- `POST {item_type, item_key, store_id, qty_delta, reason, note}` → manual adjustment. Server
  computes `balance_after` from the latest prior row for that item+store (serialized via a
  Postgres transaction — see Phase 6 concurrency test). Scope: `inventory_adjust`. `reason` must be
  one of the allowed values in `DATABASE_SCHEMA.md`; free-text goes in `note`.

## `/api/backoffice/stocktakes`
- `GET` → list of sessions. `POST {store_id}` → start a session (snapshots current balances into
  `bo_stocktake_lines.expected_qty`). `PATCH {id, lines:[{item_type,item_key,counted_qty}]}` → record
  counts. `POST {id}/complete` → writes one `bo_inventory_ledger` row per line whose counted≠expected
  (`reason:'stocktake'`), sets session `completed`. Scope: `inventory_adjust` to complete, `inventory_view` to read.

## `/api/backoffice/transfers`
- `GET`, `POST {from_store_id,to_store_id,lines}` (status `pending`), `POST {id}/complete` → writes
  a `transfer_out` ledger row at the source and `transfer_in` at the destination, same `ref_id`.
  Scope: `inventory_adjust`.

## `/api/backoffice/suppliers`
- `GET`, `POST {name,contact_name,phone,email,address,note}`, `PATCH {id,...}`,
  `DELETE {id}` (soft: sets `active:false`, never hard-deletes — POs reference suppliers historically).
  Scope: `suppliers`.

## `/api/backoffice/purchase-orders`
- `GET ?store=&supplier=&status=`, `POST {supplier_id,store_id,lines,expected_date,note}` (status
  `draft`), `PATCH {id,...}` (while `draft`/`ordered`), `POST {id}/send` (→ `ordered`),
  `POST {id}/receive {lines:[{line_id,qty_received}]}` (→ writes `bo_inventory_ledger` rows
  `reason:'receive_po'`, supports partial receipt — status becomes `receiving` if any line is
  partial, `completed` once every line's `qty_received >= qty_ordered`). Scope: `purchasing`.

## `/api/backoffice/recipes`
- `GET`, `POST {menu_item_key,name,yield_qty,instructions,lines:[{ingredient_id,qty}]}`,
  `PATCH`, `DELETE` (soft). Scope: `food_ops`.

## `/api/backoffice/ingredients`
- `GET`, `POST {name,unit,cost_per_unit,supplier_id}`, `PATCH`, `DELETE` (soft). Scope: `food_ops`.

## `/api/backoffice/kitchen`
- `GET ?store=&status=` → open tickets. `POST {store_id,lines,order_ref?}` → new ticket, `status:new`.
  `PATCH {id,status}` → New→Preparing→Ready→Served (server rejects out-of-order transitions).
  On transition **to `served`**: if `consumption_recorded` is false, for each line look up its
  recipe and write one `bo_inventory_ledger` row per ingredient (`reason:'kitchen_consumption'`,
  `ref_type:'kitchen_ticket'`), then set `consumption_recorded:true` in the same transaction — this
  is the "prevent duplicate stock deductions" guarantee from the brief; retrying the same PATCH is a
  no-op once the flag is set. Scope: `kitchen_tickets`.

## `/api/backoffice/expenses`
- `GET ?store=&category=&from=&to=`, `POST {store_id,category,vendor,amount,expense_date,recurring,note}`,
  `PATCH`, `DELETE` (hard delete allowed — expenses aren't referenced elsewhere, but still logged via
  response `staff_id`/timestamp for now since there's no general audit table). Scope: `expenses`.

## `/api/backoffice/reports/*`
- `sales-by-product`, `sales-by-store`, `stock-value`, `cogs` — read-only aggregations. First two
  ship in Phase 3; `stock-value`/`cogs` in Phase 5 per the gap matrix's sequencing. Scope: `dashboard`
  (reports are read access, not a separate scope — matches StoreHub's own model where Reports is one
  permission toggle, not one per report).

## Error/empty-state convention

Every list endpoint returns `{rows: [], total: 0}` rather than erroring when nothing matches —
matches `/api/sales`'s existing behavior pattern rather than introducing a new one.
