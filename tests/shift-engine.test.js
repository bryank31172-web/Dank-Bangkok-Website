import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../assets/shift-engine.js';

const T = '2026-11-17'; // a Tuesday
const sh = (id, employeeId, date, start, end, extra = {}) => ({ id, employeeId, storeId: 's1', ...E.localToRange(date, start, end), breakMinutes: 0, ...extra });
const emma = { id: 'emma', name: 'Emma W.', role: 'professional' };
const noah = { id: 'noah', name: 'Noah T.', role: 'parttime' };
const employees = [emma, noah];

test('Bangkok time helpers: fixed +07:00, Monday weeks, overnight ranges', () => {
  assert.equal(E.localToRange(T, '09:00', '17:00').startsAt, '2026-11-17T02:00:00.000Z');
  const night = E.localToRange(T, '20:00', '04:00');
  assert.equal(night.endsAt, '2026-11-17T21:00:00.000Z');
  assert.equal(E.weekday(T), 1);
  assert.equal(E.weekStartOf(T), '2026-11-16');
  assert.equal(E.weekStartOf('2026-11-22'), '2026-11-16');
  assert.equal(E.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(E.bkkDate('2026-11-17T17:30:00Z'), '2026-11-18'); // 00:30 Bangkok next day
  const g = E.monthGrid('2026-11-05');
  assert.equal(g.days[0], '2026-10-26');
  assert.equal(g.days.length % 7, 0);
  assert.ok(g.days.includes('2026-11-30'));
});

test('the spec example: Emma 09-17 + Noah 13-21 is shared coverage 13:00-17:00, not a conflict', () => {
  const list = [sh('a', 'emma', T, '09:00', '17:00'), sh('b', 'noah', T, '13:00', '21:00')];
  assert.equal(E.findConflicts(list).length, 0);
  const shared = E.findSharedCoverage(list);
  assert.equal(shared.length, 1);
  assert.equal(E.bkkTime(shared[0].startsAt), '13:00');
  assert.equal(E.bkkTime(shared[0].endsAt), '17:00');
  assert.equal(shared[0].minutes, 240);
  const v = E.validateAssignment(list[1], { assignments: list, employees });
  assert.deepEqual(v.errors, []);
});

test('Emma 09-17 + Emma 13-21 is a genuine conflict and blocks', () => {
  const list = [sh('a', 'emma', T, '09:00', '17:00'), sh('b', 'emma', T, '13:00', '21:00')];
  assert.equal(E.findConflicts(list).length, 1);
  const v = E.validateAssignment(list[1], { assignments: list, employees });
  assert.equal(v.errors[0].code, 'overlap');
  assert.match(v.errors[0].message, /Emma W\. is already scheduled Tue 17 Nov 09:00–17:00/);
});

test('equal endpoints are not an overlap (half-open intervals)', () => {
  const a = sh('a', 'emma', T, '09:00', '17:00'), b = sh('b', 'emma', T, '17:00', '21:00');
  assert.equal(E.overlaps(a, b), false);
  assert.equal(E.findConflicts([a, b]).length, 0);
});

test('overnight overlap is detected across midnight', () => {
  const a = sh('a', 'emma', T, '20:00', '04:00'), b = sh('b', 'emma', '2026-11-18', '02:00', '10:00');
  assert.equal(E.overlaps(a, b), true);
  const c = sh('c', 'emma', '2026-11-18', '04:00', '10:00');
  assert.equal(E.overlaps(a, c), false);
});

test('second same-day shift needs split shifts enabled, override ticked and enough rest', () => {
  const a = sh('a', 'emma', T, '09:00', '12:00');
  const b = sh('b', 'emma', T, '12:30', '16:00', { splitOverride: true });
  const ctx = (settings) => ({ assignments: [a], employees, settings: E.mergeSettings(settings) });
  assert.equal(E.validateAssignment(b, ctx({})).errors[0].code, 'split_not_allowed');
  assert.equal(E.validateAssignment(b, ctx({ splitShifts: { allowed: true, minRestMinutes: 60 } })).errors[0].code, 'rest_too_short');
  assert.deepEqual(E.validateAssignment(b, ctx({ splitShifts: { allowed: true, minRestMinutes: 30 } })).errors, []);
  assert.equal(E.validateAssignment({ ...b, splitOverride: false }, ctx({ splitShifts: { allowed: true } })).errors[0].code, 'split_not_allowed');
});

test('approved leave hard-blocks, pending leave and unavailability only warn', () => {
  const p = sh('p', 'emma', T, '09:00', '17:00');
  const leave = [{ id: 'l1', employeeId: 'emma', status: 'approved', ...E.localToRange(T, '00:00', '00:00') }];
  assert.equal(E.validateAssignment(p, { leave, employees }).errors[0].code, 'leave');
  const pending = [{ ...leave[0], status: 'pending' }];
  const v = E.validateAssignment(p, { leave: pending, employees });
  assert.deepEqual(v.errors, []);
  assert.equal(v.warnings[0].code, 'leave_pending');
  const availability = [{ id: 'u1', employeeId: 'emma', kind: 'unavailable', weekday: 1, startTime: '15:00', endTime: '18:00', reason: 'class' }];
  assert.equal(E.validateAssignment(p, { availability, employees }).warnings[0].code, 'unavailable');
  const blocked = E.validateAssignment(p, { availability, employees, settings: E.mergeSettings({ unavailablePolicy: 'block' }) });
  assert.equal(blocked.errors[0].code, 'unavailable');
  const other = [{ ...availability[0], weekday: 3 }];
  assert.equal(E.validateAssignment(p, { availability: other, employees }).warnings.length, 0);
});

test('invalid shapes: end before start, too long, break as long as the shift', () => {
  assert.equal(E.validateAssignment({ employeeId: 'emma', startsAt: '2026-11-17T10:00Z', endsAt: '2026-11-17T09:00Z' }, { employees }).errors[0].code, 'invalid_time');
  assert.equal(E.validateAssignment({ ...sh('x', 'emma', T, '06:00', '23:30') }, { employees }).errors[0].code, 'too_long');
  assert.equal(E.validateAssignment({ ...sh('x', 'emma', T, '09:00', '10:00'), breakMinutes: 60 }, { employees }).errors[0].code, 'break_too_long');
  assert.equal(E.validateAssignment(sh('x', 'ghost', T, '09:00', '10:00'), { employees }).errors[0].code, 'employee_unknown');
});

test('weekly hours subtract unpaid breaks, clip overnight at the week edge, never double count', () => {
  const ws = '2026-11-16';
  const list = [
    sh('a', 'emma', '2026-11-16', '09:00', '17:00', { breakMinutes: 60 }), // 7h
    sh('b', 'emma', '2026-11-17', '09:00', '17:00', { breakMinutes: 60 }), // 7h
    sh('c', 'noah', '2026-11-22', '20:00', '04:00'),                       // Sun 20:00 -> Mon 04:00: only 4h in this week
  ];
  const rows = E.weeklyHours(list, employees, ws);
  assert.equal(rows.find(r => r.employeeId === 'emma').minutes, 14 * 60);
  assert.equal(rows.find(r => r.employeeId === 'emma').days, 2);
  assert.equal(rows.find(r => r.employeeId === 'noah').minutes, 4 * 60);
  const next = E.weeklyHours(list, employees, '2026-11-23');
  assert.equal(next.find(r => r.employeeId === 'noah').minutes, 4 * 60);
  const dup = E.weeklyHours([sh('a', 'emma', T, '09:00', '17:00'), sh('b', 'emma', T, '13:00', '21:00')], employees, ws);
  assert.equal(dup.find(r => r.employeeId === 'emma').minutes, 12 * 60, 'union, not 16h');
});

test('hours threshold is configurable per category and only a planning warning', () => {
  const list = [0, 1, 2, 3].map(i => sh('a' + i, 'noah', E.addDays('2026-11-16', i), '09:00', '17:00'));
  const settings = E.mergeSettings({ hourThresholds: { parttime: 30 } });
  const rows = E.weeklyHours(list, employees, '2026-11-16', settings);
  assert.equal(rows.find(r => r.employeeId === 'noah').over, 120);
  const v = E.validateAssignment(list[3], { assignments: list, employees, settings });
  assert.deepEqual(v.errors, []);
  assert.equal(v.warnings[0].code, 'hours');
});

test('hourly coverage against targets: under / met / above, and unique headcount is not coverage', () => {
  const reqs = [
    { id: 'r1', startTime: '09:00', endTime: '12:00', minStaff: 2 },
    { id: 'r2', startTime: '12:00', endTime: '18:00', minStaff: 3 },
    { id: 'r3', startTime: '18:00', endTime: '23:00', minStaff: 2 },
  ];
  const list = [sh('a', 'emma', T, '09:00', '17:00'), sh('b', 'noah', T, '13:00', '21:00'), sh('c', 'ava', T, '09:00', '13:00')];
  const c = E.coverageForDate(T, list, reqs);
  const at = (hhmm) => c.segments.find(s => s.start <= E.bkkMs(T, hhmm) && s.end > E.bkkMs(T, hhmm));
  assert.equal(at('10:00').status, 'met');
  assert.equal(at('12:30').status, 'under');   // 2 of 3
  assert.equal(at('13:30').status, 'under');   // emma+noah = 2 of 3
  assert.equal(at('17:30').count, 1);
  assert.equal(at('17:30').status, 'under');
  assert.equal(c.uniqueStaff, 3, 'three people worked…');
  assert.ok(c.understaffedMinutes > 0, '…and the shop was still short');
  // 12-18 has 2 of 3, 18-21 has 1 of 2, 21-23 has 0 of 2: one merged 11h shortage.
  assert.equal(c.shortages.length, 1);
  assert.equal(c.shortages[0].minutes, 11 * 60, '12:00-23:00 merged');
  assert.equal(c.shortages[0].lowest, 0);
  const role = E.coverageForDate(T, list, [{ startTime: '09:00', endTime: '12:00', minStaff: 1, role: 'cashier' }]);
  assert.equal(role.segments.find(s => s.status !== 'none').status, 'under');
  assert.deepEqual(role.shortages[0].roles, ['cashier']);
});

test('a date-specific requirement replaces the weekday rule for that date', () => {
  const reqs = [{ weekday: 1, startTime: '09:00', endTime: '12:00', minStaff: 2 }, { onDate: T, startTime: '09:00', endTime: '12:00', minStaff: 5 }];
  assert.equal(E.requirementsFor(T, reqs).length, 1);
  assert.equal(E.requirementsFor(T, reqs)[0].minStaff, 5);
  assert.equal(E.requirementsFor('2026-11-24', reqs)[0].minStaff, 2);
});

test('lanes put simultaneous shifts side by side', () => {
  const list = [sh('a', 'emma', T, '09:00', '17:00'), sh('b', 'noah', T, '13:00', '21:00'), sh('c', 'ava', T, '18:00', '22:00')];
  const lanes = E.layoutLanes(list);
  assert.notEqual(lanes.get('a').lane, lanes.get('b').lane);
  assert.equal(lanes.get('a').lanes, 2);
  assert.equal(lanes.get('c').lane, 0, 'c reuses the lane a freed');
});

test('auto-hide: an assigned employee leaves that date’s list and comes back when removed', () => {
  const all = [emma, noah];
  let list = [sh('a', 'emma', T, '09:00', '17:00')];
  const free = (l) => E.staffForDate(T, all, l).filter(x => x.status === 'free').map(x => x.id);
  assert.deepEqual(free(list), ['noah']);
  assert.deepEqual(E.staffForDate('2026-11-18', all, list).filter(x => x.status === 'free').map(x => x.id), ['emma', 'noah']);
  list = list.map(a => ({ ...a, ...E.localToRange('2026-11-18', '09:00', '17:00') })); // moved to Wednesday
  assert.deepEqual(free(list), ['emma', 'noah']);
  assert.deepEqual(E.staffForDate('2026-11-18', all, list).filter(x => x.status === 'free').map(x => x.id), ['noah']);
  assert.deepEqual(free([]), ['emma', 'noah']);
  const onLeave = E.staffForDate(T, all, [], { leave: [{ employeeId: 'noah', status: 'approved', ...E.localToRange(T, '00:00', '00:00') }] });
  assert.equal(onLeave.find(x => x.id === 'noah').status, 'leave');
});

test('copy previous week keeps weekday and wall-clock times and records the source', () => {
  let n = 0;
  const src = [sh('a', 'emma', '2026-11-10', '09:00', '17:00', { breakMinutes: 30, notes: 'open' }), sh('z', 'noah', '2026-11-15', '20:00', '02:00')];
  const out = E.planCopyWeek(src, '2026-11-09', '2026-11-16', () => 'id' + ++n);
  assert.equal(E.bkkDate(out[0].startsAt), '2026-11-17');
  assert.equal(E.fmtRange(out[0]), '09:00–17:00');
  assert.equal(out[0].breakMinutes, 30);
  assert.equal(out[0].copySourceId, 'a');
  assert.equal(E.bkkDate(out[1].endsAt), '2026-11-23');
});

test('period validation: errors block, coverage/hours become acknowledgeable warnings', () => {
  const list = [sh('a', 'emma', T, '09:00', '17:00'), sh('b', 'emma', T, '13:00', '21:00'), sh('c', 'noah', T, '13:00', '21:00')];
  const v = E.validatePeriod({ assignments: list, employees, requirements: [{ startTime: '09:00', endTime: '12:00', minStaff: 2 }], weekStart: '2026-11-16' });
  assert.equal(v.errors.filter(e => e.code === 'overlap').length, 1, 'one overlap reported once, not twice');
  assert.ok(v.warnings.some(w => w.code === 'coverage'));
  assert.ok(E.warningsNeedingAck(v.warnings).length >= 1);
  assert.ok(v.shared.length >= 1);
});

test('remarks describe shared coverage neutrally and conflicts as errors', () => {
  const list = [sh('a', 'emma', T, '09:00', '17:00'), sh('b', 'noah', T, '13:00', '21:00')];
  const v = E.validatePeriod({ assignments: list, employees, requirements: [], weekStart: '2026-11-16' });
  const r = E.buildRemarks({ validation: v, employees });
  assert.deepEqual(r, [{ tone: 'info', text: 'Emma W. and Noah T. both scheduled Tue 17 Nov 13:00–17:00 (shared coverage)' }]);
});

test('colours are stable for a roster regardless of input order', () => {
  const a = E.colorMap([emma, noah]), b = E.colorMap([noah, emma]);
  assert.deepEqual(a.get('emma'), b.get('emma'));
  assert.notDeepEqual(a.get('emma'), a.get('noah'));
});

test('attendance comparison (Phase 5 prep): 09:12-17:05 vs 09:00-17:00 is 12 minutes late', () => {
  const r = E.compareAttendance(sh('a', 'emma', T, '09:00', '17:00'), { clockIn: E.iso(E.bkkMs(T, '09:12')), clockOut: E.iso(E.bkkMs(T, '17:05')) });
  assert.equal(r.lateMinutes, 12);
  assert.equal(r.earlyLeaveMinutes, 0);
  assert.equal(r.stayedLaterMinutes, 5);
  assert.equal(r.payableOvertime, null, 'never inferred');
  assert.deepEqual(E.compareAttendance(sh('a', 'emma', T, '09:00', '17:00'), {}).missing, ['clock_in', 'clock_out']);
});
