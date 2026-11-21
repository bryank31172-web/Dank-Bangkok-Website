/* DANK Shift Maker — server-side data layer and authoritative validation.

   Every write goes through here, so every write is validated here, whatever
   the browser already checked. Three layers stop a double booking:
     1. the browser's preview (assets/shift-engine.js) — convenience only;
     2. validateAssignment() below, against fresh rows from the database;
     3. the bo_shift_no_self_overlap exclusion constraint in Postgres, which
        settles the race when two managers save at the same instant.
   Layer 3 surfaces as Postgres 23P01; we turn it into a plain 409.

   Draft vs published: managers edit bo_shift_assignments (the draft).
   Publishing writes an immutable snapshot (bo_schedule_publications) and
   staff only ever read snapshots. See docs/dank-backoffice/SHIFT_MAKER.md. */
import crypto from "node:crypto";
import { boSelect, boInsert, boUpdate, boUpsert, boRpc, boInsertIgnore, boErrorCode, boAudit, enc } from "./_bo-db.js";
import { listAccounts } from "./_staff-accounts.js";
import * as E from "../assets/shift-engine.js";

export class ShiftError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID.test(v);
const isoOf = (v) => (v == null ? null : new Date(v).toISOString());
const str = (v, max) => { const s = String(v ?? "").trim(); return s ? s.slice(0, max) : null; };

/* ---------- row mapping (snake_case in Postgres, camelCase everywhere else) ---------- */

export const fromAssignment = (r) => r && ({
  id: r.id, periodId: r.period_id, storeId: r.store_id, employeeId: r.employee_id,
  startsAt: isoOf(r.starts_at), endsAt: isoOf(r.ends_at), role: r.role || null, templateId: r.template_id || null,
  breakMinutes: Number(r.break_minutes) || 0, notes: r.notes || null, splitOverride: Boolean(r.split_override),
  copySourceId: r.copy_source_id || null, version: Number(r.version) || 1, deletedAt: r.deleted_at || null,
  createdBy: r.created_by, updatedBy: r.updated_by || null, updatedAt: r.updated_at || null,
});
const fromPeriod = (r) => r && ({
  id: r.id, storeId: r.store_id, weekStart: String(r.week_start).slice(0, 10), status: r.status, version: Number(r.version),
  publishedNo: Number(r.published_no) || 0, publishedVersion: r.published_version ?? null,
  publishedAt: r.published_at || null, publishedBy: r.published_by || null,
});
const fromLeave = (r) => ({
  id: r.id, employeeId: r.employee_id, startsAt: isoOf(r.starts_at), endsAt: isoOf(r.ends_at), leaveType: r.leave_type,
  reason: r.reason || null, status: r.status, requestedBy: r.requested_by, decidedBy: r.decided_by || null,
  decidedAt: r.decided_at || null, decisionNote: r.decision_note || null, createdAt: r.created_at,
});
const fromAvail = (r) => ({
  id: r.id, employeeId: r.employee_id, kind: r.kind, weekday: r.weekday ?? null, onDate: r.on_date ? String(r.on_date).slice(0, 10) : null,
  startTime: r.start_time ? String(r.start_time).slice(0, 5) : null, endTime: r.end_time ? String(r.end_time).slice(0, 5) : null,
  reason: r.reason || null, status: r.status, reviewedBy: r.reviewed_by || null, reviewedAt: r.reviewed_at || null, createdAt: r.created_at,
});
const fromTemplate = (r) => ({
  id: r.id, name: r.name, role: r.role || null, startTime: String(r.start_time).slice(0, 5), endTime: String(r.end_time).slice(0, 5),
  breakMinutes: Number(r.break_minutes) || 0, storeId: r.store_id || null, sortOrder: Number(r.sort_order) || 0, active: r.active !== false,
});
const fromRequirement = (r) => ({
  id: r.id, storeId: r.store_id || null, weekday: r.weekday ?? null, onDate: r.on_date ? String(r.on_date).slice(0, 10) : null,
  startTime: String(r.start_time).slice(0, 5), endTime: String(r.end_time).slice(0, 5), role: r.role || null,
  minStaff: Number(r.min_staff), active: r.active !== false,
});
const fromRequest = (r) => ({
  id: r.id, requesterId: r.requester_id, assignmentId: r.assignment_id, kind: r.kind,
  proposedStartsAt: isoOf(r.proposed_starts_at), proposedEndsAt: isoOf(r.proposed_ends_at), swapEmployeeId: r.swap_employee_id || null,
  reason: r.reason, status: r.status, decidedBy: r.decided_by || null, decidedAt: r.decided_at || null, decisionNote: r.decision_note || null,
  createdAt: r.created_at,
});

/* ---------- reference data ---------- */

/** Staff accounts are the employee directory. No second staff table. */
export async function loadEmployees() {
  const rows = await listAccounts();
  return rows.map((a) => ({ id: a.id, name: a.name, role: a.role, active: a.active !== false }));
}
export async function loadStores() {
  return (await boSelect("bo_stores", "select=id,name,active&order=name.asc")) || [];
}
export async function loadSettings(storeId) {
  const rows = (await boSelect("bo_shift_settings", `store_id=in.(${enc("*")}${storeId ? "," + enc(storeId) : ""})&select=*`)) || [];
  const global = rows.find((r) => r.store_id === "*")?.settings;
  const local = storeId ? rows.find((r) => r.store_id === storeId)?.settings : null;
  return E.mergeSettings(global, local);
}
export async function loadTemplates() {
  return ((await boSelect("bo_shift_templates", "active=eq.true&select=*&order=sort_order.asc,start_time.asc")) || []).map(fromTemplate);
}
export async function loadRequirements(storeId) {
  const rows = (await boSelect("bo_staffing_requirements", "active=eq.true&select=*")) || [];
  return rows.map(fromRequirement).filter((r) => !storeId || !r.storeId || r.storeId === storeId);
}

/* ---------- range reads ---------- */

