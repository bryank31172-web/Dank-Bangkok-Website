/* Auto-fill: suggestions only, never breaks a hard rule, prefers the person
   with the fewest hours, uses a template when one covers the gap. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../assets/shift-engine.js';

const WS = '2026-11-16'; // Monday
const T = '2026-11-17';  // Tuesday
const sh = (id, employeeId, date, start, end) => ({ id, employeeId, storeId: 's1', ...E.localToRange(date, start, end), breakMinutes: 0 });
const staff = [
  { id: 'ava', name: 'Ava', role: 'manager' },
  { id: 'ben', name: 'Ben', role: 'parttime' },
  { id: 'cat', name: 'Cat', role: 'parttime' },
];
// Only Tuesday has a target: 2 people 12:00-18:00.
const reqs = [{ id: 'r', weekday: 1, startTime: '12:00', endTime: '18:00', minStaff: 2, storeId: 's1' }];
const base = { storeId: 's1', weekStart: WS, requirements: reqs, employees: staff };

test('fills a gap with the least-busy free person, using the smallest covering template', () => {
  const assignments = [sh('a1', 'ava', T, '09:00', '18:00'), sh('b0', 'ben', '2026-11-16', '09:00', '17:00')];
  const templates = [{ id: 'long', name: 'Long', startTime: '09:00', endTime: '21:00' }, { id: 'mid', name: 'Mid', startTime: '11:00', endTime: '19:00', role: 'Budtender' }];
  const { proposals, unfilled } = E.planAutoFill({ ...base, assignments, templates });
  assert.equal(unfilled.length, 0);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].employeeId, 'cat', 'Cat has 0h this week, Ben already has 8h');
  assert.equal(proposals[0].templateId, 'mid');
  assert.equal(E.fmtRange(proposals[0]), '11:00–19:00');
  const after = E.coverageForDate(T, [...assignments, ...proposals], reqs, { storeId: 's1' });
  assert.equal(after.understaffedMinutes, 0);
});

test('without a covering template it proposes exactly the short window', () => {
  const { proposals } = E.planAutoFill({ ...base, assignments: [sh('a1', 'ava', T, '09:00', '18:00')] });
  assert.equal(E.fmtRange(proposals[0]), '12:00–18:00');
});

test('never double-books, never schedules on leave, never pushes past the hour limit', () => {
  const assignments = [sh('a1', 'ava', T, '09:00', '18:00'), sh('b1', 'ben', T, '06:00', '11:00')];
  const leave = [{ id: 'l', employeeId: 'cat', status: 'approved', ...E.localToRange(T, '00:00', '23:59') }];
  const settings = { ...E.DEFAULT_SETTINGS, splitShifts: { allowed: false, minRestMinutes: 60 } };
  const r = E.planAutoFill({ ...base, assignments, leave, settings });
  assert.equal(r.proposals.length, 0, 'Ben already works Tuesday and split shifts are off; Cat is on leave');
  assert.equal(r.unfilled.length, 1);
  const tight = { ...E.DEFAULT_SETTINGS, hourThresholds: { ...E.DEFAULT_SETTINGS.hourThresholds, parttime: 4 } };
  const r2 = E.planAutoFill({ ...base, assignments: [sh('a1', 'ava', T, '09:00', '18:00')], settings: tight });
  assert.equal(r2.proposals.length, 0, 'a 6h shift would take a part-timer over a 4h limit');
});

test('does nothing when every target is already met', () => {
  const assignments = [sh('a1', 'ava', T, '09:00', '18:00'), sh('b1', 'ben', T, '12:00', '20:00')];
  assert.deepEqual(E.planAutoFill({ ...base, assignments }), { proposals: [], unfilled: [] });
});
