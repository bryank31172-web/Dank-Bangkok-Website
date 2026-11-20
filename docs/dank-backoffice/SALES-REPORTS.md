# Sales over time and receipt reconciliation

Home, All transactions and Sales over time use the `orders:index` and archived
order IDs in DANK's existing storage. No StoreHub/POS import is implied. The new
sales endpoint reads every indexed record in batches of 40 and reports missing
records in coverage metadata. Sample mode uses a stable Home receipt snapshot.

`assets/backoffice-sales.js` defines Bangkok date boundaries, grouping, filters,
normalization, satang precision and totals for both browser and server. Dates
use an inclusive start and exclusive end. Weeks start Monday. A return/refund
document subtracts from totals; cancellations never become returns. Missing
tax or sale-time cost stays null and displays as an em dash. Customer counts
require a stable ID/phone; first purchases mean first purchase in retained data.
Average net receipt value is labelled separately from Home's average total
receipt value including tax/charges.

Reports export all time buckets to CSV and print all table rows for PDF,
regardless of pagination. Saved filter sets are browser-local and retain
relative presets. CSV protects spreadsheet formula cells. Receipt identifiers
remain strings. Clicking a bucket opens its complete filtered receipt set;
the return button restores the report state.

## Optional recurring email reports

The management-only `/api/backoffice/report-delivery` endpoint stores schedules
in persistent site_kv/Redis. It is disabled unless persistent storage,
`RESEND_API_KEY`, `REPORT_EMAIL_FROM`, `CRON_SECRET`, and
`REPORT_SCHEDULER_ENABLED=true` are configured. The sender must be verified
with Resend. No email is sent merely by saving a schedule.

Install an hourly scheduler calling `GET /api/backoffice/report-delivery-run`
with `Authorization: Bearer <CRON_SECRET>`. On Vercel plans supporting hourly
cron, merge `{"path":"/api/backoffice/report-delivery-run","schedule":"0 * * * *"}`
into vercel.json's crons array. Alternatively use a trusted external hourly
scheduler with the same header. The repository does not enable a paid-plan
cron automatically. Set REPORT_SCHEDULER_ENABLED only after installing it.

Schedules use Bangkok hours: daily reports cover yesterday, weekly reports
run Mondays for the completed Monday–Sunday week, and monthly reports run on
the first for the completed month. Runs after the scheduled hour can catch up
the same day. Provider acceptance is shown as acceptance, not delivery proof.
Failed sends retry on the next hourly invocation that day, using the same
Resend idempotency key and persistent sent marker to prevent duplicates.
Missing records or a storage fault stop delivery. Each recipient address is
explicitly supplied by a manager; no real email is sent in automated tests.

Setup references: https://vercel.com/docs/cron-jobs/usage-and-pricing and
https://resend.com/docs/dashboard/emails/idempotency-keys.
