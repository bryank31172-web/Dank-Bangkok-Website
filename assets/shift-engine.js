/* DANK Shift Maker — scheduling engine.

   Pure functions, no DOM, no fetch. Imported by the BackOffice calendar
   (assets/backoffice-shifts.js), the print renderer (shift-print.html), the
   staff portal (assets/staff-shifts.js) AND the server (api/_shifts.js), so
   the preview a manager sees and the verdict the server gives come from the
   same arithmetic. The server's verdict is the authoritative one; the
   database's exclusion constraint is the final word on double-booking.

   Time: Asia/Bangkok is UTC+7 all year (no DST), so local <-> UTC is a fixed
   offset. Everything internal is epoch milliseconds; storage is ISO UTC.
   A shift belongs to the business date of its START. Intervals are half-open
   [start, end): 09:00-17:00 and 17:00-21:00 do not overlap.

   Vocabulary that the whole feature depends on:
   - CONFLICT        one employee, two intervals that intersect. Invalid.
   - SHARED COVERAGE two different employees on at the same time. Valid,
                     and usually exactly what the shop wants. Never red.            */

export const ZONE = 'Asia/Bangkok';
const OFFSET = 7 * 3600000;
const MIN = 60000;
export const DAY_MS = 86400000;

export const DEFAULT_SETTINGS = Object.freeze({
  incrementMinutes: 30,
  maxShiftHours: 16,
  dayStartHour: 7,
  dayEndHour: 23,
  // Planning thresholds only. Not a legal overtime rule, not payroll.
  hourThresholds: { default: 48, manager: 48, professional: 48, parttime: 30, kitchen: 48 },
  splitShifts: { allowed: false, minRestMinutes: 60 },
  unavailablePolicy: 'warn',        // 'warn' | 'block'
  coverageOnPublish: 'acknowledge', // 'acknowledge' | 'ignore'
  hoursOnPublish: 'acknowledge',    // 'acknowledge' | 'ignore'
});

export function mergeSettings(...layers) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const s of layers) {
    if (!s || typeof s !== 'object') continue;
    for (const [k, v] of Object.entries(s)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = { ...out[k], ...v };
      else if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

/* ---------------- time helpers ---------------- */

export const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v));
export const iso = (ms) => new Date(ms).toISOString();
const pad = (n) => String(n).padStart(2, '0');

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && bkkDate(bkkMs(s, '00:00')) === s;
}
export function isTimeStr(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
/** Bangkok wall clock "YYYY-MM-DD" + "HH:MM" -> epoch ms. */
export function bkkMs(date, time = '00:00') {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = String(time).slice(0, 5).split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - OFFSET;
}
export function bkkDate(ms) { return new Date(toMs(ms) + OFFSET).toISOString().slice(0, 10); }
export function bkkTime(ms) { return new Date(toMs(ms) + OFFSET).toISOString().slice(11, 16); }
/** Minutes since Bangkok midnight of `date` (can exceed 1440 for overnight). */
export function minutesFrom(date, ms) { return Math.round((toMs(ms) - bkkMs(date)) / MIN); }
/** 0 = Monday … 6 = Sunday. */
export function weekday(date) { return (new Date(bkkMs(date) + OFFSET).getUTCDay() + 6) % 7; }
export function addDays(date, n) { return bkkDate(bkkMs(date) + n * DAY_MS + 12 * 3600000); }
export function weekStartOf(date) { return addDays(date, -weekday(date)); }
export function weekDates(start) { return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }
export function todayBkk(now = Date.now()) { return bkkDate(now); }
export function monthGrid(anyDate) {
  const first = anyDate.slice(0, 8) + '01';
  const start = weekStartOf(first);
  const month = first.slice(0, 7);
  const days = [];
  for (let d = start; ; d = addDays(d, 1)) {
    days.push(d);
    if (days.length % 7 === 0 && (addDays(d, 1).slice(0, 7) !== month)) break;
  }
  return { month, start, days };
}
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_NAMES_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** A local date + start/end time -> UTC ISO pair. end <= start means overnight. */
export function localToRange(date, start, end) {
  const s = bkkMs(date, start);
  let e = bkkMs(date, end);
  if (e <= s) e += DAY_MS;
  return { startsAt: iso(s), endsAt: iso(e) };
}
export function fmtHours(minutes) {
  return `${+(minutes / 60).toFixed(2)}h`;
}
export function fmtRange(a) { return `${bkkTime(a.startsAt)}–${bkkTime(a.endsAt)}`; }
export function fmtDateShort(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${DAY_NAMES[weekday(date)]} ${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]}`;
}
export function fmtPeriod(start, end) {
  const [y1, m1, d1] = start.split('-').map(Number), [y2, m2, d2] = end.split('-').map(Number);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${M[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${M[m1 - 1]} – ${d2} ${M[m2 - 1]} ${y1}`;
  return `${d1} ${M[m1 - 1]} ${y1} – ${d2} ${M[m2 - 1]} ${y2}`;
}

