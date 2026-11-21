/* DANK Shift Maker — print layout for the PDF exports.

   A print-specific renderer: it does not screenshot the interactive
   calendar, it lays the schedule out again in millimetres for paper.
   Pure functions returning HTML strings, so tests can check the layout
   rules without a browser (tests/shift-print.test.js).

   Weekly layout (the agreed final design):
     header   — DANK Backoffice · "Shift Maker — Weekly Schedule" · Period ·
                Location · Status. No timezone (Asia/Bangkok still applies).
     left     — Weekly Schedule grid, then the Staff Colour Legend directly
                BELOW it (two columns).
     right    — Weekly Hours (10+ rows) · Coverage (by Day) · *Remarks.
   Deliberately absent: a timezone row, a Detailed Time Table, a separate
   Conflict Summary panel, and any legend in the header or right column.
   Anything that does not fit continues on extra pages; nothing is clipped. */
import * as E from './shift-engine.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mm = (n) => `${Math.round(n * 100) / 100}mm`;
const r2 = (n) => Math.round(n * 100) / 100;

export const PAPER = {
  A3: { w: 420, h: 297, pad: 10 },
  A4: { w: 297, h: 210, pad: 8 },
};
const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', professional: 'Professional', parttime: 'Part-time', kitchen: 'Kitchen' };
const roleOf = (e) => ROLE_LABEL[e?.role] || e?.role || '';

/* ---------------- shared pieces ---------------- */

function header({ title, period, location, status, extra = '' }) {
  const published = /^published/i.test(status || '');
  return `<header class="p-head">
    <div class="p-brand"><span class="p-logo" aria-hidden="true">D</span><div><b>DANK</b> Backoffice</div></div>
    <div class="p-title"><h1>${esc(title)}</h1>
      <div class="p-meta"><span><i>Period</i> ${esc(period)}</span><span><i>Location</i> ${esc(location)}</span>${extra}
        <span><i>Status</i> <em class="p-status ${published ? 'pub' : 'draft'}">${esc(status)}</em></span></div></div>
  </header>`;
}

/** Hour range for a set of dates: 07–23 by default, widened to fit every shift. */
export function hourBounds(assignments, dates, settings = E.DEFAULT_SETTINGS) {
  let lo = (settings.dayStartHour ?? 7) * 60, hi = (settings.dayEndHour ?? 23) * 60;
  for (const a of assignments) {
    const d = E.businessDate(a);
    if (!dates.includes(d)) continue;
    lo = Math.min(lo, E.minutesFrom(d, a.startsAt));
    hi = Math.max(hi, E.minutesFrom(d, a.endsAt));
  }
  return { lo: Math.max(0, Math.floor(lo / 60) * 60), hi: Math.min(30 * 60, Math.ceil(hi / 60) * 60) };
}

/** Geometry of every shift card in the weekly grid, in mm. Exported for tests. */
export function weeklyCards({ assignments, weekStart, gridH, colW, bounds }) {
  const dates = E.weekDates(weekStart);
  const perMin = gridH / (bounds.hi - bounds.lo);
  const out = [];
  dates.forEach((d, di) => {
    const day = assignments.filter((a) => E.businessDate(a) === d);
    const lanes = E.layoutLanes(day);
    for (const a of day) {
      const L = lanes.get(a.id) || { lane: 0, lanes: 1 };
      const sm = E.minutesFrom(d, a.startsAt), em = E.minutesFrom(d, a.endsAt);
      const laneW = (colW - 1.2) / L.lanes;
      out.push({ a, day: di, date: d, lane: L.lane, lanes: L.lanes,
        top: r2((sm - bounds.lo) * perMin), height: r2((em - sm) * perMin),
        left: r2(di * colW + 0.6 + L.lane * laneW), width: r2(laneW - 0.5), vertical: laneW < 13 });
    }
  });
  return out;
}

function legendHtml(employees, colors, { cols = 2 } = {}) {
  return `<section class="p-legend"><h2>Staff Colour Legend</h2>
    <div class="p-legend-grid" style="grid-template-columns:repeat(${cols},1fr)">${employees.map((e) => {
      const c = colors.get(e.id) || E.PALETTE[0];
      return `<div class="p-leg" translate="no"><i style="background:${c.bg};border-color:${c.border}"></i><b>${esc(e.name)}</b><span>${esc(roleOf(e))}</span></div>`;
    }).join('')}</div>
    <div class="p-key"><span><i class="k-shared"></i> Shared coverage — different people on at the same time (valid)</span><span><i class="k-bad"></i> Red outline — genuine conflict</span></div></section>`;
}

