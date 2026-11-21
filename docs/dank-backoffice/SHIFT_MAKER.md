# DANK BackOffice — Shift Maker

Spec: `DANK_SHIFT_MAKER_MASTER_PROMPT.md` (repo root). This file is the
repository-specific plan, the architecture decisions, the API and permission
reference, and the honest status of every phase.

## 1. Audit findings (Nov 2026)

| Area | What exists | Consequence for Shift Maker |
|---|---|---|
| Frontend | Plain HTML + inline JS, no build. `backoffice.html` (Thai-first SPA, `data-act` event delegation) and `staffportal.html` (inline `onclick`). Add-on ES modules in `assets/` (e.g. `assets/backoffice-sales.js`, dynamically imported). | Shift Maker UI is an add-on module, `assets/backoffice-shifts.js`, imported the same way. `backoffice.html` only gets nav hooks. |
| Backend | One Vercel function per file in `api/`; `_`-prefixed files are helpers. BackOffice routes under `api/backoffice/`. | Two new functions: `api/backoffice/shifts.js` (management) and `api/my-shifts.js` (staff self-service). Helpers in `api/_shifts.js`. |
| Database | Supabase via raw PostgREST `fetch` (`api/_bo-db.js`), `bo_*` tables, RLS on with no policies, migrations in `supabase/migrations/`, verified against real Postgres with PGlite. | New migration `0003_shift_maker.sql`, additive only, same RLS posture. |
| Staff identity | `api/_staff-accounts.js`: named accounts in `site_kv` key `staff:accounts:v1` with roles owner / manager / professional / parttime / kitchen. The BackOffice "พนักงาน" directory is **browser localStorage only** (`dankBOEmployees`) and is not authoritative. | `employee_id` on every shift is the staff **account id**. No duplicate staff table. |
| Auth | Staff portal: signed per-person tokens with role. BackOffice: one shared password → a `backoffice` session with no person attached. | `/api/backoffice/shifts` accepts the BackOffice session (treated as owner-level, as it already holds `settings`) **or** a personal owner/manager token. Staff self-service needs a personal token → lives in the staff portal. |
| Attendance / leave / availability | None exist. | Built new (leave, availability). Attendance is Phase 5: identifiers and a tested comparison function only. |
| PDF | No PDF library; zero runtime npm dependencies by policy. | A print-specific renderer page `shift-print.html` (A3/A4 landscape `@page`, embedded Thai/English web fonts). "Save as PDF" through the browser's print engine. |
| Tests | `node --test tests/`, fake-fetch Supabase doubles, PGlite for SQL. 245 passing at start. | Same patterns: engine unit tests, API tests with a fake PostgREST, migration tests on PGlite. |

## 2. Key decisions

1. **Same-employee overlap is enforced by the database**, not just the app:
   an exclusion constraint on `(employee_id, tstzrange(starts_at, ends_at, '[)'))`
   for live rows. Two managers racing to double-book Emma cannot both win —
   the second insert gets Postgres error `23P01`, which the API turns into a
   `409` with a plain explanation. Half-open ranges mean 09:00–17:00 and
   17:00–21:00 do not collide. Different employees are never constrained.
2. **Draft vs published is a snapshot model.** Managers edit live
   `bo_shift_assignments` rows (the draft). Publishing validates on the server
   and writes an immutable snapshot to `bo_schedule_publications`. Staff only
   ever read snapshots, so draft edits are invisible to them by construction.
   Republishing diffs against the previous snapshot and notifies only staff
   whose shifts changed.
3. **Optimistic concurrency**: every assignment and period carries `version`.
   Updates filter on the expected version; zero rows updated → `409 stale`.
   Publish requires the period version the manager reviewed.
4. **Safe retries**: the client generates the assignment UUID, so a retried
   create hits the primary key and returns the existing row instead of a
   duplicate.
5. **Asia/Bangkok is fixed UTC+7 (no DST).** Timestamps are stored as
   `timestamptz`. A shift belongs to the business date of its start; overnight
   shifts are allowed and counted in the week their minutes fall in.
6. **One shared engine** (`assets/shift-engine.js`) is imported by the browser,
   the print page and the server, so the UI preview and the server verdict use
   the same arithmetic. The server's verdict is the authoritative one.
7. **Weekly-hours thresholds are planning alerts**, configurable per staff
   category (default 48 h, the figure in the settings is not a legal or payroll
   determination). Nothing here computes payable overtime.

## 3. Data model (migration `0003_shift_maker.sql`)

