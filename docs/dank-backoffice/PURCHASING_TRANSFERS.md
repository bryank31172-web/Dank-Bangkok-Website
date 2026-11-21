# Purchasing and transfer receiving (Priority 5)

This extends the existing Inventory → Purchase orders and transfer workflows.
No production database or deployment was changed.

## Operator workflow

- Open Inventory → **ใบสั่งซื้อ**. Search document numbers, or filter by branch,
  supplier and status. Lists load in batches of 50, with a load-earlier button.
- Create a draft with an active supplier, destination branch and expected date.
  Search registered products/ingredients by name, SKU or barcode. Enter quantities
  in the displayed unit and costs in THB per that unit. Drafts can be edited.
- Confirm ordering to lock the lines. This does not change stock.
- Record only the quantities physically received in the current delivery. Blank
  or zero leaves a line unchanged. The preview shows ordered, received and remaining
  quantities; receipts increase only the receiving branch's stock.
- Later deliveries can receive the remainder. The document becomes completed only
  when every ordered unit was received. A supplier unable to fulfil the remainder
  can be handled with **ยุติการรับส่วนที่เหลือ**, requiring a reason. Status becomes
  **ปิดก่อนรับครบ**, retaining actual receipts and separately cancelled quantities.
- Transfer drafts can be cancelled before dispatch. Dispatch removes source stock;
  destination receipts can occur in multiple batches. Only the unreceived remainder
  stays in transit. **ปิดรายการที่รับไม่ครบ / ของขาด** records a shortage and closes
  transit without adding destination stock or silently returning it to the source.
  Found goods require a separate reviewed adjustment referencing the document.
- Document details show receipt batches, notes, actors and times. Inventory movement
  links open the exact purchase document, including documents outside the current list.

An unknown branch balance must be physically established before the first receipt.
Count the quantity present before the delivery (including a confirmed zero); do not
count the delivery and then receive it again. A receipt never assumes an unknown
starting balance is zero. Register and review units in Inventory before creating
new purchase lines. Unit conversions are not inferred.

## Technical rollout

Apply migrations in order: existing inventory schema, `0004_inventory_workflows.sql`,
then `0005_purchasing_receiving.sql`. Migration 0005 is additive and repeatable,
preserves historical completed transfers as fully received, and introduces:

- PO revisions, snapshot item names/units, cancelled remainder quantities and a
  distinct `closed` status;
- cumulative actual transfer receipts, missing quantities and receipt revisions;
- RLS-protected `bo_supply_events` for receipt batches and closure notes;
- a service-role-only transactional `bo_supply_command` RPC.

The existing `/api/backoffice/purchase-orders` endpoint supports GET, POST and
draft editing via PATCH. Every write needs a UUID `request_id`; non-create actions
need `expected_revision`. Actions: create, edit, send, receive, cancel, close.
`receive.lines` contains `{line_id, qty_received}` deltas for this delivery.

Transfer dispatch/cancel still use the inventory command. Receive/close use the
new supply RPC with `expected_revision` from `receipt_version`. Receive lines are
`{item_type, item_key, qty_received}` deltas. Previous blind full-receipt requests
without a revision are rejected; use the updated UI.

Commands lock the document, validate all receipt lines, acquire the existing item
advisory locks in deterministic order, and atomically commit quantities, stock,
events, revisions and PO audit records. Retry keys persist across uncertain network
responses. A successful command releases the UI's retry key so a later intentional
identical order can create a new document. A stale revision cannot overwrite another
receiver's work. Ledger writes keep the original PO/transfer reference.

Purchase mutations and purchasing costs require `purchasing`. Inventory viewers
can read document details and receipt history with unit costs redacted. Personal
staff sessions preserve named attribution; the shared BackOffice login records
`backoffice`. Missing migration shows a setup message and fails writes closed.

## Validation

Real SQL tests with PGlite cover migration replay, sequential PO numbers, duplicate
request handling, units, draft revisions, invalid batch rollback, over-receipts,
partial receipts, stale receivers, cancellations, unfulfilled PO closure, transfer
shortages and unknown starting balances. API tests cover named actors, receipt
history, authorization and cost redaction. The old in-memory PO tests were replaced
by this real SQL/API coverage.

Isolated browser QA covers product search, create/edit/send, expected-date retention,
two delivery batches, stock changes, transfer shortage closure and mobile layouts.
This work does not implement POS sale synchronization, supplier messaging, pack
conversions or payment verification.