/** Live assignments that touch [fromMs, toMs), every store (overlap is global per person). */
export async function assignmentsInRange(fromMs, toMs, { employeeIds = null } = {}) {
  let q = `deleted_at=is.null&starts_at=lt.${enc(E.iso(toMs))}&ends_at=gt.${enc(E.iso(fromMs))}&select=*&order=starts_at.asc`;
  if (employeeIds) q += `&employee_id=in.(${employeeIds.map(enc).join(",")})`;
  return ((await boSelect("bo_shift_assignments", q)) || []).map(fromAssignment);
}
export async function leaveInRange(fromMs, toMs, { employeeIds = null, statuses = ["approved", "pending"] } = {}) {
  let q = `status=in.(${statuses.join(",")})&starts_at=lt.${enc(E.iso(toMs))}&ends_at=gt.${enc(E.iso(fromMs))}&select=*&order=starts_at.asc`;
  if (employeeIds) q += `&employee_id=in.(${employeeIds.map(enc).join(",")})`;
  return ((await boSelect("bo_staff_leave", q)) || []).map(fromLeave);
}
export async function availabilityFor(employeeIds = null) {
  let q = "status=eq.active&select=*&order=created_at.desc";
  if (employeeIds) q += `&employee_id=in.(${employeeIds.map(enc).join(",")})`;
  return ((await boSelect("bo_staff_availability", q)) || []).map(fromAvail);
}

/* ---------- periods ---------- */

export async function getPeriod(storeId, weekStart) {
  const [row] = (await boSelect("bo_schedule_periods", `store_id=eq.${enc(storeId)}&week_start=eq.${enc(weekStart)}&select=*`)) || [];
  return fromPeriod(row) || null;
}
export async function ensurePeriod(storeId, weekStart) {
  const existing = await getPeriod(storeId, weekStart);
  if (existing) return existing;
  try { await boInsert("bo_schedule_periods", { store_id: storeId, week_start: weekStart }); }
  catch (e) { if (boErrorCode(e) !== "23505") throw e; } // another manager created it first — fine
  return getPeriod(storeId, weekStart);
}
async function bumpPeriod(periodId) {
  const r = await boRpc("bo_shift_bump_period", { p_period_id: periodId });
  return Array.isArray(r) ? r[0] : r;
}
export async function periodsInRange(fromDate, toDate, storeId = null) {
  let q = `week_start=gte.${enc(E.weekStartOf(fromDate))}&week_start=lte.${enc(toDate)}&select=*&order=week_start.asc`;
  if (storeId) q += `&store_id=eq.${enc(storeId)}`;
  return ((await boSelect("bo_schedule_periods", q)) || []).map(fromPeriod);
}

/* ---------- validation against fresh data ---------- */

async function contextFor(p, employees) {
  const s = E.toMs(p.startsAt), e = E.toMs(p.endsAt);
  const ws = E.bkkMs(E.weekStartOf(E.bkkDate(s)));
  const from = Math.min(s, ws) - E.DAY_MS, to = Math.max(e, ws + 7 * E.DAY_MS) + E.DAY_MS;
  const [assignments, leave, availability, settings] = await Promise.all([
    assignmentsInRange(from, to, { employeeIds: [p.employeeId] }),
    leaveInRange(from, to, { employeeIds: [p.employeeId] }),
    availabilityFor([p.employeeId]),
    loadSettings(p.storeId),
  ]);
  return { assignments, leave, availability, settings, employees };
}

/** Normalise and sanity-check client input before it gets anywhere near the database. */
export function cleanAssignmentInput(b, base = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries({ employeeId: b.employeeId, storeId: b.storeId, role: b.role, templateId: b.templateId, notes: b.notes }))
    if (v !== undefined) out[k] = v;
  if (b.date !== undefined || b.start !== undefined || b.end !== undefined) {
    if (!E.isDateStr(b.date) || !E.isTimeStr(b.start) || !E.isTimeStr(b.end)) throw new ShiftError(400, "date must be YYYY-MM-DD and start/end HH:MM");
    Object.assign(out, E.localToRange(b.date, b.start, b.end));
  } else {
    if (b.startsAt !== undefined) out.startsAt = b.startsAt;
    if (b.endsAt !== undefined) out.endsAt = b.endsAt;
  }
  if (!Number.isFinite(Date.parse(out.startsAt)) || !Number.isFinite(Date.parse(out.endsAt))) throw new ShiftError(400, "startsAt/endsAt must be timestamps");
  out.startsAt = E.iso(Date.parse(out.startsAt)); out.endsAt = E.iso(Date.parse(out.endsAt));
  if (b.breakMinutes !== undefined) out.breakMinutes = Math.round(Number(b.breakMinutes) || 0);
  if (!(out.breakMinutes >= 0 && out.breakMinutes <= 600)) throw new ShiftError(400, "breakMinutes must be 0-600");
  if (b.splitOverride !== undefined) out.splitOverride = Boolean(b.splitOverride);
  out.role = str(out.role, 40); out.notes = str(out.notes, 500);
  if (out.templateId && !isUuid(out.templateId)) throw new ShiftError(400, "bad templateId");
  if (!out.templateId) out.templateId = null;
  if (typeof out.employeeId !== "string" || !out.employeeId) throw new ShiftError(400, "employeeId required");
  if (typeof out.storeId !== "string" || !out.storeId) throw new ShiftError(400, "storeId required");
  return out;
}

export async function validateProposal(p) {
  const employees = await loadEmployees();
  const ctx = await contextFor(p, employees);
  return E.validateAssignment(p, ctx);
}