function hoursRow(r, colors) {
  const c = colors.get(r.employeeId) || E.PALETTE[0];
  const pct = Math.min(100, (r.minutes / (r.threshold * 60)) * 100);
  return `<div class="p-hrow ${r.over ? 'over' : ''}" translate="no"><i style="background:${c.bg};border-color:${c.border}"></i>
    <b>${esc(r.name)}</b><span class="v">${esc(E.fmtHours(r.minutes))}<small> / ${r.threshold}h</small>${r.over ? ` <em>+${esc(E.fmtHours(r.over))}</em>` : ''}</span>
    <div class="bar"><span style="width:${r2(pct)}%"></span></div></div>`;
}

function coverageCard(c) {
  if (!c.hasTargets) return `<div class="p-cov none"><b>${esc(E.fmtDateShort(c.date))}</b><span class="big">${c.peak}</span><small>peak on shift · no target set</small></div>`;
  const under = c.understaffedMinutes > 0;
  return `<div class="p-cov ${under ? 'under' : 'met'}"><b>${esc(E.fmtDateShort(c.date))}</b><span class="big">${c.metPercent}%</span>
    <small>${under ? `⚠ short ${esc(E.fmtHours(c.understaffedMinutes))} · lowest ${c.lowestDuringTargets} on` : '✓ all targets met'}</small></div>`;
}

/** Remark lines for one week — only things actually present. */
export function weeklyRemarks({ validation, employees, acknowledged = [], maxShared = 10 }) {
  const lines = E.buildRemarks({ validation, employees, acknowledged });
  const order = { error: 0, warn: 1, ack: 2, info: 3 };
  const sorted = lines.sort((a, b) => order[a.tone] - order[b.tone]);
  const info = sorted.filter((l) => l.tone === 'info');
  if (info.length <= maxShared) return sorted;
  // Shared coverage is normal on a busy rota; keep Remarks compact.
  return [...sorted.filter((l) => l.tone !== 'info'), ...info.slice(0, maxShared),
    { tone: 'info', text: `+${info.length - maxShared} more shared-coverage overlaps (all valid — different people on at the same time).` }];
}

/* ---------------- illustrative sample (never stored anywhere) ---------------- */

/** The spec's illustrative week: Emma W. Tue 09–17 and Noah T. Tue 13–21
    (shared 13:00–17:00), ten people in Hours and Legend, totals computed by
    the same engine so they always agree with the cards. */
export function sampleData(weekStart = '2026-11-16') {
  const people = [['ava', 'Ava R.', 'manager'], ['emma', 'Emma W.', 'professional'], ['noah', 'Noah T.', 'parttime'], ['olivia', 'Olivia K.', 'professional'],
    ['liam', 'Liam P.', 'parttime'], ['mason', 'Mason D.', 'professional'], ['sophia', 'Sophia L.', 'parttime'], ['ethan', 'Ethan C.', 'kitchen'],
    ['grace', 'Grace H.', 'professional'], ['lucas', 'Lucas M.', 'parttime']];
  const employees = people.map(([id, name, role]) => ({ id, name, role, active: true }));
  const plan = [
    [0, 'ava', '09:00', '17:00', 60, 'Shift lead'], [0, 'noah', '12:00', '20:00', 60, 'Budtender'], [0, 'grace', '17:00', '22:00', 0, 'Budtender'],
    [1, 'emma', '09:00', '17:00', 60, 'Budtender'], [1, 'noah', '13:00', '21:00', 60, 'Budtender'], [1, 'lucas', '21:00', '23:00', 0, 'Closing'],
    [2, 'olivia', '09:00', '17:00', 60, 'Cashier'], [2, 'liam', '12:00', '20:00', 60, 'Budtender'], [2, 'sophia', '17:00', '22:00', 0, 'Cashier'],
    [3, 'ava', '09:00', '17:00', 60, 'Shift lead'], [3, 'ethan', '11:00', '19:00', 60, 'Kitchen'], [3, 'noah', '17:00', '22:00', 0, 'Budtender'],
    [4, 'emma', '09:00', '17:00', 60, 'Budtender'], [4, 'mason', '13:00', '21:00', 60, 'Budtender'], [4, 'noah', '21:00', '02:00', 0, 'Closing'],
    [5, 'sophia', '10:00', '18:00', 60, 'Cashier'], [5, 'olivia', '13:00', '21:00', 60, 'Budtender'], [5, 'liam', '21:00', '23:00', 0, 'Closing'],
    [6, 'lucas', '10:00', '18:00', 60, 'Budtender'], [6, 'noah', '12:00', '20:00', 60, 'Budtender'],
  ];
  let n = 0;
  const assignments = plan.map(([d, employeeId, s, e, breakMinutes, role]) => ({
    id: `sample-${++n}`, employeeId, storeId: 'sample', role, breakMinutes, notes: null, ...E.localToRange(E.addDays(weekStart, d), s, e) }));
  const requirements = [
    { id: 'r1', startTime: '10:00', endTime: '13:00', minStaff: 1 },
    { id: 'r2', startTime: '13:00', endTime: '17:00', minStaff: 2 },
    { id: 'r3', startTime: '17:00', endTime: '22:00', minStaff: 1 },
  ];
  const settings = E.mergeSettings({ hourThresholds: { parttime: 30 } });
  const validation = E.validatePeriod({ assignments, employees, requirements, settings, weekStart, storeId: 'sample' });
  return { sample: true, store: { id: 'sample', name: 'DANK Pattanakarn (พัฒนาการ)' }, type: 'weekly', employees, settings, requirements,
    weeks: [{ weekStart, status: 'Draft', assignments, validation, acknowledged: [] }] };
}