/** Human wording for a leave/absence window: whole days read as dates, part days show times. */
export function fmtSpan(item) {
  const s = toMs(item.startsAt), e = toMs(item.endsAt);
  if (bkkTime(s) === '00:00' && bkkTime(e) === '00:00') {
    const first = bkkDate(s), last = bkkDate(e - 1);
    return first === last ? `${fmtDateShort(first)} (all day)` : `${fmtDateShort(first)} – ${fmtDateShort(last)} (all day)`;
  }
  return bkkDate(s) === bkkDate(e) ? `${fmtDateShort(bkkDate(s))} ${bkkTime(s)}–${bkkTime(e)}` : `${fmtDateShort(bkkDate(s))} ${bkkTime(s)} – ${fmtDateShort(bkkDate(e))} ${bkkTime(e)}`;
}

/* ---------------- interval primitives ---------------- */

/** Half-open overlap test: existing.start < proposed.end && proposed.start < existing.end */
export function overlaps(a, b) {
  return toMs(a.startsAt) < toMs(b.endsAt) && toMs(b.startsAt) < toMs(a.endsAt);
}
export function intersection(a, b) {
  const s = Math.max(toMs(a.startsAt), toMs(b.startsAt)), e = Math.min(toMs(a.endsAt), toMs(b.endsAt));
  return e > s ? { startsAt: iso(s), endsAt: iso(e), minutes: (e - s) / MIN } : null;
}
export const durationMinutes = (a) => (toMs(a.endsAt) - toMs(a.startsAt)) / MIN;
export const paidMinutes = (a) => Math.max(0, durationMinutes(a) - (Number(a.breakMinutes) || 0));
export const businessDate = (a) => bkkDate(a.startsAt);
const live = (a) => a && !a.deletedAt;

function mergeIntervals(list) {
  const sorted = list.map(([s, e]) => [s, e]).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push(iv);
  }
  return out;
}

/* ---------------- conflicts vs shared coverage ---------------- */

/** Same-employee overlapping pairs. These are the only genuine conflicts. */
export function findConflicts(assignments) {
  const by = new Map();
  for (const a of assignments.filter(live)) {
    if (!by.has(a.employeeId)) by.set(a.employeeId, []);
    by.get(a.employeeId).push(a);
  }
  const out = [];
  for (const [employeeId, list] of by) {
    list.sort((x, y) => toMs(x.startsAt) - toMs(y.startsAt));
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length && toMs(list[j].startsAt) < toMs(list[i].endsAt); j++) {
        const iv = intersection(list[i], list[j]);
        if (iv) out.push({ employeeId, a: list[i], b: list[j], ...iv });
      }
  }
  return out;
}

/** Different-employee simultaneous intervals. Valid — informational only. */
export function findSharedCoverage(assignments) {
  const list = assignments.filter(live).slice().sort((x, y) => toMs(x.startsAt) - toMs(y.startsAt));
  const out = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length && toMs(list[j].startsAt) < toMs(list[i].endsAt); j++) {
      if (list[i].employeeId === list[j].employeeId) continue;
      const iv = intersection(list[i], list[j]);
      if (iv) out.push({ a: list[i], b: list[j], date: bkkDate(iv.startsAt), ...iv });
    }
  return out;
}

/* ---------------- side-by-side lanes ---------------- */

/** Assign each shift a lane so simultaneous shifts render side by side and
    never cover each other. Returns Map(id -> {lane, lanes}). */
