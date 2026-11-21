# StoreHub BackOffice — Feature Analysis

Observed via the authorized `dankclub.storehubhq.com` merchant account (owner: อรรฒพร ก้องธรนินทร์ /
Bryan's store "DANK pattanakarn" + "dank sathorn", 2 physical outlets). Observation only — UI
navigation, page layouts, fields, and workflows. No network/API traffic was captured; the one
StoreHub API reference used (`api/_storehub.js` in the DANK repo) is their own already-built,
officially-documented connector, not something extracted from this session.

## Full navigation map (observed, read_page accessibility tree)

| Section | Sub-pages |
|---|---|
| Dashboard (`/dashboard`) | — |
| Membership (`/membership`) | Members, Settings, Points, Cashback loyalty |
| Online Orders (`/onlineStore/orders`) | Beep QR, Beep Delivery |
| Online Store | Webstore, Appearance, Marketing, Payouts |
| Transactions (`/transactions`) | Returns, Pre-orders |
| Reports (`/reports`) | Sales over time, by product, by category, by variant, by SKU, by channel, by payment method, shifts, pre-orders, promotions, tax |
| Customers/Loyalty (`/loyalty/customers`) | Automated SMS campaigns, campaign insights, feedback insights, SMS credit log |
| Products (`/products`) | Shared modifiers, Price books, **Suppliers** |
| Stock (`/stocks/*`) | **Supply needs** (reorder), Stock value report, **Purchase orders**, **Stock return**, **Stock takes**, Wastage report, **Stock transfers**, **Audit trail** |
| Employees (`/employees`) | Timesheets, Performance, Activity log, Commission settings |
| Promotions (`/promotions`) | CFDs |
| Settings | Account, Tax, **Stores** (multi-outlet), Payment options |
| Billing | Plans, SMS |

**Note:** No dedicated Food & Beverage / Recipe / Kitchen-ticket module exists anywhere in this nav,
and no Expenses module. These two areas of the DANK BackOffice brief (Module D/E/J) are genuinely
net-new — there's nothing in StoreHub to model them on, which matches the brief's goal of improving
on StoreHub rather than just copying it.

## Module A — Dashboard (observed)

- Today / This week / This month toggle, explicit date range shown.
- 5 KPI cards, each with a tooltip and a "view report" link: total sales (+ % change vs. prior
  period), new customers, total transactions, average order value, average items per order.
- Cumulative sales line chart, today vs. yesterday, hourly buckets.
- Sales-by-channel donut (online vs. offline %).
- **Sales by store/outlet** horizontal bar chart — per-outlet comparison, confirms multi-outlet
  reporting is a dashboard-level concern, not just a filter.
- Top-selling products list (name, units sold, "days sold" metric).

## Module B — Products

- List: paginated table (460 products observed), columns Name/SKU/Barcode/Category/Tags/
  Cost/Price-excl-tax/Margin %/Quantity. Search by name/SKU/barcode. Bulk CSV import (products,
  modifier groups, serial numbers) and CSV export. Bulk-action dropdown.
- Detail/edit page (two tabs: Basic, Online info):
  - General: name*, SKU, category, tags (tag-search input), product image upload, **supplier**
    dropdown (so supplier is a per-product field, not just a PO field).
  - Pricing: price type (fixed/variable), cost, price excl. tax, price incl. tax (auto-computed),
    and a **separate online price block** (Beep/webstore) with its own tax math and a
    "price after discount" preview.
  - Inventory & variants: "track stock quantity" toggle (can be turned off per product), "has
    multiple variants" checkbox, stock type (locked after creation — new stock type requires a new
    product), new "Unit of Measure" feature (buy by carton, sell individually, with unit
    conversion), barcode field supporting **multiple barcodes per product** with a generator.
  - **Per-store stock table**: one row per outlet (including the "Inactive stock" pseudo-location
    used for damaged/written-off items), columns: quantity, low-stock alert threshold, ideal/par
    stock level, and an "inspect" link into that store's movement history for the product.

## Module C — Inventory

- **Supply Needs** (`/stocks/supplyNeeds`): reorder-suggestion list, store-scoped, shows each
  under-threshold product with current qty / ideal qty / qty needed; lets you select items and
  either "Transfer" stock between outlets or "Create PO" directly from the shortfall list.
- **Purchase Orders** (`/stocks/purchaseOrders`): list filterable by destination store / supplier /
  status; each PO is a card (PO number, total, status badge, order date, expected-receipt date,
  store, supplier). Detail page is an explicit **4-step workflow**: Create → Editing → Receiving →
  Completed, with a progress bar. Line items table (product, SKU, qty, qty-to-order, supplier unit
  price, running total), tax/discount/total footer, notes field, actions: Save / Save & Email /
  **Receive order →** (separate receiving step, implying partial-receipt support).