function remarksHtml(lines, { title = '*Remarks', more = 0 } = {}) {
  return `<section class="p-remarks"><h2>${esc(title)}</h2>${lines.length ? `<ul>${lines.map((l) => `<li class="${l.tone}">${esc(l.text)}</li>`).join('')}</ul>` : '<p class="p-none">Nothing to note: no conflicts, shortages or exceeded thresholds.</p>'}
    ${more ? `<p class="p-more">Continued on the next page (${more} more).</p>` : ''}</section>`;
}

/* ---------------- weekly ---------------- */

/** Build the weekly schedule pages. Returns { pages: [html], model } — model is for tests. */
export function renderWeekly(data, { paper = 'A3' } = {}) {
  const P = PAPER[paper] || PAPER.A3;
  const week = data.weeks[0];
  const settings = E.mergeSettings(data.settings);
  const dates = E.weekDates(week.weekStart);
  const assignments = week.assignments.filter((a) => !a.deletedAt);
  const ids = new Set(assignments.map((a) => a.employeeId));
  // Everyone scheduled, plus active staff with no shifts, so the legend and
  // hours list show the whole team (at least 10 rows when the team has them).
  const roster = data.employees.filter((e) => ids.has(e.id) || e.active !== false);
  const colors = E.colorMap(data.employees);
  const legendPeople = roster.slice().sort((a, b) => a.name.localeCompare(b.name));
  const hours = E.weeklyHours(assignments, roster, week.weekStart, settings).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  const coverage = dates.map((d) => E.coverageForDate(d, assignments, data.requirements || [], { storeId: data.store?.id, settings }));
  const remarks = weeklyRemarks({ validation: week.validation || E.validatePeriod({ assignments, employees: data.employees, requirements: data.requirements || [], settings, weekStart: week.weekStart }), employees: data.employees, acknowledged: week.acknowledged });

  const innerW = P.w - 2 * P.pad, innerH = P.h - 2 * P.pad;
  const headH = 19, gap = 4;
  const a4 = paper === 'A4';
  const rightW = a4 ? 0 : 112;
  const leftW = innerW - (a4 ? 0 : rightW + 6);
  const legendRows = Math.ceil(legendPeople.length / 2);
  const legendFit = Math.min(legendRows, a4 ? 6 : 12);
  const legendH = 13 + legendFit * 5.6;
  const bodyH = innerH - headH - gap;
  const calTitle = 7, dayHead = 9, axisW = 12;
  const gridH = bodyH - legendH - gap - calTitle - dayHead - 3;
  const colW = (leftW - axisW - 2) / 7;
  const bounds = hourBounds(assignments, dates, settings);
  const cards = weeklyCards({ assignments, weekStart: week.weekStart, gridH, colW, bounds });
  const perMin = gridH / (bounds.hi - bounds.lo);

  const hourLines = [];
  for (let m = bounds.lo; m <= bounds.hi; m += 60)
    hourLines.push(`<div class="p-hl" style="top:${mm((m - bounds.lo) * perMin)}"><span>${String(Math.floor(m / 60) % 24).padStart(2, '0')}:00</span></div>`);
  // Shared coverage: a subtle hatched rail beside each day, spanning the
  // union of intervals where two different people overlap. Never red.
  const shared = E.findSharedCoverage(assignments);
  const rails = dates.map((d, di) => {
    const ivs = shared.filter((s) => s.date === d).map((s) => [E.minutesFrom(d, s.startsAt), E.minutesFrom(d, s.endsAt)]).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const iv of ivs) { const last = merged[merged.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push([...iv]); }
    return merged.map(([s, e]) => `<i class="p-shared" style="left:${mm((di + 1) * colW - 1.1)};top:${mm((s - bounds.lo) * perMin)};height:${mm((e - s) * perMin)}" title="Shared coverage ${String(Math.floor(s / 60) % 24).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}"></i>`).join('');
  }).join('');
  const bad = new Set((week.validation?.errors || []).flatMap((x) => x.assignmentIds || []));
  const cardHtml = cards.map((c) => {
    const col = colors.get(c.a.employeeId) || E.PALETTE[0];
    const name = data.employees.find((e) => e.id === c.a.employeeId)?.name || c.a.employeeId;
    const short = c.height < 9;
    const body = c.vertical
      ? `<span class="vt"><b>${esc(name)}</b> ${esc(E.fmtRange(c.a))}</span>`
      : `<b>${esc(name)}</b><span>${esc(E.fmtRange(c.a))}</span>${!short && c.a.role ? `<span class="rl">${esc(c.a.role)}</span>` : ''}`;
    return `<div class="p-card ${c.vertical ? 'vert' : ''} ${short ? 'short' : ''} ${bad.has(c.a.id) ? 'bad' : ''}" translate="no" data-id="${esc(c.a.id)}"
      style="left:${mm(c.left)};top:${mm(c.top)};width:${mm(c.width)};height:${mm(c.height)};background:${col.bg};border-color:${col.border};color:${col.text}">${body}</div>`;
  }).join('');
  const dayHeads = dates.map((d) => `<div class="p-dh"><b>${E.DAY_NAMES[E.weekday(d)]}</b> ${Number(d.slice(8))} ${esc(E.fmtDateShort(d).split(' ')[2])}</div>`).join('');

  const head = header({ title: 'Shift Maker — Weekly Schedule', period: E.fmtPeriod(dates[0], dates[6]), location: data.store?.name || '', status: week.status });
  const calendar = `<section class="p-cal" style="width:${mm(leftW)}"><h2>Weekly Schedule</h2>
      <div class="p-days" style="margin-left:${mm(axisW)};grid-template-columns:repeat(7,${mm(colW)})">${dayHeads}</div>
      <div class="p-gridwrap" style="height:${mm(gridH)}">
        <div class="p-axis" style="width:${mm(axisW)}">${hourLines.join('')}</div>
        <div class="p-grid" style="left:${mm(axisW)};width:${mm(colW * 7)};background-size:${mm(colW)} 100%,100% ${mm(perMin * 60)}">${rails}${cardHtml}</div>
      </div></section>`;
  const legendFirst = legendPeople.slice(0, legendFit * 2), legendRest = legendPeople.slice(legendFit * 2);
  const leftCol = `${calendar}${legendHtml(legendFirst, colors)}`;

  // Right column capacity (A3). A4 moves the whole right column to page 2.
  const hoursFit = a4 ? 22 : Math.min(hours.length, Math.max(10, Math.min(16, hours.length)));
  const covH = 4 * 13.5 + 12;
  const hoursH = 10 + hoursFit * 6.6;
  // Remarks wrap, so fit by estimated printed lines, not by item count:
  // ~1.25mm per character at 2.6mm type, 3.6mm per printed line.
  const remarkLineH = 3.6;
  const charsPerLine = Math.floor(((a4 ? (innerW - 6) / 2 : rightW) - 10) / 1.25);
  const linesOf = (l) => Math.max(1, Math.ceil(l.text.length / charsPerLine)) + 0.25;
  const remarkLines = (a4 ? innerH - headH - gap - covH - 20 : bodyH - hoursH - covH - 2 * gap - 14) / remarkLineH;
  let used = 0, remarksFit = 0;
  for (const l of remarks) { if (used + linesOf(l) > remarkLines) break; used += linesOf(l); remarksFit++; }
  if (remarksFit < remarks.length) remarksFit = Math.max(0, remarksFit - 1); // room for the "continued" note
  const hoursFirst = hours.slice(0, hoursFit), hoursRest = hours.slice(hoursFit);
  const remarksFirst = remarks.slice(0, remarksFit);
  const remarksRest = remarks.slice(remarksFirst.length);
  const hoursPanel = (rows, cont = false) => `<section class="p-hours"><h2>Weekly Hours${cont ? ' (continued)' : ''}</h2><p class="p-note">Paid hours, unpaid breaks excluded. Threshold = planning alert, not a payroll decision.</p>${rows.map((r) => hoursRow(r, colors)).join('')}</section>`;
  const covPanel = `<section class="p-covs"><h2>Coverage (by Day)</h2><p class="p-note">% of target time with enough staff on, measured continuously — not a daily headcount.</p><div class="p-covgrid">${coverage.map(coverageCard).join('')}</div></section>`;
  const right = `${hoursPanel(hoursFirst)}${covPanel}${remarksHtml(remarksFirst, { more: remarksRest.length })}`;

  const pages = [];
  if (a4) {
    pages.push(`<div class="p-page a4">${head}<div class="p-body one">${leftCol}</div></div>`);
    pages.push(`<div class="p-page a4">${header({ title: 'Shift Maker — Weekly Schedule', period: E.fmtPeriod(dates[0], dates[6]), location: data.store?.name || '', status: week.status })}<div class="p-body two">${hoursPanel(hoursFirst)}<div>${covPanel}${remarksHtml(remarksFirst, { more: remarksRest.length })}</div></div></div>`);
  } else {
    pages.push(`<div class="p-page">${head}<div class="p-body" style="grid-template-columns:${mm(leftW)} ${mm(rightW)}"><div class="p-left">${leftCol}</div><div class="p-right">${right}</div></div></div>`);
  }
  // Continuation pages for anything that did not fit — never clipped.
  let restH = hoursRest, restL = legendRest, restR = remarksRest;
  while (restH.length || restL.length || restR.length) {
    const h = restH.slice(0, 30), l = restL.slice(0, 40), r = restR.slice(0, 40);
    restH = restH.slice(h.length); restL = restL.slice(l.length); restR = restR.slice(r.length);
    pages.push(`<div class="p-page ${a4 ? 'a4' : ''}">${header({ title: 'Shift Maker — Weekly Schedule (continued)', period: E.fmtPeriod(dates[0], dates[6]), location: data.store?.name || '', status: week.status })}
      <div class="p-body two">${l.length ? legendHtml(l, colors) : '<div></div>'}<div>${h.length ? hoursPanel(h, true) : ''}${r.length ? remarksHtml(r, { title: '*Remarks (continued)', more: restR.length }) : ''}</div></div></div>`);
  }
  return { pages, model: { paper, bounds, gridH, colW, perMin, cards, hours, legend: legendPeople, colors, coverage, remarks, hoursOnFirstPage: hoursFirst.length, legendOnFirstPage: legendFirst.length } };
}