export function layoutLanes(assignments) {
  const list = assignments.filter(live).slice().sort((x, y) => toMs(x.startsAt) - toMs(y.startsAt) || toMs(y.endsAt) - toMs(x.endsAt));
  const result = new Map();
  let cluster = [], clusterEnd = -Infinity, laneEnds = [];
  const flush = () => { const lanes = laneEnds.length; for (const id of cluster) result.get(id).lanes = lanes; cluster = []; laneEnds = []; };
  for (const a of list) {
    const s = toMs(a.startsAt), e = toMs(a.endsAt);
    if (s >= clusterEnd) { flush(); clusterEnd = -Infinity; }
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    result.set(a.id, { lane, lanes: 1 });
    cluster.push(a.id);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return result;
}

/* ---------------- staffing requirements & coverage ---------------- */

/** The requirement rules that apply to one date. A rule for that exact date
    replaces the weekday rules for that date (holidays, events). */
export function requirementsFor(date, requirements, storeId) {
  const rules = (requirements || []).filter((r) => r.active !== false && (!r.storeId || !storeId || r.storeId === storeId));
  const dated = rules.filter((r) => r.onDate === date);
  const use = dated.length ? dated : rules.filter((r) => !r.onDate && (r.weekday == null || Number(r.weekday) === weekday(date)));
  return use.map((r) => ({ ...r, ...localToRange(date, r.startTime.slice(0, 5), r.endTime.slice(0, 5)) }));
}

/** Exact staffing curve for one business date: constant-count segments
    between every shift/requirement boundary. This is true hourly coverage —
    NOT the number of different people who worked that day. */
export function coverageForDate(date, assignments, requirements, { storeId = null, role = null, settings = DEFAULT_SETTINGS } = {}) {
  const dayStart = bkkMs(date, pad(settings.dayStartHour) + ':00');
  const dayEnd = bkkMs(date, '00:00') + settings.dayEndHour * 3600000;
  const shifts = assignments.filter((a) => live(a) && (!storeId || a.storeId === storeId) && (!role || a.role === role));
  const rules = requirementsFor(date, requirements, storeId).filter((r) => !role || !r.role || r.role === role);
  const points = new Set([dayStart, dayEnd]);
  for (const a of shifts) { const s = toMs(a.startsAt), e = toMs(a.endsAt); if (e > dayStart - DAY_MS && s < dayEnd + DAY_MS) { points.add(s); points.add(e); } }
  for (const r of rules) { points.add(toMs(r.startsAt)); points.add(toMs(r.endsAt)); }
  const lo = Math.min(dayStart, ...rules.map((r) => toMs(r.startsAt)), ...shifts.filter((a) => businessDate(a) === date).map((a) => toMs(a.startsAt)));
  const hi = Math.max(dayEnd, ...rules.map((r) => toMs(r.endsAt)), ...shifts.filter((a) => businessDate(a) === date).map((a) => toMs(a.endsAt)));
  const sorted = [...points].filter((p) => p >= lo && p <= hi).sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const s = sorted[i], e = sorted[i + 1];
    const on = shifts.filter((a) => toMs(a.startsAt) <= s && toMs(a.endsAt) >= e);
    const active = rules.filter((r) => toMs(r.startsAt) <= s && toMs(r.endsAt) >= e);
    const anyRole = active.filter((r) => !r.role);
    const required = anyRole.length ? Math.max(...anyRole.map((r) => r.minStaff)) : 0;
    const roleShort = [];
    for (const r of active.filter((r) => r.role)) {
      const have = on.filter((a) => a.role === r.role).length;
      if (have < r.minStaff) roleShort.push({ role: r.role, have, need: r.minStaff });
    }
    const count = on.length;
    const hasRule = active.length > 0;
    const status = !hasRule ? 'none' : (count < required || roleShort.length) ? 'under' : count === required ? 'met' : 'above';
    segments.push({ start: s, end: e, count, required, roleShort, status, employeeIds: on.map((a) => a.employeeId) });
  }
  const reqMinutes = segments.filter((x) => x.status !== 'none').reduce((t, x) => t + (x.end - x.start) / MIN, 0);
  const underSegs = segments.filter((x) => x.status === 'under');
  const underMinutes = underSegs.reduce((t, x) => t + (x.end - x.start) / MIN, 0);
  const shortages = mergeIntervals(underSegs.map((x) => [x.start, x.end])).map(([s, e]) => {
    const inside = underSegs.filter((x) => x.start >= s && x.end <= e);
    return {
      date, start: s, end: e, minutes: (e - s) / MIN,
      lowest: Math.min(...inside.map((x) => x.count)),
      required: Math.max(...inside.map((x) => x.required)),
      roles: [...new Set(inside.flatMap((x) => x.roleShort.map((r) => r.role)))],
    };
  });
  const inReq = segments.filter((x) => x.status !== 'none');
  return {
    date, segments, shortages,
    requiredMinutes: reqMinutes,
    understaffedMinutes: underMinutes,
    metPercent: reqMinutes ? Math.round(((reqMinutes - underMinutes) / reqMinutes) * 100) : null,
    lowestDuringTargets: inReq.length ? Math.min(...inReq.map((x) => x.count)) : null,
    peak: segments.length ? Math.max(...segments.map((x) => x.count)) : 0,
    uniqueStaff: new Set(shifts.filter((a) => businessDate(a) === date).map((a) => a.employeeId)).size,
    hasTargets: rules.length > 0,
  };
}