- **Stock Takes** (`/stocks/stocktakes`): list of past count sessions (date, completion time, store,
  "supplier" filter, description, status). "Start stock count" to begin a new session.
- **Stock Transfers, Stock Return**: present as separate nav items (not deep-surveyed this pass —
  flagged as an open unknown below).
- **Audit Trail** (`/stocks/auditTrail`): per-product, per-store stock movement ledger — explicitly
  warns it has no record of manual qty edits before a cutover date, i.e. it's an append-only ledger
  that only started logging from a point in time, not a reconstructed history. Filterable by
  product, date range, store.
- **Stock value report, Wastage report**: separate reports (not deep-surveyed).

## Module F — Suppliers & Purchasing

- Suppliers directory (`/products/suppliers`): simple list, search by name/email/phone, each record
  is just name + email + phone (no address/terms/lead-time fields observed) — lighter-weight than
  the brief's "supplier directory with contacts, cost history" ask. In this account, supplier names
  are effectively used as category tags (Bar, Beer, Cbd, Cigar…), which is this business's own usage
  pattern, not a StoreHub constraint.
- Purchase ordering and receiving is covered above (Module C) — StoreHub treats "Suppliers" and
  "Purchase Orders" as linked but separate screens under Products/Stock respectively.

## Module G — Sales & Reports

- Reports section has 11 distinct sales-report views (over time, by product/category/variant/SKU,
  by channel, by payment method, shifts, pre-orders, promotions, tax) plus a separate stock-value
  and wastage report under Stock. Not deep-surveyed page-by-page this pass (flagged below).

## Module H — Staff / Permissions (the most detailed finding)

- Employee record: first/last name, email, phone, **employee code/PIN** (used for POS login, has a
  "Change" action separate from editing other fields), assigned store (or "All Stores").
- **Three base role checkboxes** (combinable): Cashier (แคชเชียร์), Store Manager (ผู้จัดการร้าน),
  BackOffice.
- BackOffice access is then either "Full access" or "Restricted access" (radio choice). Restricted
  access reveals a **fully granular permission checklist**, grouped by section, matching the nav
  almost 1:1:
  - General: Dashboard, Transactions list, Promotions, Reports
  - Membership: member insights, membership settings, points settings, cashback settings
  - Online Orders: online orders, QR order & pay, Beep delivery, online store, payouts
  - **Stock management** (11 separate permission toggles): supply needs, stock value, purchase
    orders, stock return, stock transfer, **stock take**, wastage report, record wastage, stock take
    via mobile app, **audit trail**, products & raw materials
  - Employees: manage employees/timesheets/activity log, employee performance
  - Settings: accounting/tax/receipts/payment channels, stores, POS terminal, POS layout, bank
    accounts
  - Billing: plans & SMS billing
- This is meaningfully more granular than DANK's current `_staff-accounts.js` (4 roles × ~8 flat
  scopes). It's strong evidence for how to design the new permission matrix: **per-module checkbox
  permissions**, not just role names.

## Module I — Promotions

- Priority-ordered list (explicitly: "promotions apply top-to-bottom", drag-to-reorder). Each promo:
  name, active/inactive toggle, valid-from/valid-to dates, applicable store(s) (e.g. "online store,
  all stores"), and a yes/no flag for "is this a membership reward?". 9 promotions existed on this
  account at observation time (discount vouchers, cash-redemption rewards).

## Module 13 — Multi-outlet

- Settings → Stores: simple list (name, city, postal code), "Add store" button. Confirms the
  **"Inactive stock" entry seen throughout is a real pseudo-store/location**, used as a holding bin
  for stock pulled from sale (damaged/inactive), not a bug — a pattern worth reusing for DANK's
  damaged/waste tracking.
- Store scoping appears consistently as a filter across Dashboard, Products (per-store stock table),
  Stock modules, Employees (assigned store), and Promotions (applicable stores) — it's a first-class
  dimension threaded through almost every module, not a bolt-on.

## Open unknowns (not surveyed this pass)

- Stock Transfers and Stock Return workflows (nav items confirmed, screens not opened).
- Reports detail pages beyond the dashboard summary (11 sales report types, stock value, wastage —
  not opened individually).
- Membership/loyalty module detail (points rules, cashback rules).
- Online Store / Beep ordering flow detail.
- Commission settings, employee performance/timesheet detail.
- Billing/plans detail.

These are straightforward to fill in with another survey pass if the Sales Reports or Loyalty
modules become a near-term priority for DANK BackOffice.