/* ---------------- monthly ---------------- */

export function renderMonthly(data, { paper = 'A3', month } = {}) {
  const P = PAPER[paper] || PAPER.A3;
  const settings = E.mergeSettings(data.settings);
  const all = data.weeks.flatMap((w) => w.assignments).filter((a) => !a.deletedAt);
  const g = E.monthGrid(month || data.weeks[0].weekStart);
  const colors = E.colorMap(data.employees);
  const ids = new Set(all.map((a) => a.employeeId));
  const roster = data.employees.filter((e) => ids.has(e.id) || e.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const inMonth = all.filter((a) => E.businessDate(a).slice(0, 7) === g.month);
  const mins = new Map(roster.map((e) => [e.id, 0]));
  for (const a of inMonth) mins.set(a.employeeId, (mins.get(a.employeeId) || 0) + E.paidMinutes(a));
  // Empty weeks say nothing about the schedule, so they don't decide the status.
  const statuses = [...new Set(data.weeks.filter((w) => w.assignments.length).map((w) => w.status))];
  if (!statuses.length) statuses.push(data.weeks[0]?.status || 'Draft');
  const rows = g.days.length / 7;
  const innerH = P.h - 2 * P.pad - 19 - 4;
  const cellH = (innerH - 8 - 34) / rows;
  const maxChips = Math.max(2, Math.floor((cellH - 5) / 3.6));
  const cells = g.days.map((d) => {
    const list = all.filter((a) => E.businessDate(a) === d).sort((x, y) => E.toMs(x.startsAt) - E.toMs(y.startsAt));
    const name = (id) => data.employees.find((e) => e.id === id)?.name || id;
    return `<div class="p-mcell ${d.slice(0, 7) !== g.month ? 'out' : ''}" style="height:${mm(cellH)}"><b>${Number(d.slice(8))}</b>
      ${list.slice(0, maxChips).map((a) => { const c = colors.get(a.employeeId) || E.PALETTE[0]; return `<span class="p-chip" translate="no" style="background:${c.bg};border-color:${c.border};color:${c.text}">${esc(E.bkkTime(a.startsAt))}–${esc(E.bkkTime(a.endsAt))} ${esc(name(a.employeeId))}</span>`; }).join('')}
      ${list.length > maxChips ? `<span class="p-more">+${list.length - maxChips} more</span>` : ''}</div>`;
  }).join('');
  const [y, m] = g.month.split('-').map(Number);
  const monthName = `${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`;
  const hoursRows = roster.map((e) => ({ employeeId: e.id, name: e.name, minutes: mins.get(e.id) || 0 })).sort((a, b) => b.minutes - a.minutes);
  const max = Math.max(1, ...hoursRows.map((r) => r.minutes));
  const remarks = data.weeks.flatMap((w) => weeklyRemarks({ validation: w.validation, employees: data.employees, acknowledged: w.acknowledged }).filter((l) => l.tone !== 'info'));
  return { pages: [`<div class="p-page ${paper === 'A4' ? 'a4' : ''}">${header({ title: 'Shift Maker — Monthly Schedule', period: monthName, location: data.store?.name || '', status: statuses.length === 1 ? statuses[0] : 'Mixed — see weeks' })}
    <div class="p-body" style="grid-template-columns:1fr ${mm(paper === 'A4' ? 70 : 100)}"><div><section class="p-cal"><h2>Monthly Schedule</h2><div class="p-month">${E.DAY_NAMES.map((d) => `<div class="p-mh">${d}</div>`).join('')}${cells}</div></section>${legendHtml(roster, colors, { cols: 4 })}</div>
    <div class="p-right"><section class="p-hours"><h2>Monthly Hours</h2><p class="p-note">Paid hours in ${esc(monthName)}, unpaid breaks excluded.</p>${hoursRows.map((r) => { const c = colors.get(r.employeeId) || E.PALETTE[0]; return `<div class="p-hrow" translate="no"><i style="background:${c.bg};border-color:${c.border}"></i><b>${esc(r.name)}</b><span class="v">${esc(E.fmtHours(r.minutes))}</span><div class="bar"><span style="width:${r2((r.minutes / max) * 100)}%"></span></div></div>`; }).join('')}</section>
    ${remarksHtml(remarks.slice(0, 18), { more: Math.max(0, remarks.length - 18) })}</div></div></div>`], model: { month: g.month, cells: g.days.length, hoursRows } };
}

/* ---------------- individual ---------------- */

export function renderIndividual(data, { paper = 'A3', employeeId, range } = {}) {
  const emp = data.employees.find((e) => e.id === employeeId) || data.employees[0];
  const settings = E.mergeSettings(data.settings);
  const list = data.weeks.flatMap((w) => w.assignments).filter((a) => !a.deletedAt && a.employeeId === emp.id)
    .filter((a) => !range || (E.businessDate(a) >= range[0] && E.businessDate(a) <= range[1]))
    .sort((x, y) => E.toMs(x.startsAt) - E.toMs(y.startsAt));
  const colors = E.colorMap(data.employees);
  const c = colors.get(emp.id) || E.PALETTE[0];
  const storeName = (id) => data.stores?.find((s) => s.id === id)?.name || data.store?.name || id;
  const weeks = [...new Set(list.map((a) => E.weekStartOf(E.businessDate(a))))];
  const weekRows = weeks.map((w) => E.weeklyHours(list, [emp], w, settings)[0]);
  const first = range?.[0] || data.weeks[0].weekStart, last = range?.[1] || E.addDays(data.weeks[data.weeks.length - 1].weekStart, 6);
  // Only this person's own conflicts and warnings. Shared-coverage lines name
  // colleagues and their hours, so they never appear on a personal schedule.
  const own = data.weeks.flatMap((w) => (w.validation ? weeklyRemarks({ validation: w.validation, employees: data.employees, acknowledged: w.acknowledged }) : []))
    .filter((l) => l.tone !== 'info' && l.text.includes(emp.name));
  const statuses = [...new Set(data.weeks.map((w) => w.status))];
  return { pages: [`<div class="p-page ${paper === 'A4' ? 'a4' : ''}">${header({ title: 'Shift Maker — Individual Schedule', period: E.fmtPeriod(first, last), location: data.store?.name || 'All locations', status: statuses.join(' / '),
      extra: `<span translate="no"><i>Staff</i> <b style="border-bottom:1.2mm solid ${c.border}">${esc(emp.name)}</b> ${esc(roleOf(emp))}</span>` })}
    <div class="p-body" style="grid-template-columns:1fr ${mm(paper === 'A4' ? 80 : 110)}"><section class="p-list"><h2>Shifts</h2>
      ${list.length ? `<table><thead><tr><th>Date</th><th>Start</th><th>End</th><th>Break</th><th>Paid</th><th>Role</th><th>Location</th><th>Notes</th></tr></thead><tbody>
      ${list.map((a) => `<tr translate="no"><td><i class="sw" style="background:${c.bg};border-color:${c.border}"></i>${esc(E.fmtDateShort(E.businessDate(a)))}</td><td>${esc(E.bkkTime(a.startsAt))}</td><td>${esc(E.bkkTime(a.endsAt))}${E.bkkDate(a.endsAt) !== E.businessDate(a) ? ' <small>(+1 day)</small>' : ''}</td>
        <td>${a.breakMinutes ? `${a.breakMinutes} min` : '—'}</td><td>${esc(E.fmtHours(E.paidMinutes(a)))}</td><td>${esc(a.role || '')}</td><td>${esc(storeName(a.storeId))}</td><td>${esc(a.notes || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="p-none">No shifts in this period.</p>'}</section>
    <div class="p-right"><section class="p-hours"><h2>Hours by Week</h2><p class="p-note">Paid hours, unpaid breaks excluded.</p>${weekRows.map((r, i) => hoursRow({ ...r, name: `Week of ${E.fmtDateShort(weeks[i])}` }, colors)).join('') || '<p class="p-none">—</p>'}</section>
    ${remarksHtml(own)}</div></div></div>`], model: { employee: emp, shifts: list } };
}

/* ---------------- styles (inlined by shift-print.html) ---------------- */

export const PRINT_CSS = `
.p-page,.p-page *{box-sizing:border-box}
.p-page{width:420mm;height:297mm;padding:10mm;background:#fff;color:#18231e;position:relative;overflow:hidden;page-break-after:always;break-after:page;
  font:400 2.9mm/1.3 Inter,"Noto Sans Thai","TH Krub",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.p-page.a4{width:297mm;height:210mm;padding:8mm;font-size:2.6mm}
.p-page:last-child{page-break-after:auto;break-after:auto}
.p-head{display:flex;align-items:center;gap:6mm;height:19mm;border-bottom:.5mm solid #007A4D;margin-bottom:4mm}
.p-brand{display:flex;align-items:center;gap:2.5mm;font-size:4mm;white-space:nowrap}
.p-brand b{color:#007A4D;letter-spacing:.06em}
.p-logo{width:10mm;height:10mm;border-radius:2.6mm;background:#007A4D;color:#fff;display:grid;place-items:center;font:800 5.5mm/1 Inter,sans-serif}
.p-title h1{margin:0;font-size:6mm;font-weight:800;letter-spacing:-.01em}
.p-meta{display:flex;flex-wrap:wrap;gap:2mm 7mm;margin-top:1.2mm;font-size:3.1mm}
.p-meta i{font-style:normal;color:#5b6b64;font-size:2.5mm;text-transform:uppercase;letter-spacing:.05em;margin-right:1mm}
.p-status{font-style:normal;font-weight:700;border-radius:9mm;padding:.4mm 2.6mm;border:.3mm solid}
.p-status.draft{color:#8a5a00;border-color:#d9a441;background:#fff6df}
.p-status.pub{color:#00603c;border-color:#5bb08a;background:#e6f5ee}
.p-body{display:grid;gap:6mm;height:calc(100% - 23mm);align-items:start}
.p-body.one{grid-template-columns:1fr}
.p-body.two{grid-template-columns:1fr 1fr}
.p-left,.p-right{display:flex;flex-direction:column;gap:4mm;min-width:0}
h2{font-size:3.6mm;margin:0 0 1.8mm;font-weight:800;color:#0e1a15}
.p-note{margin:-1mm 0 2mm;color:#5b6b64;font-size:2.3mm}
.p-cal h2{margin-bottom:1mm}
.p-days{display:grid;height:9mm;align-items:center;text-align:center;font-size:3mm;border-bottom:.3mm solid #cfd8d4}
.p-dh b{color:#007A4D}
.p-gridwrap{position:relative;margin-top:1.5mm}
.p-axis{position:absolute;left:0;top:0;bottom:0}
.p-hl{position:absolute;left:0;right:0}
.p-hl span{position:absolute;right:1.6mm;transform:translateY(-50%);font-size:2.3mm;color:#5b6b64}
.p-grid{position:absolute;top:0;bottom:0;border:.3mm solid #cfd8d4;border-radius:1.5mm;
  background-image:linear-gradient(to right,#dfe6e3 .25mm,transparent .25mm),linear-gradient(to bottom,#e7ecea .2mm,transparent .2mm)}
.p-card{position:absolute;border:.3mm solid;border-left-width:1mm;border-radius:1.6mm;padding:.6mm 1mm;overflow:hidden;font-size:2.4mm;line-height:1.2;display:flex;flex-direction:column}
.p-card b{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-card span{white-space:nowrap}
.p-card .rl{opacity:.8;overflow:hidden;text-overflow:ellipsis}
.p-card.short{flex-direction:row;gap:1mm;align-items:center}
.p-card.vert{padding:1mm .3mm;align-items:center}
.p-card .vt{writing-mode:vertical-rl;white-space:nowrap;font-size:2.2mm;overflow:hidden}
.p-card.bad{outline:.6mm solid #c0392b;outline-offset:.2mm}
.p-shared{position:absolute;width:.9mm;border-radius:.5mm;background:repeating-linear-gradient(45deg,#8a9a93 0 .45mm,#dfe6e3 .45mm .9mm);opacity:.85}
.p-legend{border-top:.3mm solid #cfd8d4;padding-top:2mm}
.p-legend-grid{display:grid;gap:1.2mm 6mm}
.p-leg{display:flex;align-items:center;gap:2mm;font-size:2.9mm;min-width:0}
.p-leg i{width:4.2mm;height:4.2mm;border-radius:1mm;border:.35mm solid;flex:none}
.p-leg b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-leg span{color:#5b6b64;font-size:2.4mm;white-space:nowrap}
.p-key{display:flex;gap:7mm;margin-top:2mm;font-size:2.3mm;color:#5b6b64}
.p-key i{display:inline-block;vertical-align:-.6mm;margin-right:1mm}
.k-shared{width:1mm;height:3.4mm;background:repeating-linear-gradient(45deg,#8a9a93 0 .45mm,#dfe6e3 .45mm .9mm)}
.k-bad{width:3.4mm;height:3.4mm;border:.6mm solid #c0392b;border-radius:.8mm}
.p-hours,.p-covs,.p-remarks,.p-list{border:.3mm solid #dfe6e3;border-radius:2.4mm;padding:3mm}
.p-hrow{display:grid;grid-template-columns:3.6mm 1fr auto;gap:0 2mm;align-items:center;margin-bottom:1.6mm;font-size:2.8mm}
.p-hrow i{width:3.4mm;height:3.4mm;border-radius:.8mm;border:.3mm solid}
.p-hrow b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.p-hrow .v{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.p-hrow .v small{font-weight:500;color:#5b6b64}
.p-hrow .v em{font-style:normal;color:#c0392b}
.p-hrow .bar{grid-column:2/4;height:1.5mm;border-radius:1mm;background:#edf1ef;overflow:hidden;margin-top:.6mm}
.p-hrow .bar span{display:block;height:100%;background:#007A4D;border-radius:1mm}
.p-hrow.over .bar span{background:#c0392b}
.p-covgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:1.6mm}
.p-cov{border:.3mm solid #dfe6e3;border-radius:1.6mm;padding:1.2mm 1.4mm;display:flex;flex-direction:column;font-size:2.3mm;min-height:12mm}
.p-cov b{font-size:2.4mm}
.p-cov .big{font-size:4.6mm;font-weight:800;line-height:1.1}
.p-cov small{color:#5b6b64}
.p-cov.met .big{color:#1f8a4c}
.p-cov.under{border-color:#e6a49b;background:#fff4f2}
.p-cov.under .big{color:#c0392b}
.p-remarks ul{margin:0;padding-left:3.5mm;font-size:2.6mm;line-height:1.35}
.p-remarks li{margin-bottom:.8mm}
.p-remarks li.error{color:#c0392b;font-weight:700}
.p-remarks li.warn{color:#7a5200}
.p-remarks li.ack{color:#5b6b64}
.p-remarks li.info{color:#18231e}
.p-none,.p-more{color:#5b6b64;font-size:2.4mm;margin:0}
.p-month{display:grid;grid-template-columns:repeat(7,1fr);border:.3mm solid #cfd8d4;border-radius:1.5mm;overflow:hidden}
.p-mh{font-size:2.5mm;font-weight:700;text-align:center;padding:1mm;border-bottom:.3mm solid #cfd8d4;color:#5b6b64}
.p-mcell{border-right:.25mm solid #e1e7e4;border-bottom:.25mm solid #e1e7e4;padding:.8mm;overflow:hidden;display:flex;flex-direction:column;gap:.5mm}
.p-mcell.out{background:#f5f7f6;color:#8a9a93}
.p-mcell b{font-size:2.8mm}
.p-chip{display:block;border:.25mm solid;border-left-width:.8mm;border-radius:.8mm;padding:0 .8mm;font-size:2.1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-list table{width:100%;border-collapse:collapse;font-size:2.8mm}
.p-list th,.p-list td{border-bottom:.25mm solid #e1e7e4;padding:1.2mm 1.4mm;text-align:left}
.p-list th{font-size:2.3mm;text-transform:uppercase;color:#5b6b64}
.p-list .sw{display:inline-block;width:2.6mm;height:2.6mm;border-radius:.6mm;border:.3mm solid;margin-right:1.2mm;vertical-align:-.3mm}
`;