/* ---------------- weekly hours ---------------- */

export function thresholdFor(employee, settings = DEFAULT_SETTINGS) {
  const t = settings.hourThresholds || {};
  return Number(t[employee?.role] ?? t.default ?? 48);
}

/** Paid scheduled minutes per employee inside [weekStart, weekStart+7d).
    Overnight shifts are clipped at the week edge; overlapping same-employee
    intervals (which should never exist) are unioned so nothing is counted
    twice; unpaid breaks are subtracted pro rata for clipped shifts. */
export function weeklyHours(assignments, employees, weekStart, settings = DEFAULT_SETTINGS) {
  const ws = bkkMs(weekStart), we = ws + 7 * DAY_MS;
  const rows = new Map();
  for (const e of employees) rows.set(e.id, { employeeId: e.id, name: e.name, role: e.role, minutes: 0, days: 0, shifts: 0, threshold: thresholdFor(e, settings), over: 0 });
  const by = new Map();
  for (const a of assignments.filter(live)) {
    const s = Math.max(ws, toMs(a.startsAt)), e = Math.min(we, toMs(a.endsAt));
    if (e <= s) continue;
    const share = (e - s) / (toMs(a.endsAt) - toMs(a.startsAt));
    if (!by.has(a.employeeId)) by.set(a.employeeId, []);
    by.get(a.employeeId).push({ s, e, brk: (Number(a.breakMinutes) || 0) * MIN * share, date: businessDate(a) });
  }
  for (const [id, list] of by) {
    if (!rows.has(id)) rows.set(id, { employeeId: id, name: id, role: null, minutes: 0, days: 0, shifts: 0, threshold: thresholdFor(null, settings), over: 0 });
    const union = mergeIntervals(list.map((x) => [x.s, x.e])).reduce((t, [s, e]) => t + (e - s), 0);
    const brk = list.reduce((t, x) => t + x.brk, 0);
    const r = rows.get(id);
    r.minutes = Math.max(0, Math.round((union - brk) / MIN));
    r.days = new Set(list.map((x) => x.date)).size;
    r.shifts = list.length;
  }
  for (const r of rows.values()) r.over = Math.max(0, r.minutes - r.threshold * 60);
  return [...rows.values()];
}

/* ---------------- availability & leave ---------------- */

function availabilityWindow(entry, date) {
  if (!entry.startTime || !entry.endTime) return { startsAt: iso(bkkMs(date)), endsAt: iso(bkkMs(date) + DAY_MS) };
  return localToRange(date, entry.startTime.slice(0, 5), entry.endTime.slice(0, 5));
}
/** Availability entries that touch a shift (checks the shift's date and the day before, for overnight windows). */
export function availabilityHits(shift, availability, kind = 'unavailable') {
  const d = businessDate(shift), hits = [];
  for (const entry of availability || []) {
    if (entry.employeeId !== shift.employeeId || entry.status === 'withdrawn' || entry.kind !== kind) continue;
    for (const date of [addDays(d, -1), d, addDays(d, 1)]) {
      const applies = entry.onDate ? entry.onDate === date : Number(entry.weekday) === weekday(date);
      if (applies && overlaps(availabilityWindow(entry, date), shift)) { hits.push(entry); break; }
    }
  }
  return hits;
}
export function leaveHits(shift, leave, status = 'approved') {
  return (leave || []).filter((l) => l.employeeId === shift.employeeId && l.status === status && overlaps(l, shift));
}

