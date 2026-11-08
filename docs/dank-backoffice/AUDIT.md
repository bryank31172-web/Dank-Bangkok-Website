# DANK BackOffice — Phase 0 Audit

Audit of the existing `Dank-Bangkok-Website` repo, done before any BackOffice design work, per the
"audit before coding / preserve existing functionality" rules in the brief.

## Stack (observed)

- **No framework, no build step.** `package.json` has no dependencies (`{"name":"dankbkk-site","private":true,"type":"module"}`).
  Pages are hand-written `.html` files with inline `<script>`/`<style>`. `index.html` (~539KB) and
  `staff.html` (~119KB) are deliberately single files per `CLAUDE.md` — **do not split them into
  modules**, that breaks the deployment model the team has chosen.
- **Hosting:** Vercel. The repo root is served as static files; every file in `api/` becomes a
  serverless function (files prefixed `_` are shared helpers, excluded from the function count).
  Routing/rewrites/redirects live in `vercel.json`.
- **Storage:** Supabase (Tokyo region), table `public.site_kv` (key / value **jsonb** / expires_at) via
  `api/_store.js`. Falls back to Upstash Redis, then in-memory, in that order. **This is a KV store,
  not a relational schema** — there are no normalized `products`/`inventory`/`orders` tables today.
  RLS is on with no policies; only the service-role key can read/write it.
- **Auth:**
  - Staff: a legacy flat `STAFF_KEY` plus a newer per-account system (`api/_staff-accounts.js`) with
    HMAC-hashed keys and 4 roles already modeled: `owner` (`*`), `manager`, `professional`, `parttime`.
    Permission scopes today: `orders, dashboard, sales, products, announcements, staff_manage,
    promotions, announcement_read`. **No `kitchen` role, no inventory/suppliers/expenses/F&B scopes
    yet** — these need to be added, not invented from scratch as a parallel system.
  - Owner: separate `ADMIN_EMAIL`/`ADMIN_PASSWORD` (SHA-256 hashed)/`ADMIN_SECRET`-signed session.
- **Product/catalogue source of truth:** `api/_menu.js` → `fetchUpstream()`, first hit wins:
  1. BRYAN POS push feed (`api/pos-feed.js`) — **this is what's live today, ~385 products**
  2. generic `MENU_FEED_URL`
  3. BRYAN POS pull
  4. **StoreHub** (legacy fallback, not primary)
  5. bundled `products.json`
- **Existing StoreHub integration (`api/_storehub.js`):** a real connector built to StoreHub's
  **official documented REST API** — HTTP Basic auth, `GET /stores`, `GET /products`,
  `GET /inventory/<storeId>`, `POST /transactions`. Read access to inventory is read-only (no PUT);
  writing stock back isn't possible through this API. This is the legitimate reference for any future
  StoreHub interoperability — it was built from documentation, not by reverse-engineering the
  dashboard.
- **Other integrations already wired:** Shopify (dual order book, `api/_shopify.js`), LINE, WhatsApp,
  Telegram, Omise/2c2p/GBP payment webhooks, Google Maps (delivery). All of this is **payment/ordering
  infrastructure that the BackOffice brief explicitly excludes** — it should be left alone, not
  touched or duplicated.
- **Testing:** no formal test runner; `tests/` holds ad-hoc Node scripts, mostly around delivery
  logic. No DB/migration tests exist yet (relevant to Phase 6's QA requirements).

## What this means for DANK BackOffice

1. **Reuse, don't duplicate, the product catalogue.** `api/_menu.js`/`pos-feed.js` is the existing
   source of truth for products/stock from BRYAN POS. BackOffice's Product/Inventory modules should
   read and extend this pipeline (e.g., add a relational products table that BRYAN POS feed writes
   into, and that BackOffice reads/writes for cost price, suppliers, recipes — fields BRYAN POS
   doesn't carry), not stand up a second catalogue.
2. **Storage needs a real schema addition.** `site_kv`'s JSON-blob model can't hold an append-only
   stock ledger, purchase orders, recipes, or relational supplier data sanely. This is the biggest
   architectural decision: add proper Postgres tables in the same Supabase project (keeping `site_kv`,
   `kv_state`, `audit_log` untouched) rather than forcing ledger data into KV blobs.
3. **Staff roles need extending, not replacing.** `ROLE_PERMISSIONS` in `_staff-accounts.js` already
   has owner/manager/professional/parttime. Add `kitchen` and the new permission scopes
   (`inventory`, `inventory_adjust`, `suppliers`, `purchasing`, `expenses`, `food_ops`,
   `kitchen_tickets`) to the existing object instead of building a second auth system.
4. **Cannabis is a regulated product here** (`CLAUDE.md`/`PROJECT-HANDOVER.md` both confirm DANK is a
   Bangkok cannabis dispensary, plus food/drinks). Inventory/compliance features for cannabis SKUs need
   real Thai-law research (Phase 1/5), not assumptions — flagged as an open unknown below.
5. **Do not touch:** `index.html`/`staff.html` single-file structure, the payment webhooks, the
   Shopify dual-order-book sync, or `MASTER_PIN`/`POS_SYNC_KEY` env wiring. None of this is in scope
   and all of it is load-bearing for the live shop.

## Open unknowns (Phase 0)

- Exact current relational needs for F&B/kitchen (no recipe/ingredient data exists anywhere in this
  repo today — Module D/E are 100% net-new, no existing code to extend).
- Current Thai legal/regulatory requirements for cannabis retail recordkeeping — not yet researched
  (Phase 1/5 task).
- Whether `kv_state`/`audit_log` (BRYAN POS's own Supabase tables, explicitly off-limits to merge with
  `site_kv`) already contain any sales/inventory history worth reading (read-only) for the Sales
  Reports module, instead of re-deriving everything from scratch.