const toRow = (p, actorId) => ({
  store_id: p.storeId, employee_id: p.employeeId, starts_at: p.startsAt, ends_at: p.endsAt, role: p.role,
  template_id: p.templateId, break_minutes: p.breakMinutes || 0, notes: p.notes, split_override: Boolean(p.splitOverride),
  updated_by: actorId, updated_at: new Date().toISOString(),
});
function translateDbError(e) {
  const code = boErrorCode(e);
  if (code === "23P01") return new ShiftError(409, "Someone else just scheduled this person at an overlapping time. Refresh to see their shift — one person cannot work two shifts at once.", { code: "overlap_race" });
  if (code === "23503") return new ShiftError(400, "Unknown store or template.");
  if (code === "23514") return new ShiftError(400, "That shift breaks a basic rule (end after start, at most 24 hours, break 0-600 minutes).");
  return e;
}
async function storeExists(storeId) {
  const rows = await boSelect("bo_stores", `id=eq.${enc(storeId)}&select=id`);
  return Boolean(rows?.length);
}

/* ---------- assignment writes ---------- */

export async function createAssignment(actor, body) {
  const id = body.id;
  if (!isUuid(id)) throw new ShiftError(400, "id must be a UUID generated by the client");
  const [existing] = (await boSelect("bo_shift_assignments", `id=eq.${enc(id)}&select=*`)) || [];
  if (existing) return { assignment: fromAssignment(existing), replayed: true }; // safe retry, no duplicate
  const p = cleanAssignmentInput(body, { breakMinutes: 0 });
  p.id = id;
  if (!(await storeExists(p.storeId))) throw new ShiftError(400, "Unknown store.");
  const v = await validateProposal(p);
  if (v.errors.length) throw new ShiftError(422, v.errors[0].message, { errors: v.errors, warnings: v.warnings });
  const period = await ensurePeriod(p.storeId, E.weekStartOf(E.bkkDate(p.startsAt)));
  let row;
  try {
    [row] = await boInsert("bo_shift_assignments", { id, period_id: period.id, ...toRow(p, actor.id), created_by: actor.id, copy_source_id: isUuid(body.copySourceId) ? body.copySourceId : null });
  } catch (e) {
    if (boErrorCode(e) === "23505") { // PK race with our own retry, or the copy-once index
      const [again] = (await boSelect("bo_shift_assignments", `id=eq.${enc(id)}&select=*`)) || [];
      if (again) return { assignment: fromAssignment(again), replayed: true };
      throw new ShiftError(409, "This shift was already copied into that week.", { code: "duplicate_copy" });
    }
    throw translateDbError(e);
  }
  await bumpPeriod(period.id);
  const assignment = fromAssignment(row);
  await boAudit({ actorId: actor.id, action: "create", entityType: "shift_assignment", entityId: id, after: assignment });
  return { assignment, warnings: v.warnings };
}

async function liveAssignment(id) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  const [row] = (await boSelect("bo_shift_assignments", `id=eq.${enc(id)}&select=*`)) || [];
  if (!row || row.deleted_at) throw new ShiftError(404, "That shift no longer exists. Refresh the calendar.");
  return fromAssignment(row);
}

export async function updateAssignment(actor, body, { skipVersion = false } = {}) {
  const before = await liveAssignment(body.id);
  if (!skipVersion && Number(body.version) !== before.version)
    throw new ShiftError(409, "Another manager changed this shift since you opened it. Refresh and try again.", { code: "stale", current: before });
  const p = cleanAssignmentInput(body, before);
  p.id = before.id;
  if (p.storeId !== before.storeId && !(await storeExists(p.storeId))) throw new ShiftError(400, "Unknown store.");
  const v = await validateProposal(p);
  if (v.errors.length) throw new ShiftError(422, v.errors[0].message, { errors: v.errors, warnings: v.warnings });
  const period = await ensurePeriod(p.storeId, E.weekStartOf(E.bkkDate(p.startsAt)));
  let rows;
  try {
    rows = await boUpdate("bo_shift_assignments", `id=eq.${enc(before.id)}&version=eq.${before.version}&deleted_at=is.null`,
      { ...toRow(p, actor.id), period_id: period.id, version: before.version + 1 });
  } catch (e) { throw translateDbError(e); }
  if (!rows?.length) throw new ShiftError(409, "Another manager changed this shift a moment ago. Refresh and try again.", { code: "stale" });
  await bumpPeriod(period.id);
  if (period.id !== before.periodId) await bumpPeriod(before.periodId);
  const assignment = fromAssignment(rows[0]);
  await boAudit({ actorId: actor.id, action: "update", entityType: "shift_assignment", entityId: before.id, before, after: assignment });
  return { assignment, warnings: v.warnings };
}

export async function deleteAssignment(actor, body, { skipVersion = false } = {}) {
  const before = await liveAssignment(body.id);
  if (!skipVersion && Number(body.version) !== before.version)
    throw new ShiftError(409, "Another manager changed this shift since you opened it. Refresh and try again.", { code: "stale", current: before });
  const rows = await boUpdate("bo_shift_assignments", `id=eq.${enc(before.id)}&version=eq.${before.version}&deleted_at=is.null`,
    { deleted_at: new Date().toISOString(), updated_by: actor.id, version: before.version + 1 });
  if (!rows?.length) throw new ShiftError(409, "Another manager changed this shift a moment ago. Refresh and try again.", { code: "stale" });
  await bumpPeriod(before.periodId);
  await boAudit({ actorId: actor.id, action: "delete", entityType: "shift_assignment", entityId: before.id, before });
  return { ok: true, id: before.id };
}

/* ---------- period validation, publishing, history ---------- */