/* ---------------- validation ---------------- */

const issue = (severity, code, message, extra = {}) => ({ severity, code, message, ...extra });

/** Validate one proposed assignment against everything else.
    ctx: { assignments, leave, availability, employees, settings }
    Returns { errors, warnings }. Errors block saving AND publishing. */
export function validateAssignment(p, ctx = {}) {
  const settings = ctx.settings || DEFAULT_SETTINGS;
  const errors = [], warnings = [];
  const emp = (ctx.employees || []).find((e) => e.id === p.employeeId);
  const name = emp?.name || p.employeeId;
  const s = toMs(p.startsAt), e = toMs(p.endsAt);
  if (!p.employeeId) errors.push(issue('error', 'employee_required', 'Choose an employee.'));
  else if (ctx.employees && !emp) errors.push(issue('error', 'employee_unknown', 'That staff account does not exist.'));
  else if (emp && emp.active === false) errors.push(issue('error', 'employee_inactive', `${name}'s account is disabled.`));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    errors.push(issue('error', 'invalid_time', 'The shift must end after it starts.'));
    return { errors, warnings };
  }
  const mins = (e - s) / MIN;
  if (mins > settings.maxShiftHours * 60) errors.push(issue('error', 'too_long', `A shift can be at most ${settings.maxShiftHours} hours (this one is ${fmtHours(mins)}).`));
  if ((Number(p.breakMinutes) || 0) >= mins) errors.push(issue('error', 'break_too_long', 'The unpaid break is as long as the shift.'));
  const others = (ctx.assignments || []).filter((a) => live(a) && a.id !== p.id && a.employeeId === p.employeeId);
  const date = bkkDate(s);
  for (const o of others) {
    if (overlaps(o, p)) {
      errors.push(issue('error', 'overlap',
        `${name} is already scheduled ${fmtDateShort(businessDate(o))} ${fmtRange(o)}; the proposed ${fmtRange(p)} overlaps it. One person cannot work two shifts at once.`,
        { employeeId: p.employeeId, assignmentIds: [o.id, p.id].filter(Boolean), date, key: `overlap:${[o.id, p.id].sort().join(':')}` }));
    }
  }
  const sameDay = others.filter((o) => businessDate(o) === date && !overlaps(o, p));
  if (sameDay.length) {
    if (!settings.splitShifts?.allowed || !p.splitOverride) {
      errors.push(issue('error', 'split_not_allowed',
        `${name} already has a shift on ${fmtDateShort(date)} (${sameDay.map(fmtRange).join(', ')}). ${settings.splitShifts?.allowed ? 'Tick "Allow split shift" to add a second one.' : 'Split shifts are switched off in Shift settings.'}`,
        { employeeId: p.employeeId, date, assignmentIds: [p.id, ...sameDay.map((o) => o.id)].filter(Boolean) }));
    } else {
      const rest = settings.splitShifts.minRestMinutes || 0;
      for (const o of sameDay) {
        const gap = toMs(o.endsAt) <= s ? (s - toMs(o.endsAt)) / MIN : (toMs(o.startsAt) - e) / MIN;
        if (gap < rest) errors.push(issue('error', 'rest_too_short', `${name} needs at least ${rest} minutes between split shifts (gap is ${gap}).`, { employeeId: p.employeeId, date }));
      }
    }
  }
  for (const l of leaveHits(p, ctx.leave, 'approved'))
    errors.push(issue('error', 'leave', `${name} has approved leave ${fmtSpan(l)}.`, { employeeId: p.employeeId, date, key: `leave:${l.id}:${p.id}`, assignmentIds: [p.id].filter(Boolean) }));
  for (const l of leaveHits(p, ctx.leave, 'pending'))
    warnings.push(issue('warning', 'leave_pending', `${name} has a leave request waiting for approval that covers this shift.`, { employeeId: p.employeeId, date, key: `leave_pending:${l.id}:${p.id}` }));
  for (const u of availabilityHits(p, ctx.availability, 'unavailable')) {
    const msg = `${name} marked themselves unavailable${u.reason ? ` (${u.reason})` : ''} at this time.`;
    if (settings.unavailablePolicy === 'block') errors.push(issue('error', 'unavailable', msg, { employeeId: p.employeeId, date, assignmentIds: [p.id].filter(Boolean) }));
    else warnings.push(issue('warning', 'unavailable', msg, { employeeId: p.employeeId, date, key: `unavail:${u.id}:${p.id}` }));
  }
  if (emp) {
    const ws = weekStartOf(date);
    const [row] = weeklyHours([...others, p], [emp], ws, settings).filter((r) => r.employeeId === emp.id);
    if (row && row.over > 0)
      warnings.push(issue('warning', 'hours', `${name} would be scheduled ${fmtHours(row.minutes)} in the week of ${fmtDateShort(ws)}, above the ${row.threshold}h planning threshold.`, { employeeId: emp.id, key: `hours:${emp.id}:${ws}` }));
  }
  return { errors, warnings };
}

