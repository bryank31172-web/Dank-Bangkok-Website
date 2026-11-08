# DANK BackOffice — Requirements (Phase 1 output)

Synthesizes `AUDIT.md` + `STOREHUB_FEATURE_ANALYSIS.md` + `FEATURE_GAP_MATRIX.md` into what to
actually build. This is the input to Phase 2 (architecture/schema/API design), not the design itself.

## Two more facts found while closing out Phase 1

- **`branches.json` (repo root) already lists 4 DANK locations**: Pattanakarn (main), Sathorn,
  Phetchabun, and a Phuket hotel location — each with name, address, and Google Maps link. StoreHub's
  own "Stores" list only has 2 of these (DANK pattanakarn, dank sathorn) configured. **DANK's real
  multi-outlet footprint is broader than what's in StoreHub** — BackOffice's store/outlet model should
  be seeded from `branches.json`, not from StoreHub's 2-store list.
- **DANK's existing promo-code module (`api/_promotion.js`) has no store-scoping.** It supports
  percent/fixed/free-delivery/gift types, minimum-subtotal, usage-quantity caps, and start/expire
  dates — solid groundwork — but applies the same code everywhere. If DANK wants StoreHub-style
  per-outlet promotions, that's a real net-new field, not a lift from existing code.

## Requirements by module (what to build, grounded in evidence)

**A. Dashboard** — KPI cards (sales, transactions, AOV, items/order, new customers) with
day/week/month toggle and % vs. prior period; cumulative sales trend chart; sales-by-outlet
comparison (4 branches); top products; low-stock + ingredient alerts; recent stock adjustments;
open POs. Must visibly separate "estimated" from "verified" figures per the brief's compliance rule,
and footnote data source per section (recorded sale vs. imported vs. manual entry).

**B. Products** — extend, don't replace, the BRYAN POS → `_menu.js` pipeline. Add fields StoreHub
has that BRYAN POS doesn't carry today: cost price, supplier link, per-outlet low-stock threshold,
per-outlet ideal/par level. Keep catalog availability (what shows on the storefront) separate from
physical inventory count, as the brief requires — this also matches how StoreHub's own "track stock
quantity" toggle works (a product can exist without being stock-tracked).

**C. Inventory** — new append-only ledger table: product, outlet, qty delta, resulting balance,
reason, staff, timestamp, reference doc (PO/transfer/stocktake id), approval flag where required.
Model the four workflows StoreHub shows: stocktake sessions (start → count → complete), stock
transfers between outlets, an "inactive/damaged" pseudo-location pattern (StoreHub's "Inactive
stock") for write-offs rather than deleting rows, and a reorder-suggestion view driven by the
low-stock/ideal-level fields from Module B.

**F. Suppliers & Purchasing** — supplier directory can start minimal (name, contact) like StoreHub's;
add PO line items, a 4-state workflow (Draft → Ordered → Receiving → Completed) mirroring StoreHub's,
and partial-receipt support (receive triggers Module C ledger entries, quantity received may be less
than ordered).

**G. Sales Reports** — extend `staff.html`'s existing Sales tab rather than rebuilding; prioritize
by-product and by-outlet breakdowns first (StoreHub has 11 report types — don't build all at once,
see gap matrix sequencing).

**H. Staff/Permissions** — extend `ROLE_PERMISSIONS` in `_staff-accounts.js`: add a `kitchen` role;
add scopes for `inventory_view`, `inventory_adjust`, `suppliers`, `purchasing`, `expenses`,
`food_ops`, `kitchen_tickets`. StoreHub's fully-granular per-module checkbox model (vs. DANK's
current flat per-role scope list) is the better long-term shape if the owner wants finer control
later, but isn't required for v1 — flag as a future option, not an immediate requirement.

**I. Discounts/Promotions** — reuse `_promotion.js` as-is for code validation/redemption; adding
store-scoping is optional and separable (new field + a check against the ordering outlet), not a
rebuild.

**D/E/J. Food & Beverage, Kitchen, Expenses** — confirmed fully net-new (no StoreHub or DANK
reference to build on). Design these from the brief's own spec (recipe → ingredient consumption →
costing; ticket status New→Preparing→Ready→Served; expense categories/attachments/recurring). Lowest
priority for sequencing since nothing else depends on them existing first, except recipe costing
depending on Module C's ingredient stock existing.

## Still open (carry into Phase 2)

- Thai legal/regulatory requirements for cannabis retail recordkeeping — needs dedicated research
  before finalizing compliance fields on Module C for regulated SKUs. Not a software-architecture
  question; recommend treating as a separate research task (and likely needs a local legal
  professional's sign-off, not just research synthesis).
- StoreHub Stock Transfers / Stock Return workflows, 11 report-type details, Loyalty/Membership
  module — not yet surveyed; pull in if/when those modules become a near-term priority.
