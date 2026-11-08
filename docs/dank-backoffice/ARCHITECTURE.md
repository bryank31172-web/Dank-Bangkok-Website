# DANK BackOffice — Architecture (Phase 2)

Per the repo's own rule ("prefer reusing secure, tested existing systems... do not force a new
database or framework if the existing implementation is reliable"), this does **not** introduce
React/TypeScript/a bundler/npm dependencies. The existing site is a zero-dependency static+serverless
app by deliberate choice (`CLAUDE.md`), and BackOffice follows the same model so it deploys the same
way (`vercel --prod`, no build step) and so Bryan — not a developer — doesn't inherit a second stack.

## Shape

- **Frontend:** one new static page, `backoffice.html`, staff-gated the same way `staff.html` is
  (staff key / session, `X-Robots-Tag: noindex`, `Cache-Control: private, no-store`). Tab-based SPA
  inside one file, reusing `staff.html`'s **event-delegation pattern** (`data-act` + one listener)
  rather than inline `onclick`, since that's the deliberate XSS mitigation already in place there.
  Brand color `#007A4D` as requested, light/dark via `prefers-color-scheme` + a manual toggle stored
  in `localStorage` (client-only, never a security boundary).
- **Backend:** new serverless functions under `api/backoffice/` (Vercel supports nested folders;
  each `.js` becomes its own route, e.g. `api/backoffice/inventory.js` → `/api/backoffice/inventory`).
  Kept in their own folder instead of flat in `api/` because this adds ~10 endpoints and the existing
  `api/` root (60+ files already) shouldn't get harder to navigate for Bryan's existing systems.
- **Database:** the **same Supabase project** (Tokyo region) DANK already pays for, new tables
  prefixed `bo_` to make ownership obvious and keep them clearly separate from `site_kv` (website KV),
  `kv_state`/`audit_log` (BRYAN POS — off-limits, per `CLAUDE.md`). Real relational tables, not JSON
  blobs — `site_kv`'s key/value model can't sanely hold an append-only ledger or line-item tables.
- **DB access:** a new `api/_bo-db.js` helper, following `_store.js`'s existing approach exactly —
  raw `fetch()` calls to Supabase's PostgREST endpoint with the service-role key, **no new npm
  dependency** (no `@supabase/supabase-js`). Same credential (`SUPABASE_SERVICE_ROLE_KEY`) already in
  Vercel; no new secret to provision.
- **Auth:** reuses `api/_staff-accounts.js` and `api/_auth.js` as-is. `ROLE_PERMISSIONS` gets new
  scopes (see `BACKOFFICE_REQUIREMENTS.md`); no second login system, no second session format.
- **Product data:** still owned by BRYAN POS → `api/_menu.js`. BackOffice never writes
  name/price/category back to that pipeline. It only **extends** products with BackOffice-only
  fields (cost, supplier, par levels) in a new `bo_product_settings` table keyed by the product's
  existing `id`/SKU from the POS feed — a join, not a duplicate catalogue.
- **No payment code anywhere in this surface.** No endpoint under `api/backoffice/` accepts or
  processes a payment; `bo_purchase_orders` and `bo_expenses` record **amounts owed/spent**, not
  payments taken.

## Why not React/TypeScript (brief's "preferred, subject to audit")

The brief lists React/TS/Tailwind as preferred *subject to audit*. The audit (Phase 0) found a
reliable, working, deliberately-dependency-free deployment model that the repo's own docs say not to
break ("do not split `index.html`/`staff.html` into modules; that is not the deployment model").
Introducing a build step for one new page would mean DANK runs two deployment models side by side,
which is more risk for a non-developer owner than the UI benefit is worth. If BackOffice later
outgrows a single HTML file (likely, given 10+ modules), the better move is **splitting by route**
(`backoffice-inventory.html`, `backoffice-kitchen.html`, …) the same way `vercel.json` already routes
`food.html`, `staffportal.html` etc. as separate pages — still zero-build, still consistent.

## Diagram

```
BRYAN POS ──push──> api/pos-feed.js ──> site_kv (products cache) ──> api/_menu.js ──> storefront

backoffice.html (staff-gated)
   │
   ├─> api/backoffice/dashboard.js ──reads──> bo_inventory_ledger, bo_purchase_orders,
   │                                            bo_expenses, site_kv (sales), bo_kitchen_tickets
   ├─> api/backoffice/inventory.js ──writes──> bo_inventory_ledger (append-only)
   ├─> api/backoffice/stocktakes.js ─────────> bo_stocktakes, bo_stocktake_lines
   ├─> api/backoffice/transfers.js ──────────> bo_stock_transfers, bo_stock_transfer_lines
   ├─> api/backoffice/suppliers.js ──────────> bo_suppliers
   ├─> api/backoffice/purchase-orders.js ────> bo_purchase_orders, bo_purchase_order_lines
   │        (receiving a PO writes bo_inventory_ledger)
   ├─> api/backoffice/recipes.js ────────────> bo_ingredients, bo_recipes, bo_recipe_lines
   ├─> api/backoffice/kitchen.js ────────────> bo_kitchen_tickets, bo_kitchen_ticket_lines
   │        (serving a ticket writes bo_inventory_ledger for consumed ingredients, once)
   ├─> api/backoffice/expenses.js ───────────> bo_expenses
   └─> api/backoffice/reports.js ──reads──> all of the above + site_kv order/sales records

All endpoints: api/_staff-accounts.authenticateAccountKey() + a permission-scope check first.
All writes: staff_id + created_at captured server-side from the authenticated session, never from
client input.
```

## Migration strategy

New tables only — nothing existing is altered. `supabase/migrations/0001_dank_backoffice.sql`
(see `DATABASE_SCHEMA.md`) is additive and has no destructive statement. Rollback = drop the `bo_*`
tables; nothing else is touched, so rollback can't affect the live storefront, BRYAN POS sync, or
`site_kv`. **Not applied to the live database by me** — it needs `SUPABASE_SERVICE_ROLE_KEY` run
through Bryan's own Supabase SQL editor or CLI, which is a production-sensitive action requiring his
explicit execution per the brief's rule 14.
