# DANK BACKOFFICE — SHIFT MAKER & WORKFORCE SCHEDULING SYSTEM

## MASTER DEVELOPMENT PROMPT FOR CLAUDE CODE

You are a senior full-stack engineer, software architect, database engineer, UI/UX designer, and QA engineer. Implement a production-ready Shift Maker & Workforce Scheduling System inside the existing DANK Bangkok Backoffice, not as a separate application.

**Repository:** `https://github.com/bryank31172-web/Dank-Bangkok-Website`

**Users:** Owner, Manager, Professional Staff, and Part-time Staff.

**Objective:** Build a fast, accessible Google Calendar-like scheduling interface with drag-and-drop assignments, auto-filtered available staff, valid shared-coverage visualization, genuine scheduling-conflict prevention, staffing coverage, weekly-hour alerts, availability and leave, copied weeks, staff self-service, attendance compatibility, and attractive color-coded PDF exports.

**Critical distinction:** Two different employees working during the same hours is **shared coverage**, not a scheduling conflict. A single employee assigned to overlapping shifts is a scheduling conflict. Display both cases accurately in the app and PDF.

**Working approach:** Audit the repository first, explain its current architecture and constraints, plan implementation, then implement and test in phases. Use existing components, design conventions, auth, routes, database and deployment patterns. Never overwrite production data, create sample employees in production, reveal secrets, or deploy without explicit approval. If something can't safely be completed, say exactly what is missing rather than claiming completion.

---

## 1. REPOSITORY AUDIT AND INTEGRATION

1. Inspect the frontend framework, styling system, backend, database, API conventions, authentication, deployment, tests and migrations.
2. Find the existing Backoffice, navigation, staff directory and role-based permissions.
3. Inspect any existing Attendance, Leave, Staff Availability, PDF export and notification features.
4. Identify reusable UI components and any established staff identifiers. Do not create parallel authentication or duplicate staff tables.
5. Produce a concise repository-specific implementation plan, listing affected modules, database changes, risks and test strategy, then proceed.
6. Protect existing Orders, Products, Sales Reports, Promotion Codes, Announcements and staff workflows.

## 2. NAVIGATION AND PERMISSIONS

Add **Shift Maker** within Backoffice Staff Management; connect functional Staff List, Attendance, Leave & Availability and Shift Requests navigation where supported.

- **Owner:** full access to schedule creation, editing, publishing, reporting and settings.
- **Manager:** schedule management, copying, publishing, PDF exports and request approvals for authorized scope/locations.
- **Professional Staff / Part-time Staff:** read only their own **published** schedules and make permitted requests; cannot edit the live schedule directly.
- Enforce permissions in backend APIs, not only frontend. Authorize PDFs and prevent viewing other employees' private information.

## 3. VISUAL DESIGN

Use the Shift Maker mockup supplied by the user as the reference: modern white workspace, spacious Google Calendar-like grid, dark sidebar where consistent with existing Backoffice, soft employee colors, rounded cards, subtle borders, compact tooltips, clear typography and polished controls.

DANK primary brand green: **`#007A4D`**. Use green for appropriate brand actions, not every shift. Use accessible pastel colors to distinguish employees; red denotes genuine invalid scheduling states or urgent warnings. Provide consistent color allocation for each employee in the interface and PDF.

Desktop layout:
- Existing Backoffice sidebar.
- Top toolbar: Today; previous/next period; date range; Day/Week/Month/Staff views; Copy Previous Week; Save Draft; Publish; Export PDF.
- Calendar is primary focus; assignment side panel displays date, templates, available staff and actions.
- Responsive tablet and mobile interfaces. Essential actions must be possible without precision drag-and-drop.

## 4. CALENDAR SCHEDULING ENGINE

### Views
- **Day**: vertical timeline.
- **Week**: Monday–Sunday vertical hourly timeline, default on desktop.
- **Month**: traditional calendar with shift summaries.
- **Staff**: employee rows across dates/times.

Allow 15-, 30-, and 60-minute increments (default 30). Show times clearly; support overnight shifts. Use **Asia/Bangkok** for business-local scheduling logic, while storing unambiguous timestamp data. Correctly handle period and day boundaries.

### Assignment actions
- Drag a staff card to a date/time slot.
- Click a blank time to open a Create Shift panel.
- Select a shift template.
- Edit employee/date/start/end/role/breaks/notes.
- Drag/resize, duplicate or delete assignments.
- Trigger validation on every proposed mutation and rollback failed optimistic changes.
- Shift cards show employee name, hours, role and color, with conflict/availability status when needed.