/** Validate a whole period (what publishing checks). Returns deduplicated
    errors and warnings plus the informational shared-coverage list. */
export function validatePeriod({ assignments, leave, availability, employees, requirements, settings = DEFAULT_SETTINGS, weekStart, storeId }) {
  const list = assignments.filter(live);
  const errors = [], warnings = [], seen = new Set();
  const push = (arr, x) => { const k = x.key || `${x.code}:${x.employeeId || ''}:${x.date || ''}:${(x.assignmentIds || []).slice().sort().join(',')}`; if (seen.has(k)) return; seen.add(k); arr.push({ ...x, key: k }); };
  for (const a of list) {
    const v = validateAssignment(a, { assignments: list, leave, availability, employees, settings });
    v.errors.forEach((x) => push(errors, { assignmentIds: [a.id], ...x }));
    v.warnings.filter((w) => w.code !== 'hours').forEach((x) => push(warnings, { assignmentIds: [a.id], ...x }));
  }
  for (const r of weeklyHours(list, employees, weekStart, settings))
    if (r.over > 0) push(warnings, issue('warning', 'hours', `${r.name} is scheduled ${fmtHours(r.minutes)}, ${fmtHours(r.over)} above the ${r.threshold}h planning threshold.`, { employeeId: r.employeeId, key: `hours:${r.employeeId}:${weekStart}` }));
  const days = weekDates(weekStart).map((d) => coverageForDate(d, list, requirements, { storeId, settings }));
  for (const day of days)
    for (const s of day.shortages)
      push(warnings, issue('warning', 'coverage', `${fmtDateShort(day.date)} ${bkkTime(s.start)}–${bkkTime(s.end)}: ${s.lowest} on shift, target ${s.required}${s.roles.length ? ` (short: ${s.roles.join(', ')})` : ''}.`, { date: day.date, key: `coverage:${day.date}:${bkkTime(s.start)}-${bkkTime(s.end)}` }));
  return { errors, warnings, shared: findSharedCoverage(list), coverage: days };
}

/** Warnings that need an explicit tick before publish, under the settings policy. */
export function warningsNeedingAck(warnings, settings = DEFAULT_SETTINGS) {
  return warnings.filter((w) =>
    (w.code === 'coverage' && settings.coverageOnPublish !== 'ignore') ||
    (w.code === 'hours' && settings.hoursOnPublish !== 'ignore') ||
    w.code === 'unavailable' || w.code === 'leave_pending');
}

/* ---------------- auto-hide: who is free on a date ---------------- */

/** Status of each employee for one date. Default list = status 'free'.
    This is a UX convenience only; the server validates every write. */
export function staffForDate(date, employees, assignments, { leave = [], availability = [], settings = DEFAULT_SETTINGS } = {}) {
  const dayWin = { startsAt: iso(bkkMs(date)), endsAt: iso(bkkMs(date) + DAY_MS) };
  return employees.filter((e) => e.active !== false).map((e) => {
    const mine = assignments.filter((a) => live(a) && a.employeeId === e.id && businessDate(a) === date);
    const onLeave = (leave || []).some((l) => l.employeeId === e.id && l.status === 'approved' && overlaps(l, dayWin));
    const unavailable = availabilityHits({ ...dayWin, employeeId: e.id }, availability, 'unavailable');
    const allDayUnavail = unavailable.some((u) => !u.startTime);
    let status = 'free';
    if (mine.length) status = 'assigned';
    else if (onLeave) status = 'leave';
    else if (allDayUnavail && settings.unavailablePolicy === 'block') status = 'unavailable';
    return { ...e, status, shifts: mine, partlyUnavailable: unavailable.length > 0 };
  });
}