export async function periodReport(storeId, weekStart) {
  if (!E.isDateStr(weekStart) || E.weekStartOf(weekStart) !== weekStart) throw new ShiftError(400, "week must be a Monday (YYYY-MM-DD)");
  const ws = E.bkkMs(weekStart), we = ws + 7 * E.DAY_MS;
  const [period, employees, all, settings, requirements] = await Promise.all([
    getPeriod(storeId, weekStart), loadEmployees(), assignmentsInRange(ws - E.DAY_MS, we + E.DAY_MS), loadSettings(storeId), loadRequirements(storeId),
  ]);
  const ids = [...new Set(all.map((a) => a.employeeId))];
  const [leave, availability] = await Promise.all([
    ids.length ? leaveInRange(ws - E.DAY_MS, we + E.DAY_MS, { employeeIds: ids }) : [],
    ids.length ? availabilityFor(ids) : [],
  ]);
  const mine = all.filter((a) => a.storeId === storeId && E.toMs(a.startsAt) >= ws && E.toMs(a.startsAt) < we);
  // Conflicts are per person across every store, so validate with all of a person's shifts…
  const v = E.validatePeriod({ assignments: all.filter((a) => ids.includes(a.employeeId)), leave, availability, employees, requirements: [], settings, weekStart, storeId });
  // …but only report the ones that involve this store's week, and judge coverage on this store alone.
  const mineIds = new Set(mine.map((a) => a.id));
  const touches = (x) => !x.assignmentIds || x.assignmentIds.some((id) => mineIds.has(id));
  const cov = E.validatePeriod({ assignments: mine, leave: [], availability: [], employees, requirements, settings, weekStart, storeId });
  const errors = v.errors.filter(touches);
  const warnings = [...v.warnings.filter((w) => w.code !== "hours" && touches(w)), ...cov.warnings.filter((w) => w.code === "coverage")];
  // Weekly hours count every store the person works in.
  for (const r of E.weeklyHours(all, employees.filter((e) => mine.some((a) => a.employeeId === e.id)), weekStart, settings))
    if (r.over > 0) warnings.push({ severity: "warning", code: "hours", key: `hours:${r.employeeId}:${weekStart}`, employeeId: r.employeeId,
      message: `${r.name} is scheduled ${E.fmtHours(r.minutes)}, ${E.fmtHours(r.over)} above the ${r.threshold}h planning threshold.` });
  return {
    period, assignments: mine, employees, settings, requirements, leave, availability,
    validation: { errors, warnings, shared: cov.shared, coverage: cov.coverage, needsAck: E.warningsNeedingAck(warnings, settings).map((w) => w.key) },
    dirty: period ? period.publishedNo === 0 || period.version !== period.publishedVersion : mine.length > 0,
  };
}

export async function publications(periodId) {
  const rows = (await boSelect("bo_schedule_publications", `period_id=eq.${enc(periodId)}&select=id,publication_no,period_version,warnings,acknowledged,published_by,published_at&order=publication_no.desc`)) || [];
  return rows.map((r) => ({ no: r.publication_no, periodVersion: r.period_version, warnings: r.warnings, acknowledged: r.acknowledged, publishedBy: r.published_by, publishedAt: r.published_at }));
}
async function latestSnapshot(periodId) {
  const [row] = (await boSelect("bo_schedule_publications", `period_id=eq.${enc(periodId)}&select=*&order=publication_no.desc&limit=1`)) || [];
  return row ? { no: row.publication_no, assignments: row.assignments || [], publishedAt: row.published_at, acknowledged: row.acknowledged || [] } : null;
}

export async function publishedForPeriod(periodId) {
  return (await latestSnapshot(periodId))?.assignments || [];
}

const snapshotRow = (a) => ({ id: a.id, employeeId: a.employeeId, storeId: a.storeId, startsAt: a.startsAt, endsAt: a.endsAt, role: a.role, breakMinutes: a.breakMinutes, notes: a.notes, templateId: a.templateId });

export async function publishPeriod(actor, { storeId, weekStart, version, acknowledge = [] }) {
  const report = await periodReport(storeId, weekStart);
  if (!report.period) throw new ShiftError(400, "There is nothing to publish for that week yet.");
  if (Number(version) !== report.period.version)
    throw new ShiftError(409, "The schedule changed since you reviewed it. Review the latest version, then publish.", { code: "stale", period: report.period });
  if (report.validation.errors.length)
    throw new ShiftError(422, `Fix ${report.validation.errors.length} blocking problem(s) before publishing.`, { errors: report.validation.errors, warnings: report.validation.warnings });
  const ack = Array.isArray(acknowledge) ? acknowledge.map(String) : [];
  const missing = report.validation.needsAck.filter((k) => !ack.includes(k));
  if (missing.length) throw new ShiftError(409, "Some warnings need to be acknowledged before publishing.", { code: "needs_ack", needsAck: missing, warnings: report.validation.warnings });
  const previous = await latestSnapshot(report.period.id);
  const snapshot = report.assignments.map(snapshotRow);
  const res = await boRpc("bo_shift_publish", {
    p_period_id: report.period.id, p_expected_version: report.period.version, p_assignments: snapshot,
    p_warnings: report.validation.warnings, p_acknowledged: ack.filter((k) => report.validation.needsAck.includes(k)), p_actor: actor.id,
  });
  const pub = Array.isArray(res) ? res[0] : res;
  if (!pub || pub.id == null) throw new ShiftError(409, "Another manager changed the schedule while you were publishing. Review and publish again.", { code: "stale" });
  await boAudit({ actorId: actor.id, action: "status_change", entityType: "schedule_period", entityId: report.period.id,
    after: { publicationNo: pub.publication_no, storeId, weekStart, shifts: snapshot.length }, note: ack.length ? `acknowledged: ${ack.join(", ")}` : null });
  const notified = await notifyPublicationDiff(previous?.assignments || [], snapshot, { storeId, weekStart, no: pub.publication_no, periodId: report.period.id, first: !previous });
  return { ok: true, publicationNo: pub.publication_no, notified, period: await getPeriod(storeId, weekStart) };
}