### Shift templates
Allow managers to define reusable Morning, Afternoon, Evening, Closing or custom templates with start/end, role, optional unpaid breaks and location.

## 5. AUTO-HIDE ASSIGNED EMPLOYEES

This is a must-have workflow:

On selecting a date, the Available Staff list defaults to employees with **no scheduled assignment on that date** (and who are eligible under availability rules). Once the manager assigns Emma W. on Tuesday, Emma immediately disappears from Tuesday's default list. Removing the assignment restores her. Moving it updates both the origin and destination dates. A **Show Assigned Staff** toggle allows staff to remain inspectable.

If split shifts are enabled by an authorized manager, permit a second non-overlapping shift following rest and other configured rules. Treat auto-hiding as a UX convention, **not** security or authoritative conflict validation. Run server-side checks in every case.

## 6. OVERLAPS AND CONFLICT ENGINE

Use half-open intervals `[start, end)` and test overlap with:

`existing.start < proposed.end && proposed.start < existing.end`

For **one employee**, overlapping assignments are invalid: highlight the affected time red, explain employee/date/existing and proposed times, and block publishing until resolved.

For **different employees**, simultaneous work is valid unless a separately configured capacity policy is violated. Render simultaneous shifts side-by-side or in accessible parallel lanes; do not obscure shift cards.

**Exact example:**
- Emma W. 09:00–17:00.
- Noah T. 13:00–21:00.
- **Shared coverage:** 13:00–17:00 (4 hours), not an invalid double booking.

Show an optional subtle shared-coverage indicator and include the interval in PDF Remarks. **Do not show it as a red scheduling error.** Example of genuine invalidity: Emma 09:00–17:00 and Emma 13:00–21:00. Respect adjacent boundary: 09:00–17:00 then 17:00–21:00 is non-overlapping. Test overnight overlap and concurrent writes. Separate blocking errors from non-blocking warnings and explain each.

## 7. STAFF COVERAGE INDICATOR

Calculate staffing throughout each configurable interval, optionally filtered by role and location. Allow minimum staffing requirements by weekday, role, date and time window.

Example targets: 09:00–12:00 minimum 2, 12:00–18:00 minimum 3, 18:00–23:00 minimum 2.

Update immediately on create/edit/move/delete. Show actual/required counts, understaffed periods, role shortages and daily summaries. Green means target met, red means understaffed, neutral indicates above-target coverage. Coverage shortages may require acknowledgment on publication depending on policy; do not silently block draft saving. **Do not confuse daily unique staff totals with true hourly coverage.**

## 8. WEEKLY HOURS AND OVERTIME ALERTS

Automatically total each employee's scheduled hours, excluding unpaid breaks; handle overnight shifts and avoid double-counting. Default week is Monday–Sunday, configurable if business rules require. Offer a per-employee progress indicator and configurable warning threshold, potentially by staff category. The hours panel must support **at least 10 employees**, with scroll/pagination for larger teams.

Track scheduled hours, working days and amount above threshold. Do **not** hardcode 40 hours as a legal overtime rule. Distinguish planning alerts from statutory overtime/payroll eligibility. The employee portal displays only their personal hours.

## 9. AVAILABILITY AND LEAVE

Employees can submit availability, unavailable dates, preferred work times, and leave requests subject to approval. Managers can review them. Statuses:

- **Available:** assignment allowed.
- **Unavailable:** warning/restriction according to configured rules and reason.
- **Approved Leave:** hard block unless leave is formally modified or cancelled.

Approved leave takes precedence over informal availability. If later-approved leave overlaps a published shift, surface the issue for manager resolution; do not quietly rewrite schedules. Audit approvals, changes and cancellations.

## 10. COPY PREVIOUS WEEK / PERIOD

A Copy Previous Week action creates a **new draft** for the corresponding weekdays in the target period. Preserve appropriate employee, role, start/end times, unpaid breaks, template and notes; recompute all dates and validation. Flag employee leave, unavailability, duplicate shifts, overtime alerts and coverage shortages. Show a preview and corrections before saving/publishing. Do not automatically publish copied schedules. Make operations idempotent and avoid accidental duplicates.

## 11. DRAFTS, VALIDATION AND PUBLISHING

Implement `Draft → Validation → Published`. Staff see only published schedules. Managers can edit drafts; publish only after server-side validation. Genuine same-employee overlapping assignments, approved leave conflicts and other policy hard blocks must prevent publication. Non-blocking coverage/hour warnings should be displayed for review, with logged acknowledgment when allowed.

