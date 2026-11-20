/* PDF layout rules for Shift Maker (assets/shift-print.js). The real PDF is
   produced by the browser's print engine from this HTML; these tests pin the
   layout decisions that must hold regardless of the printer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../assets/shift-engine.js';
import { renderWeekly, renderMonthly, renderIndividual, sampleData, weeklyCards, hourBounds, PRINT_CSS } from '../assets/shift-print.js';

const S = sampleData('2026-11-16');
const W = renderWeekly(S);
const html = W.pages.join('');
const card = (name, date) => {
  const id = S.employees.find((e) => e.name === name).id;
  return W.model.cards.find((c) => c.a.employeeId === id && c.date === date);
};

test('header has period, location and status — and no timezone', () => {
  assert.match(html, /Shift Maker — Weekly Schedule/);
  assert.match(html, /16–22 Nov 2026/);
  assert.match(html, /DANK Pattanakarn \(พัฒนาการ\)/, 'Thai text survives');
  assert.match(html, />Draft</);
  assert.doesNotMatch(html, /time ?zone|Asia\/Bangkok|UTC|GMT/i);
});

test('removed sections stay removed: no Detailed Time Table, no Conflict Summary panel', () => {
  assert.doesNotMatch(html, /Detailed Time Table/i);
  assert.doesNotMatch(html, /Conflict Summary/i);
});

test('legend sits directly below the calendar in the left column, never in the header or right column', () => {
  const page = W.pages[0];
  const left = page.indexOf('class="p-left"'), cal = page.indexOf('class="p-cal"'), legend = page.indexOf('class="p-legend"'), right = page.indexOf('class="p-right"');
  assert.ok(left < cal && cal < legend && legend < right, 'order: left → calendar → legend → right column');
  assert.equal(page.split('class="p-legend"').length - 1, 1, 'exactly one legend');
  assert.ok(page.indexOf('Staff Colour Legend') > page.indexOf('</header>'));
  assert.equal(W.model.legendOnFirstPage, 10);
});

test('right column order: Weekly Hours, Coverage (by Day), *Remarks — with at least 10 hours rows', () => {
  const page = W.pages[0];
  const h = page.indexOf('Weekly Hours'), c = page.indexOf('Coverage (by Day)'), r = page.indexOf('*Remarks');
  assert.ok(page.indexOf('class="p-right"') < h && h < c && c < r);
  assert.ok(W.model.hoursOnFirstPage >= 10);
  assert.equal((page.match(/class="p-hrow/g) || []).length, 10);
  assert.equal((page.match(/class="p-cov /g) || []).length, 7, 'seven day cards');
});

test('cards are anchored exactly to their start and end on the hour scale', () => {
  const { perMin, bounds } = W.model;
  const emma = card('Emma W.', '2026-11-17');
  assert.equal(emma.top, Math.round((9 * 60 - bounds.lo) * perMin * 100) / 100);
  assert.equal(emma.height, Math.round(8 * 60 * perMin * 100) / 100, '8 hours tall');
  const noah = card('Noah T.', '2026-11-17');
  assert.equal(noah.top, Math.round((13 * 60 - bounds.lo) * perMin * 100) / 100);
  assert.notEqual(emma.lane, noah.lane, 'shared coverage drawn side by side, not stacked');
  const lucas = card('Lucas M.', '2026-11-17');
  assert.ok(Math.abs(noah.top + noah.height - lucas.top) < 0.02, 'adjacent 21:00 boundary meets exactly');
  assert.equal(lucas.lane, 0, 'adjacent shifts do not need a second lane');
});

test('overnight shifts extend the hour scale instead of being clipped', () => {
  assert.ok(W.model.bounds.hi >= 26 * 60, 'Fri 21:00–02:00 needs the scale to reach 02:00');
  const fri = card('Noah T.', '2026-11-20');
  assert.ok(fri.top + fri.height <= W.model.gridH + 0.01);
});

test('shared coverage is listed in Remarks as information, not as a red conflict', () => {
  assert.match(html, /<li class="info">Emma W\. and Noah T\. both scheduled Tue 17 Nov 13:00–17:00 \(shared coverage\)<\/li>/);
  assert.doesNotMatch(html, /<li class="error">/);
  assert.doesNotMatch(html, /p-card[^"]*\bbad\b/);
  assert.match(html, /<li class="warn">Noah T\. is scheduled 31h, 1h above the 30h planning threshold\.<\/li>/);
});

test('sample totals agree with the sample shifts', () => {
  const byName = Object.fromEntries(W.model.hours.map((r) => [r.name, r.minutes / 60]));
  assert.deepEqual(byName, { 'Noah T.': 31, 'Ava R.': 14, 'Emma W.': 14, 'Olivia K.': 14, 'Sophia L.': 12, 'Liam P.': 9, 'Lucas M.': 9, 'Ethan C.': 7, 'Mason D.': 7, 'Grace H.': 5 });
  const sum = S.weeks[0].assignments.reduce((t, a) => t + E.paidMinutes(a), 0) / 60;
  assert.equal(sum, Object.values(byName).reduce((a, b) => a + b, 0));
});

test('legend colours, hours swatches and cards use the same colour per person', () => {
  const colors = E.colorMap(S.employees);
  for (const e of S.employees) {
    const c = colors.get(e.id);
    assert.ok(html.includes(`<i style="background:${c.bg};border-color:${c.border}"></i><b>${e.name}</b>`), `legend ${e.name}`);
    const cards = W.model.cards.filter((x) => x.a.employeeId === e.id);
    for (const k of cards) assert.ok(html.includes(`data-id="${k.a.id}"\n      style="left:`) || html.includes(`data-id="${k.a.id}"`));
  }
  const emmaId = S.employees.find((e) => e.name === 'Emma W.').id;
  const m = new RegExp(`data-id="${card('Emma W.', '2026-11-17').a.id}"[^>]*background:([^;]+);`).exec(html);
  assert.equal(m[1], colors.get(emmaId).bg);
});

test('a genuine conflict is outlined red on the card and listed as an error', () => {
  const d = sampleData('2026-11-16');
  const emma = d.employees.find((e) => e.name === 'Emma W.').id;
  d.weeks[0].assignments.push({ id: 'clash', employeeId: emma, storeId: 'sample', breakMinutes: 0, ...E.localToRange('2026-11-17', '13:00', '21:00') });
  d.weeks[0].validation = E.validatePeriod({ assignments: d.weeks[0].assignments, employees: d.employees, requirements: d.requirements, settings: d.settings, weekStart: '2026-11-16' });
  const out = renderWeekly(d).pages.join('');
  assert.match(out, /p-card[^"]*\bbad\b[^"]*" translate="no" data-id="clash"/);
  assert.match(out, /<li class="error">Emma W\. is already scheduled/);
});

test('A3 is one page; A4 is a readable two-page fallback; page sizes are set in mm', () => {
  assert.equal(W.pages.length, 1);
  const a4 = renderWeekly(S, { paper: 'A4' });
  assert.equal(a4.pages.length, 2);
  assert.match(PRINT_CSS, /\.p-page\{width:420mm;height:297mm/);
  assert.match(PRINT_CSS, /\.p-page\.a4\{width:297mm;height:210mm/);
  assert.match(PRINT_CSS, /box-sizing:border-box/, 'padding must not push pages past the paper edge');
  assert.match(PRINT_CSS, /print-color-adjust:exact/, 'colours survive printing');
});

test('25 people: nothing is dropped — overflow continues on another page', () => {
  const d = sampleData('2026-11-16');
  for (let i = 0; i < 15; i++) d.employees.push({ id: 'x' + i, name: `Extra Person With A Very Long Name ${i}`, role: 'parttime', active: true });
  d.employees.push({ id: 'th', name: 'สมชาย ใจดี', role: 'parttime', active: true });
  d.weeks[0].assignments.push({ id: 'th1', employeeId: 'th', storeId: 'sample', breakMinutes: 0, role: 'Delivery', ...E.localToRange('2026-11-18', '10:00', '14:00') });
  const out = renderWeekly(d);
  assert.ok(out.pages.length >= 2);
  const all = out.pages.join('');
  for (const e of d.employees) assert.ok(all.split(e.name).length - 1 >= 2, `${e.name} appears in legend and hours`);
  assert.equal(out.model.hours.length, 26);
  assert.match(all, /Weekly Hours \(continued\)/);
});

test('monthly export renders a full month grid', () => {
  const m = renderMonthly(S, { month: '2026-11-16' });
  assert.equal(m.model.cells % 7, 0);
  assert.match(m.pages[0], /Shift Maker — Monthly Schedule/);
  assert.match(m.pages[0], /November 2026/);
  assert.doesNotMatch(m.pages[0], /time ?zone/i);
});

test('individual export contains only that person’s shifts', () => {
  const noah = S.employees.find((e) => e.name === 'Noah T.').id;
  const r = renderIndividual(S, { employeeId: noah, range: ['2026-11-16', '2026-11-22'] });
  assert.equal(r.model.shifts.length, 5);
  assert.ok(r.model.shifts.every((a) => a.employeeId === noah));
  const page = r.pages[0];
  assert.doesNotMatch(page, /Emma W\.|Ava R\.|Liam P\./, 'no colleague names leak into a personal export');
  assert.match(page, /\(\+1 day\)/, 'overnight shift marked');
});

test('weeklyCards geometry: duration maps linearly to height', () => {
  const a = [{ id: 'a', employeeId: 'e', ...E.localToRange('2026-11-16', '10:00', '12:30') }];
  const bounds = hourBounds(a, E.weekDates('2026-11-16'));
  const [c] = weeklyCards({ assignments: a, weekStart: '2026-11-16', gridH: 160, colW: 30, bounds });
  const perMin = 160 / (bounds.hi - bounds.lo);
  assert.equal(c.height, Math.round(150 * perMin * 100) / 100);
  assert.equal(c.left, 0.6);
});