`bo_shift_settings`, `bo_shift_templates`, `bo_staffing_requirements`,
`bo_schedule_periods` (one per store per Monday), `bo_shift_assignments`,
`bo_schedule_publications`, `bo_staff_availability`, `bo_staff_leave`,
`bo_shift_change_requests`, `bo_staff_notifications`, plus
`bo_shift_bump_period()` (atomic version counter). Audit uses the existing
`bo_audit_log`. All tables: RLS on, no policies (service role only).
`btree_gist` is required for the exclusion constraint.

## 4. API and permissions

New scopes: `shifts_manage` (manager + owner + BackOffice session),
`shifts_settings` (owner + BackOffice session), `shifts_self`
(manager, professional, parttime, kitchen).

`/api/backoffice/shifts` (`shifts_manage` unless noted), `?resource=`:

| resource | methods | notes |
|---|---|---|
| `bootstrap` | GET | employees, stores, templates, requirements, settings |
| `range` | GET `from,to,store` | assignments, periods, leave, availability for the visible range |
| `assignment` | POST / PATCH / DELETE | validated server-side every time; `allowSplit` override |
| `validate` | POST | dry-run of a proposed shift (UI preview) |
| `copy-week` | POST `{store,from,to,apply,sourceIds}` | preview, then apply as draft; idempotent |
| `publish` | POST `{store,week,version,acknowledge}` | blocks on errors, requires ack for warnings |
| `publications` | GET | version history |
| `templates`, `requirements`, `settings` | GET / POST / PATCH / DELETE | writes need `shifts_settings` |
| `leave`, `availability` | GET / PATCH (decide) | approval audit; affected published shifts returned |
| `change-requests` | GET / PATCH (decide) | approval re-validates through the normal path |
| `print` | GET | authorised dataset for the PDF renderer |

`/api/my-shifts` (`shifts_self`, own data only): `GET` published shifts + own
hours; `POST {action:"leave"|"availability"|"change"|"cancel"|"read"}`.
A staff member can never read another person's shifts, leave or hours, and
never sees a draft.

## 5. Phases and status

| Phase | Scope | Status (20 Nov 2026) |
|---|---|---|
| 1 Foundation | RBAC, migration, CRUD, Week/Day/Month views, templates, auto-hide, conflict engine | Built, tested, checked in a browser against a local harness |
| 2 Workforce | coverage, weekly hours, leave/availability, copy week, publish + history | Built, tested, checked in a browser |
| 3 PDF | `shift-print.html`, weekly/monthly/individual, A3 + A4 | Built; sample PDFs generated by Chrome's print engine in `shift-maker-samples/` |
| 4 Self-service | My Shifts in staff portal, change requests, notifications | Built, tested, checked on a phone-size screen |
| 5 Attendance | **prep only**: `compareAttendance()` + tests, schedule ids are stable for linking. No clock-in data exists, so nothing is compared yet. | **Not integrated** |

None of this is live. Nothing was deployed and the migration has not been
run against the real Supabase project.

### Calendar layout (changed 20 Nov 2026, Bryan's pick "Option C")

- **Week** is a roster: one row per person, one column per day, a shift
  card per cell, weekly hours on the right. Overlapping shifts can never
  squeeze each other because each person has a row. The old vertical
  side-by-side lane calendar and the separate Staff view are gone.
- **Day** (click a day header) shows the same rows along the clock; drag a
  bar to move it, drag onto another row to give it to that person, drag the
  right edge to change the end, click an empty row to add a shift there.
- A **coverage row** under both views shows heads per hour: green = spare,
  amber = exactly the target, red (hatched) = short. Pointing at (or tapping)
  a bar shows who is on, and when short, who is free to cover.
- **Red only means something to fix**: short hours, a blocking problem such
  as a double-booking (red outline), or a shift on approved leave. Two
  different people on together is normal and is not coloured.
- The printed PDF layouts were not changed.

### Ease-of-use additions (20 Nov 2026)

- **Tidier screen**: the "shared-coverage overlaps" badge and the duplicate
  Weekly hours / Coverage by day panels are gone (the roster shows both).
  Each day header shows people and paid hours for that day.
- **One language**: every Shift Maker label is in the BackOffice dictionaries
  (`assets/backoffice-locales/{th,en,my}.json`), so it follows the language
  switch instead of half-translating. Names, roles typed by the manager and
  template names are data and stay as written.