Preserve publication versions and audit changes after publication. Notify affected staff when a **published** assignment changes, not for ordinary draft edits. Handle concurrent managers with version checks/transactions and error messages.

## 12. STAFF SELF-SERVICE

Create a mobile-friendly **My Shifts** area in the existing staff portal with Today, Next Shift, Upcoming Week, Month, scheduled hours and relevant published status/location information. Allow employees to submit shift-change requests (alternative date/time, absence, optional swap) with reason and status: Pending, Approved, Rejected, Cancelled. Employees never directly modify published assignments. Managers approve/reject; approved changes go through the regular conflict/availability validation. Maintain request and decision audit trails and deduplicated internal notifications.

## 13. ATTENDANCE INTEGRATION — LATER PHASE

Prepare schedule identifiers/APIs to link existing or future attendance clock-in/out records. Future reports should compare scheduled vs actual times and show lateness, early departure, missing punches, approved adjustments and exceptions. Example: scheduled 09:00–17:00, actual 09:12–17:05 => late by 12 minutes. Do not infer payable overtime automatically. **Do not claim attendance integration is complete until real functional implementation and tests exist.**

---

## 14. COLORFUL PDF EXPORT — REQUIRED

Add **Export PDF** beside Publish, with PDF preview and downloadable output. Supported exports:
1. Weekly Schedule (primary)
2. Monthly Schedule
3. Individual Staff Schedule

Prefer a print-specific renderer rather than screenshotting the interactive calendar. Default **A3 landscape** and optionally A4 landscape if legible. Embed fonts with Thai and English support, keep print contrast, preserve colors, support multi-page output without clipping, and handle >10 employees and overnight shifts.

### Final PDF layout (must match user's latest design)

**Top:** DANK Backoffice logo/name, `Shift Maker — Weekly Schedule`, Period, Location, Status (Draft or Published).

**Do NOT display Timezone in PDF header.** Timezone still applies internally.

**Left main column:**
1. **Weekly Schedule** — large, vertically scaled, Monday–Sunday calendar. Hour rows typically 07:00–23:00, dynamically adapt to shift ranges. Pastel employee cards anchored precisely by start/end times. Show employee, start/end, role. Side-by-side arrangements for simultaneous staff; distinguish actual conflict from shared coverage.
2. **Staff Color Legend immediately BELOW calendar**, not in right sidebar. Two-column arrangement where practical, with employee swatch, name, role; show all employees, at least 10.

**Right column:**
1. **Weekly Hours** — increased height, display at least **10 staff** with full names, progress bars, numeric hours, overtime warnings when applicable. Avoid clipping.
2. **Coverage (by Day)** — seven day cards with a clearly labeled meaningful coverage metric, and understaffing indicators; do not imply a unique headcount measures hourly adequacy.
3. **\*Remarks** — compact explanation of genuine conflicts, shared-coverage intervals, shortages, exceeded thresholds and acknowledged exceptions **when actually present**. Example: `Emma W. and Noah T. both scheduled Tue 13:00–17:00 (shared coverage)`. Red only for genuine invalid conflicts.

**Remove/omit entirely:**
- Timezone row in header.
- Detailed Time Table.
- Separate Conflict Summary panel.
- Staff Color Legend at top or in sidebar.

For an illustrative PDF, show:
- Emma W. Tuesday 09:00–17:00.
- Noah T. Tuesday 13:00–21:00.
- Shared period Tuesday 13:00–17:00 readable on the hour scale and mentioned in Remarks, **not** mislabeled as invalid conflict.
- At least 10 sample employee entries in Weekly Hours and Legend; sample-only staff names may include Ava R., Emma W., Noah T., Olivia K., Liam P., Mason D., Sophia L., Ethan C., Grace H. and Lucas M.
- Make sample totals mathematically consistent with sample shifts. Do not put any fictitious employees in the production DB.

**PDF correctness tests:** time alignment; shift durations; adjacent vs overlapping boundaries; long names; Thai text; proper count and legend color mapping; A3 landscape; readable A4 fallback; accurate real-time totals; multi-page overflow; no missing blocks; correct paper printing; no unauthorized data in staff exports.

---

## 15. DATABASE & API DESIGN

Adapt to the repository's actual database and migration conventions. Suggested logical entities (reuse existing tables when possible):