/* ---------------- copy previous week ---------------- */

/** Proposed copies of `source` moved from week `fromWeek` to `toWeek`, same
    weekday and wall-clock times. Pure: the caller supplies ids and decides
    what to keep after reviewing the flags. copySourceId makes re-running
    the same copy a no-op on the server. */
export function planCopyWeek(source, fromWeek, toWeek, makeId) {
  const shift = Math.round((bkkMs(toWeek) - bkkMs(fromWeek)) / DAY_MS) * DAY_MS;
  return source.filter(live).map((a) => ({
    id: makeId(), employeeId: a.employeeId, storeId: a.storeId, role: a.role || null,
    templateId: a.templateId || null, breakMinutes: Number(a.breakMinutes) || 0, notes: a.notes || null,
    startsAt: iso(toMs(a.startsAt) + shift), endsAt: iso(toMs(a.endsAt) + shift), copySourceId: a.id,
  }));
}

/* ---------------- colours ---------------- */

/* Pastel fills with a darker same-hue border and near-black text: every pair
   passes 4.5:1 for the text. Colour is never the only signal — every card
   also prints the name. */
export const PALETTE = [
  { bg: '#DCEBFF', border: '#5B8DEF', text: '#14233D' }, { bg: '#FFE3D6', border: '#E8865A', text: '#3D1D10' },
  { bg: '#E1F5E4', border: '#4FAE62', text: '#12301A' }, { bg: '#F1E3FF', border: '#9A6BDB', text: '#2A1640' },
  { bg: '#FFF3C4', border: '#D1A21E', text: '#3A2C05' }, { bg: '#D7F4F4', border: '#3AA7A7', text: '#0E3030' },
  { bg: '#FFDDEA', border: '#D9608F', text: '#3D1022' }, { bg: '#E8E9FF', border: '#6A70D8', text: '#191B45' },
  { bg: '#EAF5D3', border: '#86AD2F', text: '#25320A' }, { bg: '#FFE7C7', border: '#D98A1F', text: '#3B2405' },
  { bg: '#DDF0FA', border: '#3D9AC9', text: '#0D2B3B' }, { bg: '#F6E1DA', border: '#B87563', text: '#36190F' },
  { bg: '#E4F1EC', border: '#5E9E86', text: '#14302A' }, { bg: '#F3E6F7', border: '#B072C4', text: '#341A3D' },
  { bg: '#FBEBD3', border: '#BF8E45', text: '#3A270B' }, { bg: '#E3E8EF', border: '#6E819C', text: '#18212E' },
];
/** Stable colour per employee: sorted by name then id, so the calendar,
    the legend and the PDF always agree for the same roster. */
export function colorMap(employees) {
  const sorted = employees.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
  return new Map(sorted.map((e, i) => [e.id, PALETTE[i % PALETTE.length]]));
}

/* ---------------- PDF remarks ---------------- */

/** Compact remark lines, only for things that are actually present. */
export function buildRemarks({ validation, employees, acknowledged = [] }) {
  const nm = (id) => employees.find((e) => e.id === id)?.name || id;
  const out = [];
  for (const x of validation.errors) out.push({ tone: 'error', text: x.message });
  const pairs = new Map();
  for (const s of validation.shared) {
    const ids = [s.a.employeeId, s.b.employeeId].sort();
    const k = `${s.date}:${ids.join(':')}:${bkkTime(s.startsAt)}`;
    if (!pairs.has(k)) pairs.set(k, `${nm(ids[0])} and ${nm(ids[1])} both scheduled ${fmtDateShort(s.date)} ${bkkTime(s.startsAt)}–${bkkTime(s.endsAt)} (shared coverage)`);
  }
  for (const t of pairs.values()) out.push({ tone: 'info', text: t });
  for (const w of validation.warnings) out.push({ tone: acknowledged.includes(w.key) ? 'ack' : 'warn', text: w.message + (acknowledged.includes(w.key) ? ' — acknowledged at publish' : '') });
  return out;
}

/* ---------------- attendance (Phase 5 preparation only) ---------------- */

/** Compare a scheduled shift with clock punches. Reports lateness, early
    departure and missing punches. It deliberately does NOT decide payable
    overtime — that is a payroll decision, not a scheduling one. */