- **Fill the gap**: click a red coverage bar → the box lists people who can
  cover that short window without breaking a hard rule (fewest hours first);
  one click creates the shift.
- **One-tap templates**: click an empty roster box → pick Morning / Afternoon /
  … or "Custom time…".
- **Copy a person's week**: click a name → copy this week to next week, or
  repeat it for 4 weeks. The shift editor also has "Repeat every week".
  Copies go in as drafts; the server checks each one and anything that would
  clash is listed, not saved.
- **Undo** (button or Ctrl+Z): last 25 adds, moves, deletes, copies and
  auto-fills. A bulk action undoes as one step. Undo is per browser tab and
  is lost on reload.
- **Role filter**: shows only shifts of one role; coverage then uses only
  targets set for that role.
- **Auto-fill** (`planAutoFill()` in `assets/shift-engine.js`, tested in
  `tests/shift-autofill.test.js`): proposes shifts for every short window in
  the week — smallest template that covers the gap, else the exact window —
  picking the person with the fewest hours who passes every hard rule and stays
  under their weekly threshold. Shown as a ticked list; nothing is saved until
  confirmed. It does not know skills, wages or preferences beyond the
  availability staff entered.

## 5a. Files

New: `supabase/migrations/0003_shift_maker.sql`, `assets/shift-engine.js`,
`assets/backoffice-shifts.js`, `assets/backoffice-shifts.css`,
`assets/shift-print.js`, `assets/staff-shifts.js`, `shift-print.html`,
`api/_shifts.js`, `api/backoffice/shifts.js`, `api/my-shifts.js`,
`tests/shift-engine.test.js`, `tests/shift-api.test.js`,
`tests/shift-migration.test.js`, `tests/shift-print.test.js`, this file and
`shift-maker-samples/`.

Changed (small hooks only): `backoffice.html` (Staff submenu + loader),
`staffportal.html` (My Shifts tab), `api/_auth.js` and
`api/_staff-accounts.js` (three new scopes, kept identical),
`api/_bo-db.js` (`boInsertIgnore`, `boErrorCode`), `vercel.json`
(noindex/no-store for `shift-print.html`), `tests/backoffice.test.js`
(kitchen role now includes `shifts_self`).

## 5b. Going live — steps for Bryan

1. Supabase → SQL editor → paste and run `supabase/migrations/0003_shift_maker.sql`.
   It only adds tables. It needs the `btree_gist` extension, which the script
   enables itself (Supabase ships it).
2. No new environment variables. It uses the existing `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SECRET` and `BACKOFFICE_PASSWORD`.
3. Deploy (only with Bryan's go-ahead), then in BackOffice → พนักงาน →
   Shift Maker → ⚙: add shift templates and staffing targets.
4. Staff appear automatically: Shift Maker uses the accounts from the staff
   portal's Staff Management. Each person needs their own login to see My Shifts.

## 5c. Known limitations

- The PDF is produced by the browser's own "Save as PDF" (print engine), not
  a server-side PDF file. That is what keeps Thai shaping correct with no new
  dependencies. One click on "Print / Save as PDF" in the preview.
- Notifications are in-app only (My Shifts → Updates). No LINE/email push.
- The week is fixed Monday–Sunday (setting it per shop is not built).
- Managers can manage every location; there is no per-location manager field.
- The BackOffice shared password has no person attached, so its edits are
  audited as `backoffice`.
- Approving a change request applies it to the draft first and marks the
  request approved second; if the second write fails the shift change stays
  (it is audited) and the request remains pending.

## 6. Risks

- `backoffice.html` has large uncommitted work from earlier sessions; Shift
  Maker touches it only in the staff nav and view dispatch.
- The BackOffice shared session has no person attached, so audit rows from it
  say `backoffice`, not a name. Personal manager tokens are attributed by name.
- There is no per-location manager assignment in the account model, so a
  manager can manage every store's rota. Location-scoped managers need a new
  account field.
- The migration must be run in Supabase by Bryan (SQL editor) before the
  feature works live; until then the endpoints answer `503`.

## 7. Attendance (Phase 5) — future architecture

Every assignment has a stable UUID and every publication a number. A future
`bo_attendance_punches(employee_id, assignment_id null, punched_at, kind)`
table links punches to a shift by id (or by nearest published shift for the
employee). `compareAttendance()` in `assets/shift-engine.js` already turns a
scheduled shift and its punches into late / early-leave / missing-punch
minutes (09:00–17:00 vs 09:12–17:05 → late 12 min). It never infers payable
overtime.