- `shift_templates`: template name, role, start/end, break, optional location.
- `schedule_periods`: start/end, location, draft/published status, version, published metadata.
- `shift_assignments`: employee reference, period, starts_at/ends_at, role, template, break, notes, created/updated metadata.
- `staff_availability`: employee and time windows/status.
- `leave_requests`: reuse existing if available.
- `shift_change_requests`: requester, original assignment, proposed change, reason, decision, timestamps.
- `staffing_requirements`: coverage targets per role/date/time/location.
- `shift_audit_logs`: immutable shift and approval history.
- `schedule_publications`: publication versions/events if needed.

Use foreign keys, appropriate indexes on employee/time/period, robust input validation and consistent timestamp representation. All write APIs must independently validate and authorize actions; use transactions or equivalent concurrency protections to prevent duplicate, overlapping or stale writes. PDFs must be generated from authorized validated data.

## 16. RELIABILITY, PERFORMANCE AND ACCESSIBILITY

- Query assignments by visible date range and avoid unnecessary full-calendar re-renders.
- Support realistic rosters without severe lag.
- Show loading/empty/error states; allow safe retry without duplicate writes.
- Preserve unsaved-change warnings and version conflicts.
- Keyboard and touch accessible controls; sufficient color contrast; status must not be communicated with color alone.
- Screen-reader-friendly labels for shift cards and warnings.
- No new complex microservices unless clearly justified by existing architecture.
- Keep audit records for all sensitive management operations.

## 17. IMPLEMENTATION PHASES

**Phase 1 — Foundation:** repository audit, RBAC, data model/migrations, shift CRUD, week/day/month/staff calendar, templates, auto-hide, shared coverage and genuine conflict engine.

**Phase 2 — Workforce management:** hourly coverage, weekly hours, availability/leave, Copy Previous Week, draft/publish and history.

**Phase 3 — PDF:** final colorful layout, schedule grid, legend below calendar, 10-person Weekly Hours, Coverage by Day, Remarks, weekly/monthly/individual exports, preview/print.

**Phase 4 — Staff self-service:** My Shifts, change requests and approval notifications.

**Phase 5 — Attendance compatibility:** integrate verified attendance records where possible and add comparisons, without disrupting an existing attendance system.

## 18. TESTING MATRIX

Write automated unit, integration and, where the project supports it, end-to-end tests for:

- Creation, editing, deletion, drag, resize, month/week navigation, overnight shifts.
- Auto-hide on selected date, restoration on deletion, updates when moved, optional split-shift override.
- Same-employee overlap blocked, different-employee shared hours allowed, equal endpoint is not overlap, overnight checks.
- Concurrent managers trying conflicting or duplicate assignments.
- Coverage by hourly/role requirements and actual/required counts.
- Accurate weekly hours and break subtraction, threshold alerts.
- Approved leave hard block, unavailable staff restrictions.
- Copy previous week creates draft, flags leave/availability and is idempotent.
- Draft schedules not visible to staff; invalid draft cannot publish; valid publication/versioning.
- Permissions for Owner, Manager, Professional Staff, Part-time Staff.
- Staff request approval workflow and affected-employee notifications.
- PDF A3 export, no Timezone, no Detailed Time Table, no Conflict Summary panel, legend immediately below calendar, 10 Weekly Hours rows, coverage/Remarks, correct color and duration, Thai fonts and pagination.
- Existing Backoffice regression tests and production data preservation.

## 19. DEFINITION OF DONE

A feature is complete only when implemented, authorized server-side, visually verified and tested. Minimum final product:

- Fully functional calendar-based Shift Maker in DANK Backoffice.
- Accurate employee auto-hiding and restoration.
- True conflicts blocked and simultaneous different-employee coverage represented correctly.
- Hourly coverage, weekly hours, leave/availability and copy-week work.
- Draft/publish and staff-only published views work.
- Staff change requests function with approval authority.
- Accurate colorful PDF export matching the exact revised layout and supporting 10+ staff.
- Mobile and desktop usable; secure migrations; existing Backoffice functions still working.
- Attendance future architecture documented; only claim attendance implemented if actually done.

## 20. REQUIRED DELIVERY

At completion return:
1. Repository architecture findings and decisions.
2. Summary of changes and implemented features.
3. Modified/new file paths and migration details.
4. Screenshots of desktop/mobile calendar.
5. Sample **real generated** colorful weekly PDF matching the final layout.
6. Test commands/results, failures and unresolved issues.
7. API routes and permission details.
8. Deployment/configuration steps and any manual actions required.
9. Limitations and remaining phases.

**Start now:** Inspect the repository and existing code, then plan and implement iteratively. Do not ask unnecessary questions that can be resolved from the repository. Do not deploy production changes without explicit approval.