/** Notify only the people whose published shifts actually changed. */
async function notifyPublicationDiff(before, after, { storeId, weekStart, no, periodId, first }) {
  const key = (a) => `${a.startsAt}|${a.endsAt}|${a.role || ""}|${a.storeId}|${a.breakMinutes || 0}`;
  const byEmp = (list) => { const m = new Map(); for (const a of list) { if (!m.has(a.employeeId)) m.set(a.employeeId, []); m.get(a.employeeId).push(key(a)); } for (const v of m.values()) v.sort(); return m; };
  const b = byEmp(before), a = byEmp(after);
  const affected = [...new Set([...b.keys(), ...a.keys()])].filter((id) => JSON.stringify(b.get(id) || []) !== JSON.stringify(a.get(id) || []));
  if (!affected.length) return 0;
  await notify(affected.map((id) => ({
    employee_id: id, kind: first ? "schedule_published" : "schedule_changed",
    title: first ? `Your shifts for the week of ${E.fmtDateShort(weekStart)} are published` : `Your shifts for the week of ${E.fmtDateShort(weekStart)} changed`,
    body: `${(a.get(id) || []).length} shift(s) this week. Open My Shifts for details.`,
    ref_type: "schedule_period", ref_id: periodId, dedupe_key: `pub:${periodId}:${no}:${id}`,
  })));
  return affected.length;
}
export async function notify(rows) {
  if (!rows.length) return;
  try { await boInsertIgnore("bo_staff_notifications", rows, "dedupe_key"); }
  catch (e) { console.error("shift notification failed:", e.message); } // a missed notification must not undo the action
}

/** What staff may see: their own rows from the latest PUBLISHED snapshots. Never a draft. */
export async function publishedShiftsFor(employeeId, fromDate, toDate) {
  const periods = (await periodsInRange(fromDate, toDate)).filter((p) => p.publishedNo > 0);
  const from = E.bkkMs(fromDate), to = E.bkkMs(toDate) + E.DAY_MS;
  const out = [];
  for (const p of periods) {
    const snap = await latestSnapshot(p.id);
    for (const a of snap?.assignments || [])
      if (a.employeeId === employeeId && E.toMs(a.startsAt) < to && E.toMs(a.endsAt) > from)
        out.push({ ...a, publicationNo: snap.no, publishedAt: snap.publishedAt, weekStart: p.weekStart });
  }
  return out.sort((x, y) => E.toMs(x.startsAt) - E.toMs(y.startsAt));
}

/* ---------- copy previous week ---------- */

export async function copyWeek(actor, { storeId, fromWeek, toWeek, apply = false, selected = null }) {
  for (const w of [fromWeek, toWeek]) if (!E.isDateStr(w) || E.weekStartOf(w) !== w) throw new ShiftError(400, "weeks must be Mondays (YYYY-MM-DD)");
  if (fromWeek === toWeek) throw new ShiftError(400, "Pick a different target week.");
  const fs = E.bkkMs(fromWeek);
  const source = (await assignmentsInRange(fs, fs + 7 * E.DAY_MS)).filter((a) => a.storeId === storeId && E.toMs(a.startsAt) >= fs);
  const target = await getPeriod(storeId, toWeek);
  const already = target ? new Set(((await boSelect("bo_shift_assignments", `period_id=eq.${enc(target.id)}&deleted_at=is.null&copy_source_id=not.is.null&select=copy_source_id`)) || []).map((r) => r.copy_source_id)) : new Set();
  const plan = E.planCopyWeek(source, fromWeek, toWeek, () => crypto.randomUUID());
  const employees = await loadEmployees();
  const ts = E.bkkMs(toWeek);
  const ids = [...new Set(plan.map((p) => p.employeeId))];
  const [existing, leave, availability, settings, requirements] = await Promise.all([
    assignmentsInRange(ts - E.DAY_MS, ts + 8 * E.DAY_MS), ids.length ? leaveInRange(ts - E.DAY_MS, ts + 8 * E.DAY_MS, { employeeIds: ids }) : [],
    ids.length ? availabilityFor(ids) : [], loadSettings(storeId), loadRequirements(storeId),
  ]);
  const proposals = plan.map((p) => {
    if (already.has(p.copySourceId)) return { ...p, skip: "already_copied", errors: [], warnings: [] };
    const v = E.validateAssignment(p, { assignments: existing, leave, availability, employees, settings });
    return { ...p, ...v };
  });
  if (!apply) {
    const keep = proposals.filter((p) => !p.skip && !p.errors.length);
    const preview = E.validatePeriod({ assignments: [...existing.filter((a) => a.storeId === storeId), ...keep], leave, availability, employees, requirements, settings, weekStart: toWeek, storeId });
    return { proposals, coverage: preview.warnings.filter((w) => w.code === "coverage"), hours: preview.warnings.filter((w) => w.code === "hours") };
  }
  const want = Array.isArray(selected) ? new Set(selected) : null;
  const created = [], failed = [], skipped = [];
  for (const p of proposals) {
    if (want && !want.has(p.copySourceId)) continue;
    if (p.skip) { skipped.push({ copySourceId: p.copySourceId, reason: p.skip }); continue; }
    try { created.push((await createAssignment(actor, p)).assignment); }
    catch (e) { if (e instanceof ShiftError) failed.push({ copySourceId: p.copySourceId, error: e.message }); else throw e; }
  }
  return { created, failed, skipped };
}

/* ---------- templates, requirements, settings ---------- */