export function compareAttendance(shift, punches = {}, { graceMinutes = 0 } = {}) {
  const s = toMs(shift.startsAt), e = toMs(shift.endsAt);
  const inMs = punches.clockIn ? toMs(punches.clockIn) : null, outMs = punches.clockOut ? toMs(punches.clockOut) : null;
  const missing = [];
  if (inMs == null) missing.push('clock_in');
  if (outMs == null) missing.push('clock_out');
  const late = inMs != null ? Math.max(0, Math.round((inMs - s) / MIN)) : null;
  const early = outMs != null ? Math.max(0, Math.round((e - outMs) / MIN)) : null;
  return {
    lateMinutes: late != null && late > graceMinutes ? late : 0,
    earlyLeaveMinutes: early != null && early > graceMinutes ? early : 0,
    stayedLaterMinutes: outMs != null ? Math.max(0, Math.round((outMs - e) / MIN)) : 0,
    missing,
    payableOvertime: null,
  };
}

/* ---------------- auto-fill (draft suggestions) ---------------- */

/** Suggest shifts that close the staffing gaps in one week at one store.
    Nothing is saved: the caller shows the list and creates the ticked ones,
    and the server re-validates each of them. For every short window the
    smallest template that covers it is used (else the exact window, capped at
    the longest allowed shift); the person picked is the one with the fewest
    hours that week who passes every check without warnings, and who stays
    under their weekly hour threshold. */
export function planAutoFill({ storeId, weekStart, assignments = [], requirements = [], employees = [], leave = [], availability = [], templates = [], settings = DEFAULT_SETTINGS, makeId = (i) => `auto-${i}` }) {
  const working = assignments.filter(live).slice();
  const proposals = [], unfilled = [];
  const active = employees.filter((e) => e.active !== false);
  const tpls = templates.filter((t) => !t.storeId || t.storeId === storeId);
  const maxMin = (settings.maxShiftHours || 12) * 60;
  let n = 0;
  for (const date of weekDates(weekStart)) {
    for (let guard = 0; guard < 30; guard++) {
      const cov = coverageForDate(date, working, requirements, { storeId, settings });
      const gap = cov.shortages.find((g) => !unfilled.some((u) => u.date === date && u.start === g.start));
      if (!gap) break;
      const gapMin = (gap.end - gap.start) / MIN;
      // Smallest template that fully covers the gap; otherwise the gap itself.
      const fits = tpls.map((t) => ({ t, r: localToRange(date, t.startTime, t.endTime) }))
        .filter(({ r }) => toMs(r.startsAt) <= gap.start && toMs(r.endsAt) >= gap.end)
        .sort((a, b) => durationMinutes(a.r) - durationMinutes(b.r));
      const tpl = fits[0]?.t || null;
      const range = fits[0]?.r || { startsAt: iso(gap.start), endsAt: iso(gap.start + Math.min(gapMin, maxMin) * MIN) };
      const role = gap.roles[0] || tpl?.role || null;
      const hours = new Map(weeklyHours(working, active, weekStart, settings).map((r) => [r.employeeId, r]));
      const shift = (e) => ({ id: makeId(n), employeeId: e.id, storeId, ...range, role, breakMinutes: tpl?.breakMinutes || 0, templateId: tpl?.id || null, notes: null, splitOverride: false });
      const ranked = active.map((e) => {
        const p = shift(e);
        const v = validateAssignment(p, { assignments: working, leave, availability, employees: active, settings });
        const h = hours.get(e.id) || { minutes: 0, threshold: thresholdFor(e, settings) };
        return { e, p, v, after: h.minutes + paidMinutes(p), cap: h.threshold * 60, before: h.minutes };
      }).filter((x) => !x.v.errors.length && x.after <= x.cap)
        .sort((a, b) => a.v.warnings.length - b.v.warnings.length || a.before - b.before || a.e.name.localeCompare(b.e.name));
      if (!ranked.length) { unfilled.push({ date, start: gap.start, end: gap.end, required: gap.required, lowest: gap.lowest }); continue; }
      const pick = ranked[0];
      n++;
      working.push(pick.p);
      proposals.push({ ...pick.p, warnings: pick.v.warnings.map((w) => w.message), reason: `${fmtDateShort(date)} ${bkkTime(gap.start)}–${bkkTime(gap.end)} had ${gap.lowest} of ${gap.required}` });
    }
  }
  return { proposals, unfilled };
}