export async function saveTemplate(actor, b) {
  if (!str(b.name, 60) || !E.isTimeStr(b.startTime) || !E.isTimeStr(b.endTime)) throw new ShiftError(400, "name, startTime and endTime (HH:MM) required");
  const row = { name: str(b.name, 60), role: str(b.role, 40), start_time: b.startTime, end_time: b.endTime,
    break_minutes: Math.max(0, Math.min(600, Math.round(Number(b.breakMinutes) || 0))), store_id: b.storeId || null,
    sort_order: Math.round(Number(b.sortOrder) || 0), updated_at: new Date().toISOString() };
  if (b.id) {
    if (!isUuid(b.id)) throw new ShiftError(400, "bad id");
    const rows = await boUpdate("bo_shift_templates", `id=eq.${enc(b.id)}`, row);
    if (!rows?.length) throw new ShiftError(404, "template not found");
    await boAudit({ actorId: actor.id, action: "update", entityType: "shift_template", entityId: b.id, after: rows[0] });
    return fromTemplate(rows[0]);
  }
  const [created] = await boInsert("bo_shift_templates", { ...row, created_by: actor.id });
  await boAudit({ actorId: actor.id, action: "create", entityType: "shift_template", entityId: created.id, after: created });
  return fromTemplate(created);
}
export async function retireTemplate(actor, id) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  const rows = await boUpdate("bo_shift_templates", `id=eq.${enc(id)}`, { active: false, updated_at: new Date().toISOString() });
  await boAudit({ actorId: actor.id, action: "delete", entityType: "shift_template", entityId: id });
  return { ok: Boolean(rows?.length) };
}
export async function saveRequirement(actor, b) {
  if (!E.isTimeStr(b.startTime) || !E.isTimeStr(b.endTime)) throw new ShiftError(400, "startTime and endTime (HH:MM) required");
  const min = Math.round(Number(b.minStaff));
  if (!(min >= 0 && min <= 100)) throw new ShiftError(400, "minStaff must be 0-100");
  if (b.weekday != null && b.onDate) throw new ShiftError(400, "use a weekday or a date, not both");
  if (b.onDate && !E.isDateStr(b.onDate)) throw new ShiftError(400, "onDate must be YYYY-MM-DD");
  const wd = b.weekday == null || b.weekday === "" ? null : Math.round(Number(b.weekday));
  if (wd != null && !(wd >= 0 && wd <= 6)) throw new ShiftError(400, "weekday must be 0 (Mon) - 6 (Sun)");
  const row = { store_id: b.storeId || null, weekday: wd, on_date: b.onDate || null, start_time: b.startTime, end_time: b.endTime, role: str(b.role, 40), min_staff: min };
  if (b.id) {
    if (!isUuid(b.id)) throw new ShiftError(400, "bad id");
    const rows = await boUpdate("bo_staffing_requirements", `id=eq.${enc(b.id)}`, row);
    if (!rows?.length) throw new ShiftError(404, "requirement not found");
    await boAudit({ actorId: actor.id, action: "update", entityType: "staffing_requirement", entityId: b.id, after: rows[0] });
    return fromRequirement(rows[0]);
  }
  const [created] = await boInsert("bo_staffing_requirements", { ...row, created_by: actor.id });
  await boAudit({ actorId: actor.id, action: "create", entityType: "staffing_requirement", entityId: created.id, after: created });
  return fromRequirement(created);
}
export async function retireRequirement(actor, id) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  await boUpdate("bo_staffing_requirements", `id=eq.${enc(id)}`, { active: false });
  await boAudit({ actorId: actor.id, action: "delete", entityType: "staffing_requirement", entityId: id });
  return { ok: true };
}
const SETTING_KEYS = Object.keys(E.DEFAULT_SETTINGS);
export async function saveSettings(actor, storeId, patch) {
  const clean = {};
  for (const k of SETTING_KEYS) if (patch?.[k] !== undefined) clean[k] = patch[k];
  if (clean.incrementMinutes !== undefined && ![15, 30, 60].includes(Number(clean.incrementMinutes))) throw new ShiftError(400, "incrementMinutes must be 15, 30 or 60");
  if (clean.unavailablePolicy !== undefined && !["warn", "block"].includes(clean.unavailablePolicy)) throw new ShiftError(400, "unavailablePolicy must be warn or block");
  if (clean.maxShiftHours !== undefined && !(Number(clean.maxShiftHours) >= 1 && Number(clean.maxShiftHours) <= 24)) throw new ShiftError(400, "maxShiftHours must be 1-24");
  if (clean.hourThresholds) for (const v of Object.values(clean.hourThresholds)) if (!(Number(v) > 0 && Number(v) <= 168)) throw new ShiftError(400, "hour thresholds must be 1-168");
  const id = storeId || "*";
  const [before] = (await boSelect("bo_shift_settings", `store_id=eq.${enc(id)}&select=*`)) || [];
  const merged = { ...(before?.settings || {}), ...clean };
  const [row] = await boUpsert("bo_shift_settings", { store_id: id, settings: merged, updated_by: actor.id, updated_at: new Date().toISOString(), version: (before?.version || 0) + 1 }, "store_id");
  await boAudit({ actorId: actor.id, action: "update", entityType: "shift_settings", entityId: id, before: before?.settings || null, after: merged });
  return { settings: E.mergeSettings(row.settings), raw: row.settings };
}

/* ---------- leave & availability ---------- */

export async function listLeave({ status = null, employeeId = null } = {}) {
  let q = "select=*&order=starts_at.desc&limit=300";
  if (status) q += `&status=eq.${enc(status)}`;
  if (employeeId) q += `&employee_id=eq.${enc(employeeId)}`;
  return ((await boSelect("bo_staff_leave", q)) || []).map(fromLeave);
}
export async function requestLeave(actor, employeeId, b, { autoApprove = false } = {}) {
  if (!E.isDateStr(b.fromDate) || !E.isDateStr(b.toDate) || b.toDate < b.fromDate) throw new ShiftError(400, "fromDate/toDate (YYYY-MM-DD) required");
  const startsAt = E.iso(E.bkkMs(b.fromDate, E.isTimeStr(b.fromTime) ? b.fromTime : "00:00"));
  const endsAt = E.iso(E.isTimeStr(b.toTime) ? E.bkkMs(b.toDate, b.toTime) : E.bkkMs(b.toDate) + E.DAY_MS);
  if (endsAt <= startsAt) throw new ShiftError(400, "leave must end after it starts");
  const type = ["annual", "sick", "personal", "unpaid", "other"].includes(b.leaveType) ? b.leaveType : "personal";
  const [row] = await boInsert("bo_staff_leave", {
    employee_id: employeeId, starts_at: startsAt, ends_at: endsAt, leave_type: type, reason: str(b.reason, 500),
    status: autoApprove ? "approved" : "pending", requested_by: actor.id,
    ...(autoApprove ? { decided_by: actor.id, decided_at: new Date().toISOString(), decision_note: "entered by manager" } : {}),
  });
  await boAudit({ actorId: actor.id, action: "create", entityType: "staff_leave", entityId: row.id, after: row });
  const leave = fromLeave(row);
  return { leave, affected: autoApprove ? await shiftsOverlapping(leave) : [] };
}
/** Live and published shifts a leave window collides with — surfaced, never auto-rewritten. */
async function shiftsOverlapping(leave) {
  const live = await assignmentsInRange(E.toMs(leave.startsAt), E.toMs(leave.endsAt), { employeeIds: [leave.employeeId] });
  const published = await publishedShiftsFor(leave.employeeId, E.bkkDate(leave.startsAt), E.bkkDate(E.toMs(leave.endsAt) - 1));
  const pubIds = new Set(published.filter((p) => E.overlaps(p, leave)).map((p) => p.id));
  return live.map((a) => ({ ...a, published: pubIds.has(a.id) }));
}
export async function decideLeave(actor, { id, status, note }) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  if (!["approved", "rejected", "cancelled"].includes(status)) throw new ShiftError(400, "status must be approved, rejected or cancelled");
  const [before] = (await boSelect("bo_staff_leave", `id=eq.${enc(id)}&select=*`)) || [];
  if (!before) throw new ShiftError(404, "leave request not found");
  if (status !== "cancelled" && before.status !== "pending") throw new ShiftError(409, `This request is already ${before.status}.`);
  const rows = await boUpdate("bo_staff_leave", `id=eq.${enc(id)}&status=eq.${enc(before.status)}`,
    { status, decided_by: actor.id, decided_at: new Date().toISOString(), decision_note: str(note, 300), updated_at: new Date().toISOString() });
  if (!rows?.length) throw new ShiftError(409, "Someone else decided this request a moment ago.");
  const leave = fromLeave(rows[0]);
  await boAudit({ actorId: actor.id, action: "status_change", entityType: "staff_leave", entityId: id, before, after: rows[0] });
  await notify([{ employee_id: leave.employeeId, kind: `leave_${status}`, title: `Leave ${status}: ${E.fmtSpan(leave)}`,
    body: leave.decisionNote, ref_type: "staff_leave", ref_id: id, dedupe_key: `leave:${id}:${status}` }]);
  return { leave, affected: status === "approved" ? await shiftsOverlapping(leave) : [] };
}
export async function cancelOwnLeave(actor, id) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  const [row] = (await boSelect("bo_staff_leave", `id=eq.${enc(id)}&employee_id=eq.${enc(actor.id)}&select=*`)) || [];
  if (!row) throw new ShiftError(404, "leave request not found");
  if (row.status !== "pending") throw new ShiftError(409, "Only a pending request can be cancelled here; ask a manager to change approved leave.");
  const rows = await boUpdate("bo_staff_leave", `id=eq.${enc(id)}&status=eq.pending`, { status: "cancelled", updated_at: new Date().toISOString() });
  await boAudit({ actorId: actor.id, action: "status_change", entityType: "staff_leave", entityId: id, before: row, after: rows?.[0] });
  return { ok: true };
}
export async function addAvailability(actor, employeeId, b) {
  const kind = ["unavailable", "preferred", "available"].includes(b.kind) ? b.kind : null;
  if (!kind) throw new ShiftError(400, "kind must be unavailable, preferred or available");
  const wd = b.weekday == null || b.weekday === "" ? null : Math.round(Number(b.weekday));
  if (wd == null && !E.isDateStr(b.onDate)) throw new ShiftError(400, "pick a weekday or a date");
  if (wd != null && !(wd >= 0 && wd <= 6)) throw new ShiftError(400, "weekday must be 0 (Mon) - 6 (Sun)");
  const hasTime = b.startTime || b.endTime;
  if (hasTime && (!E.isTimeStr(b.startTime) || !E.isTimeStr(b.endTime))) throw new ShiftError(400, "times must be HH:MM, or leave both blank for all day");
  const [row] = await boInsert("bo_staff_availability", {
    employee_id: employeeId, kind, weekday: wd, on_date: wd == null ? b.onDate : null,
    start_time: hasTime ? b.startTime : null, end_time: hasTime ? b.endTime : null, reason: str(b.reason, 300), created_by: actor.id,
  });
  await boAudit({ actorId: actor.id, action: "create", entityType: "staff_availability", entityId: row.id, after: row });
  return fromAvail(row);
}
export async function withdrawAvailability(actor, id, { own = true } = {}) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  const rows = await boUpdate("bo_staff_availability", `id=eq.${enc(id)}${own ? `&employee_id=eq.${enc(actor.id)}` : ""}`, { status: "withdrawn" });
  if (!rows?.length) throw new ShiftError(404, "availability entry not found");
  await boAudit({ actorId: actor.id, action: "status_change", entityType: "staff_availability", entityId: id, after: rows[0] });
  return { ok: true };
}
export async function reviewAvailability(actor, id) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  const rows = await boUpdate("bo_staff_availability", `id=eq.${enc(id)}`, { reviewed_by: actor.id, reviewed_at: new Date().toISOString() });
  if (!rows?.length) throw new ShiftError(404, "availability entry not found");
  await boAudit({ actorId: actor.id, action: "update", entityType: "staff_availability", entityId: id, after: rows[0], note: "reviewed" });
  return fromAvail(rows[0]);
}
export async function listAvailability() {
  return ((await boSelect("bo_staff_availability", "status=eq.active&select=*&order=created_at.desc&limit=300")) || []).map(fromAvail);
}

/* ---------- shift change requests ---------- */

export async function listRequests({ status = null, requesterId = null } = {}) {
  let q = "select=*&order=created_at.desc&limit=300";
  if (status) q += `&status=eq.${enc(status)}`;
  if (requesterId) q += `&requester_id=eq.${enc(requesterId)}`;
  return ((await boSelect("bo_shift_change_requests", q)) || []).map(fromRequest);
}
export async function fileChangeRequest(actor, b) {
  if (!isUuid(b.assignmentId)) throw new ShiftError(400, "assignmentId required");
  const kind = ["change", "absence", "swap"].includes(b.kind) ? b.kind : null;
  if (!kind) throw new ShiftError(400, "kind must be change, absence or swap");
  const reason = str(b.reason, 500);
  if (!reason) throw new ShiftError(400, "Please give a reason.");
  // Only a shift that was PUBLISHED to this person can be the subject of their request.
  const [row] = (await boSelect("bo_shift_assignments", `id=eq.${enc(b.assignmentId)}&select=*`)) || [];
  const a = fromAssignment(row);
  if (!a || a.employeeId !== actor.id) throw new ShiftError(404, "shift not found");
  const pub = await publishedShiftsFor(actor.id, E.bkkDate(a.startsAt), E.bkkDate(a.startsAt));
  if (!pub.some((p) => p.id === a.id)) throw new ShiftError(404, "shift not found");
  const rec = { requester_id: actor.id, assignment_id: a.id, kind, reason };
  if (kind === "change") {
    if (!E.isDateStr(b.date) || !E.isTimeStr(b.start) || !E.isTimeStr(b.end)) throw new ShiftError(400, "proposed date/start/end required");
    const r = E.localToRange(b.date, b.start, b.end);
    rec.proposed_starts_at = r.startsAt; rec.proposed_ends_at = r.endsAt;
  }
  if (kind === "swap") {
    const employees = await loadEmployees();
    const other = employees.find((e) => e.id === b.swapEmployeeId && e.active && e.id !== actor.id);
    if (!other) throw new ShiftError(400, "Pick a colleague to swap with.");
    rec.swap_employee_id = other.id;
  }
  let created;
  try { [created] = await boInsert("bo_shift_change_requests", rec); }
  catch (e) { if (boErrorCode(e) === "23505") throw new ShiftError(409, "You already have an open request for this shift."); throw e; }
  await boAudit({ actorId: actor.id, action: "create", entityType: "shift_change_request", entityId: created.id, after: created });
  return fromRequest(created);
}
export async function cancelOwnRequest(actor, id) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  const rows = await boUpdate("bo_shift_change_requests", `id=eq.${enc(id)}&requester_id=eq.${enc(actor.id)}&status=eq.pending`, { status: "cancelled", updated_at: new Date().toISOString() });
  if (!rows?.length) throw new ShiftError(409, "Only your own pending request can be cancelled.");
  await boAudit({ actorId: actor.id, action: "status_change", entityType: "shift_change_request", entityId: id, after: rows[0] });
  return { ok: true };
}
/** Approval re-runs the ordinary validated write path. If the change no
    longer fits (conflict, leave, …) the request stays pending with the reason. */
export async function decideRequest(actor, { id, status, note }) {
  if (!isUuid(id)) throw new ShiftError(400, "bad id");
  if (!["approved", "rejected"].includes(status)) throw new ShiftError(400, "status must be approved or rejected");
  const [row] = (await boSelect("bo_shift_change_requests", `id=eq.${enc(id)}&select=*`)) || [];
  if (!row) throw new ShiftError(404, "request not found");
  if (row.status !== "pending") throw new ShiftError(409, `This request is already ${row.status}.`);
  const reqst = fromRequest(row);
  let applied = null;
  if (status === "approved") {
    const a = await liveAssignment(reqst.assignmentId);
    if (reqst.kind === "change") applied = await updateAssignment(actor, { id: a.id, startsAt: reqst.proposedStartsAt, endsAt: reqst.proposedEndsAt }, { skipVersion: true });
    else if (reqst.kind === "swap") applied = await updateAssignment(actor, { id: a.id, employeeId: reqst.swapEmployeeId }, { skipVersion: true });
    else applied = await deleteAssignment(actor, { id: a.id }, { skipVersion: true });
  }
  const rows = await boUpdate("bo_shift_change_requests", `id=eq.${enc(id)}&status=eq.pending`,
    { status, decided_by: actor.id, decided_at: new Date().toISOString(), decision_note: str(note, 300), updated_at: new Date().toISOString() });
  if (!rows?.length) throw new ShiftError(409, "Someone else decided this request a moment ago.");
  await boAudit({ actorId: actor.id, action: "status_change", entityType: "shift_change_request", entityId: id, before: row, after: rows[0] });
  const who = [reqst.requesterId, ...(status === "approved" && reqst.swapEmployeeId ? [reqst.swapEmployeeId] : [])];
  await notify(who.map((emp) => ({ employee_id: emp, kind: `request_${status}`,
    title: `Shift request ${status}`, body: status === "approved" ? "The updated schedule reaches My Shifts once a manager republishes the week." : (str(note, 300) || null),
    ref_type: "shift_change_request", ref_id: id, dedupe_key: `req:${id}:${status}:${emp}` })));
  return { request: fromRequest(rows[0]), applied };
}

/* ---------- notifications ---------- */

export async function myNotifications(employeeId) {
  return ((await boSelect("bo_staff_notifications", `employee_id=eq.${enc(employeeId)}&select=id,kind,title,body,read_at,created_at&order=created_at.desc&limit=30`)) || [])
    .map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, read: Boolean(n.read_at), createdAt: n.created_at }));
}
export async function markNotificationsRead(employeeId) {
  await boUpdate("bo_staff_notifications", `employee_id=eq.${enc(employeeId)}&read_at=is.null`, { read_at: new Date().toISOString() });
  return { ok: true };
}

/** Uniform JSON error reply for both shift endpoints. */
export function sendError(res, e) {
  if (e instanceof ShiftError) {
    const { status, message, ...extra } = e;
    return res.status(status).json({ error: message, ...extra });
  }
  console.error("shift api:", e);
  return res.status(502).json({ error: "bo-db error", detail: String(e?.message || e) });
}
