/* DANK Shift Maker — BackOffice calendar UI.

   Loaded on demand by backoffice.html (Staff → Shift Maker / Leave &
   Availability / Shift Requests) with `import('./assets/backoffice-shifts.js')`,
   the same way assets/backoffice-sales.js is. Everything renders inside the
   root element it is given and uses its own `data-sm` attribute, so it can
   never collide with backoffice.html's global `data-act` switch.

   The browser previews validation with assets/shift-engine.js so a manager
   sees a problem before saving; the server re-validates every write and the
   database has the final say on double-booking. A failed save always rolls
   the calendar back to what the server actually has. */
import * as E from './shift-engine.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLES = ['Budtender', 'Cashier', 'Kitchen', 'Bar', 'Delivery', 'Shift lead', 'Cleaner'];
const KIND_LABEL = { change: 'Change time', absence: 'Absence', swap: 'Swap' };
const LEAVE_LABEL = { annual: 'Annual', sick: 'Sick', personal: 'Personal', unpaid: 'Unpaid', other: 'Other' };
const narrow = () => matchMedia('(max-width:760px)').matches;
const hourPx = () => (narrow() ? 46 : 52);

let S = null;

/* ---------------- entry point ---------------- */

export async function mount(root, opts = {}) {
  if (!document.querySelector('link[data-sm-css]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'assets/backoffice-shifts.css'; l.dataset.smCss = '1';
    document.head.appendChild(l);
  }
  const keep = S && S.root === root ? S : null;
  S = {
    root, tab: opts.tab || 'shifts', token: opts.getToken || (() => ''), notify: opts.toast || ((m) => console.log(m)),
    heading: opts.heading || ((t) => `<h2>${esc(t)}</h2>`),
    data: keep?.data || null, store: keep?.store || null, view: keep?.view || (narrow() ? 'day' : 'week'),
    anchor: keep?.anchor || E.todayBkk(), selectedDate: keep?.selectedDate || E.todayBkk(), showAssigned: keep?.showAssigned || false,
    tpl: keep?.tpl || null, assignments: [], leave: [], availability: [], periods: [], report: null, pendingRequests: 0,
    edit: null, editDirty: false, inflight: 0, loading: true, error: null, modal: null, menu: null, drag: null, sheet: false,
  };
  root.innerHTML = `<div class="sm" id="smRoot"><p class="sm-muted">Loading Shift Maker…</p></div>`;
  bindOnce(root);
  try {
    if (!S.data) S.data = await api('GET', 'bootstrap');
    if (!S.store) {
      let saved = null; try { saved = localStorage.getItem('dankShiftStore'); } catch {}
      S.store = (S.data.stores.find((s) => s.id === saved) || S.data.stores.find((s) => s.active !== false) || S.data.stores[0])?.id || null;
    }
    S.loading = false;
    if (S.tab === 'leave') return renderLeaveTab();
    if (S.tab === 'shiftrequests') return renderRequestsTab();
    await load();
  } catch (e) {
    S.loading = false;
    S.error = e;
    el().innerHTML = `${S.heading('Shift Maker')}<div class="sm-panel sm-empty"><p class="sm-error">${esc(e.status === 503 ? 'Shift Maker is not set up on this deployment yet.' : e.message)}</p>
      <p class="sm-muted">${e.status === 503 ? 'Run supabase/migrations/0003_shift_maker.sql in Supabase and make sure SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set.' : ''}</p>
      <button class="sm-btn" data-sm="retry">Try again</button></div>`;
  }
}

const el = () => S.root.querySelector('#smRoot');
const employees = () => S.data?.employees || [];
const activeEmployees = () => employees().filter((e) => e.active !== false);
const empName = (id) => employees().find((e) => e.id === id)?.name || (id === 'backoffice' ? 'BackOffice' : id);
const storeName = (id) => S.data?.stores.find((s) => s.id === id)?.name || id;
const colors = () => (S._colors && S._colorsFor === employees() ? S._colors : (S._colorsFor = employees(), S._colors = E.colorMap(employees())));
const colorVars = (id) => { const c = colors().get(id) || E.PALETTE[0]; return `--c-bg:${c.bg};--c-border:${c.border};--c-text:${c.text}`; };
const settings = () => S.data?.settings || E.DEFAULT_SETTINGS;
const inc = () => Number(S.incOverride || settings().incrementMinutes || 30);

async function api(method, resource, body, query) {
  const qs = new URLSearchParams({ resource, ...(query || {}) });
  const r = await fetch(`/api/backoffice/shifts?${qs}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token()}`, 'X-Staff-Key': S.token() },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; e.data = j; throw e; }
  return j;
}

/* ---------------- data ---------------- */

function visibleRange() {
  if (S.view === 'day') return [S.anchor, S.anchor];
  if (S.view === 'month') { const g = E.monthGrid(S.anchor); return [g.days[0], g.days[g.days.length - 1]]; }
  const ws = E.weekStartOf(S.anchor);
  return [ws, E.addDays(ws, 6)];
}
const weekOfAnchor = () => E.weekStartOf(S.view === 'month' ? S.selectedDate : S.anchor);

async function load({ quiet = false } = {}) {
  const [from, to] = visibleRange();
  if (!quiet) { S.loading = true; render(); }
  try {
    const [range] = await Promise.all([api('GET', 'range', null, { from, to }), loadReport()]);
    S.assignments = range.assignments; S.leave = range.leave; S.availability = range.availability;
    S.periods = range.periods; S.pendingRequests = range.pendingRequests; S.error = null;
  } catch (e) { S.error = e; S.notify(e.message, true); }
  S.loading = false;
  render();
}
async function loadReport() {
  if (!S.store) return;
  try { S.report = await api('GET', 'period', null, { store: S.store, week: weekOfAnchor() }); }
  catch (e) { S.report = null; if (e.status !== 400) S.notify(e.message, true); }
}
let reportT;
function refreshReportSoon() { clearTimeout(reportT); reportT = setTimeout(async () => { await loadReport(); renderStatus(); renderCalendar(); }, 450); }

/* ---------------- render: shell ---------------- */

function render() {
  if (!S || S.tab !== 'shifts' || !S.data) return;
  const root = el();
  if (!root.querySelector('.sm-work')) {
    root.innerHTML = `${S.heading('Shift Maker')}
      <div class="sm-toolbar" id="smToolbar"></div>
      <div class="sm-status" id="smStatus" aria-live="polite"></div>
      <div class="sm-work"><div class="sm-panel sm-cal" id="smCal"></div><aside class="sm-panel sm-side" id="smSide" aria-label="Assignment panel"></aside></div>
      <div class="sm-below"><div class="sm-panel"><h3 style="margin:0 0 4px">Weekly hours</h3><p class="sm-muted" style="margin:0 0 10px">Paid scheduled hours, unpaid breaks excluded, all stores. Thresholds are planning alerts, not a payroll or legal overtime decision.</p><div class="sm-hours" id="smHours"></div></div>
        <div class="sm-panel"><h3 style="margin:0 0 4px">Coverage by day</h3><p class="sm-muted" style="margin:0 0 10px">Measured minute by minute against staffing targets — not the number of different people who worked.</p><div class="sm-covdays" id="smCov"></div></div></div>
      <button class="sm-btn primary sm-fab" data-sm="fab">+ Add shift</button>
      <div id="smModal"></div>`;
  }
  renderToolbar(); renderStatus(); renderCalendar(); renderSide(); renderBelow(); renderModal();
}

function rangeLabel() {
  if (S.view === 'day') return E.fmtDateShort(S.anchor) + ' ' + S.anchor.slice(0, 4);
  if (S.view === 'month') { const [y, m] = S.anchor.split('-').map(Number); return `${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`; }
  const ws = E.weekStartOf(S.anchor); return E.fmtPeriod(ws, E.addDays(ws, 6));
}

function renderToolbar() {
  const tb = el().querySelector('#smToolbar');
  const views = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['staff', 'Staff']];
  tb.innerHTML = `
    <button class="sm-btn" data-sm="today">Today</button>
    <span class="sm-seg"><button data-sm="prev" aria-label="Previous ${S.view}">‹</button><button data-sm="next" aria-label="Next ${S.view}">›</button></span>
    <span class="sm-range" aria-live="polite">${esc(rangeLabel())}</span>
    <span class="sm-seg" role="group" aria-label="Calendar view">${views.map(([v, l]) => `<button data-sm="view" data-v="${v}" aria-pressed="${S.view === v}">${l}</button>`).join('')}</span>
    <label class="sm-sr" for="smStore">Location</label>
    <select id="smStore" data-sm-change="store" aria-label="Location">${S.data.stores.map((s) => `<option value="${esc(s.id)}" ${s.id === S.store ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <select data-sm-change="inc" aria-label="Time increment">${[15, 30, 60].map((m) => `<option value="${m}" ${m === inc() ? 'selected' : ''}>${m} min</option>`).join('')}</select>
    <span class="sm-grow"></span>
    <button class="sm-btn" data-sm="copy-week">Copy previous week</button>
    <button class="sm-btn" data-sm="save-draft" title="Every change is saved as a draft the moment you make it">${S.inflight ? 'Saving…' : 'Save draft'}</button>
    <button class="sm-btn primary" data-sm="publish">Publish</button>
    <span class="sm-menu"><button class="sm-btn" data-sm="menu" data-menu="pdf" aria-haspopup="true" aria-expanded="${S.menu === 'pdf'}">Export PDF ▾</button>${S.menu === 'pdf' ? `<div class="sm-menu-list" role="menu">
      <button role="menuitem" data-sm="pdf" data-type="weekly" data-source="draft">Weekly schedule — current draft</button>
      <button role="menuitem" data-sm="pdf" data-type="weekly" data-source="published">Weekly schedule — as published</button>
      <button role="menuitem" data-sm="pdf" data-type="monthly" data-source="draft">Monthly schedule</button>
      <button role="menuitem" data-sm="pdf-staff">Individual staff schedule…</button></div>` : ''}</span>
    ${S.data.can?.settings ? '<button class="sm-btn icon" data-sm="settings" aria-label="Shift settings" title="Shift settings">⚙</button>' : ''}`;
}

function renderStatus() {
  const st = el().querySelector('#smStatus');
  if (!st) return;
  const r = S.report, p = r?.period;
  let pill;
  if (!p) pill = '<span class="sm-pill info">No shifts this week yet</span>';
  else if (!p.publishedNo) pill = '<span class="sm-pill draft">● Draft — not published</span>';
  else if (r.dirty) pill = `<span class="sm-pill draft">● Published v${p.publishedNo} · unpublished changes</span>`;
  else pill = `<span class="sm-pill pub">✓ Published v${p.publishedNo}</span>`;
  const v = r?.validation || { errors: [], warnings: [], shared: [] };
  st.innerHTML = `<span class="sm-muted">Week of ${esc(E.fmtDateShort(weekOfAnchor()))} · ${esc(storeName(S.store))}</span> ${pill}
    ${v.errors.length ? `<button class="sm-pill err" data-sm="publish">⛔ ${v.errors.length} blocking</button>` : ''}
    ${v.warnings.length ? `<button class="sm-pill warn" data-sm="publish">⚠ ${v.warnings.length} warning${v.warnings.length > 1 ? 's' : ''}</button>` : ''}
    ${v.shared.length ? `<span class="sm-pill info" title="Two different people on at the same time. Valid.">⇄ ${v.shared.length} shared-coverage overlap${v.shared.length > 1 ? 's' : ''}</span>` : ''}
    ${S.pendingRequests ? `<button class="sm-pill warn" data-sm="goto-requests">${S.pendingRequests} pending request${S.pendingRequests > 1 ? 's' : ''}</button>` : ''}
    <span class="sm-saving">${S.inflight ? 'Saving…' : S.loading ? 'Loading…' : 'All changes saved'}</span>`;
}

/* ---------------- issues per shift (server verdict + local preview) ---------------- */

function issueIndex() {
  const idx = new Map();
  const add = (id, sev, msg) => { if (!idx.has(id)) idx.set(id, []); idx.get(id).push({ sev, msg }); };
  for (const x of S.report?.validation?.errors || []) for (const id of x.assignmentIds || []) add(id, 'error', x.message);
  for (const x of S.report?.validation?.warnings || []) if (x.code !== 'coverage' && x.code !== 'hours') for (const id of x.assignmentIds || []) add(id, 'warning', x.message);
  // Approved leave decided after the week was loaded still flags locally.
  for (const a of S.assignments) for (const l of E.leaveHits(a, S.leave, 'approved')) add(a.id, 'error', `${empName(a.employeeId)} has approved leave at this time.`);
  return idx;
}
const sharedFor = (a, list) => E.findSharedCoverage(list).filter((s) => s.a.id === a.id || s.b.id === a.id)
  .map((s) => `${empName((s.a.id === a.id ? s.b : s.a).employeeId)} ${E.bkkTime(s.startsAt)}–${E.bkkTime(s.endsAt)}`);

/* ---------------- render: calendar ---------------- */

function storeShifts() { return S.assignments.filter((a) => a.storeId === S.store); }

function gridBounds(dates) {
  const set = settings();
  let lo = set.dayStartHour * 60, hi = set.dayEndHour * 60;
  for (const a of storeShifts()) {
    const d = E.businessDate(a);
    if (!dates.includes(d)) continue;
    lo = Math.min(lo, E.minutesFrom(d, a.startsAt)); hi = Math.max(hi, E.minutesFrom(d, a.endsAt));
  }
  return { lo: Math.max(0, Math.floor(lo / 60) * 60), hi: Math.min(30 * 60, Math.ceil(hi / 60) * 60) };
}

function renderCalendar() {
  const cal = el().querySelector('#smCal');
  if (!cal) return;
  if (S.loading && !S.assignments.length) { cal.innerHTML = '<div class="sm-empty">Loading shifts…</div>'; return; }
  if (S.view === 'month') return renderMonth(cal);
  if (S.view === 'staff') return renderStaffView(cal);
  const dates = S.view === 'day' ? [S.anchor] : E.weekDates(E.weekStartOf(S.anchor));
  const { lo, hi } = gridBounds(dates);
  S.grid = { lo, hi, dates };
  const px = hourPx(), height = ((hi - lo) / 60) * px;
  const issues = issueIndex();
  const today = E.todayBkk();
  const reqs = S.data.requirements;
  const list = storeShifts();
  // Every simultaneous shift keeps a readable lane: busy days get wider columns
  // and the calendar scrolls sideways instead of crushing cards into slivers.
  const laneCount = (d) => Math.max(1, ...[...E.layoutLanes(list.filter((a) => E.businessDate(a) === d)).values()].map((x) => x.lanes));
  const minW = (d) => Math.max(S.view === 'day' ? (narrow() ? 200 : 240) : 112, laneCount(d) * (S.view === 'day' ? (narrow() ? 64 : 110) : 34) + 12);
  const cols_t = `56px ${dates.map((d) => `minmax(${minW(d)}px,1fr)`).join(' ')}`;
  const head = dates.map((d) => {
    const c = E.coverageForDate(d, list, reqs, { storeId: S.store, settings: settings() });
    const cov = !c.hasTargets ? '<span class="cov none">no target</span>'
      : c.understaffedMinutes ? `<span class="cov under">⚠ short ${esc(E.fmtHours(c.understaffedMinutes))}</span>` : '<span class="cov met">✓ target met</span>';
    return `<button class="sm-dayhead ${d === today ? 'today' : ''} ${d === S.selectedDate ? 'sel' : ''}" data-sm="pick-date" data-date="${d}" aria-label="${esc(E.DAY_NAMES_LONG[E.weekday(d)])} ${esc(d)}">
      <span class="d">${E.DAY_NAMES[E.weekday(d)]}</span><br><span class="n">${Number(d.slice(8))}</span>${cov}</button>`;
  }).join('');
  const hours = [];
  for (let m = lo; m <= hi; m += 60) hours.push(`<span style="top:${((m - lo) / 60) * px}px">${String((m / 60) % 24).padStart(2, '0')}:00</span>`);
  const cols = dates.map((d) => {
    const day = list.filter((a) => E.businessDate(a) === d);
    const lanes = E.layoutLanes(day);
    const cov = E.coverageForDate(d, list, reqs, { storeId: S.store, settings: settings() });
    const strip = cov.segments.filter((s) => s.status !== 'none').map((s) => {
      const top = ((E.minutesFrom(d, s.start) - lo) / 60) * px, h = ((s.end - s.start) / 3600000) * px;
      const label = `${E.bkkTime(s.start)}–${E.bkkTime(s.end)}: ${s.count} on shift, target ${s.required}${s.roleShort.length ? ' · short ' + s.roleShort.map((r) => `${r.role} ${r.have}/${r.need}`).join(', ') : ''} (${s.status === 'under' ? 'understaffed' : s.status === 'met' ? 'target met' : 'above target'})`;
      return `<i class="${s.status}" style="top:${top}px;height:${h}px" title="${esc(label)}"></i>`;
    }).join('');
    const cards = day.map((a) => {
      const L = lanes.get(a.id) || { lane: 0, lanes: 1 };
      const sm = E.minutesFrom(d, a.startsAt), em = E.minutesFrom(d, a.endsAt);
      const top = ((sm - lo) / 60) * px, h = Math.max(18, ((Math.min(em, hi) - sm) / 60) * px - 2);
      const w = 100 / L.lanes;
      const compact = S.view !== 'day' && L.lanes >= 3;
      const initials = empName(a.employeeId).split(/\s+/).map((p) => [...p][0] || '').join('').slice(0, 3);
      const iss = issues.get(a.id) || [];
      const bad = iss.some((x) => x.sev === 'error'), warn = !bad && iss.length;
      const shared = sharedFor(a, day);
      const tip = [`${empName(a.employeeId)} · ${E.fmtRange(a)}${a.role ? ' · ' + a.role : ''}`, a.breakMinutes ? `Unpaid break ${a.breakMinutes} min` : '',
        a.notes ? `Note: ${a.notes}` : '', ...iss.map((x) => (x.sev === 'error' ? 'Blocking: ' : 'Warning: ') + x.msg), ...shared.map((s) => `Shared coverage with ${s}`)].filter(Boolean).join('\n');
      const flag = bad ? '<span class="flag" aria-hidden="true">⛔</span>' : warn ? '<span class="flag" aria-hidden="true">⚠</span>' : '';
      return `<button translate="no" class="sm-shift ${compact ? 'compact' : ''} ${bad ? 'bad' : ''} ${warn ? 'warn' : ''} ${a._saving ? 'saving' : ''}" data-sm="open" data-id="${a.id}" style="${colorVars(a.employeeId)};top:${top}px;height:${h}px;left:calc(${L.lane * w}% + 7px);width:calc(${w}% - 9px)"
        title="${esc(tip)}" aria-label="${esc(tip.replace(/\n/g, '. '))}">
        ${compact
          ? `<div class="nm">${flag}${esc(initials)}</div><div class="tm">${esc(E.bkkTime(a.startsAt).replace(/:00$/, ''))}<br>${esc(E.bkkTime(a.endsAt).replace(/:00$/, ''))}</div>`
          : `<div class="nm">${flag}${esc(empName(a.employeeId))}</div><div class="tm">${esc(E.fmtRange(a))}</div>${a.role && h > 44 ? `<div class="rl">${esc(a.role)}</div>` : ''}`}
        ${em > hi ? '<span class="cont">→</span>' : ''}${em - sm > 0 ? '<span class="rz" data-rz="1" aria-hidden="true"></span>' : ''}</button>`;
    }).join('');
    const now = d === today ? (() => { const m = E.minutesFrom(d, Date.now()); return m >= lo && m <= hi ? `<div class="sm-now" style="top:${((m - lo) / 60) * px}px" aria-hidden="true"></div>` : ''; })() : '';
    return `<div class="sm-col ${d === S.selectedDate ? 'sel' : ''}" data-col="${d}" style="height:${height}px" role="group" aria-label="${esc(E.DAY_NAMES_LONG[E.weekday(d)])} ${d}. Click an empty time to add a shift.">
      <div class="sm-cov" aria-hidden="true">${strip}</div>${now}${cards}</div>`;
  }).join('');
  const body = cal.querySelector('.sm-body');
  const scroll = body && body.dataset.key === `${S.view}|${S.store}|${dates[0]}` ? [body.scrollTop, body.scrollLeft] : null;
  cal.innerHTML = `<div class="sm-body" data-key="${S.view}|${esc(S.store)}|${dates[0]}"><div class="sm-grid sm-head" style="grid-template-columns:${cols_t}"><div class="sm-corner"></div>${head}</div>
    <div class="sm-grid" style="grid-template-columns:${cols_t};--sm-hour:${px}px"><div class="sm-times" style="height:${height}px">${hours.join('')}</div>${cols}</div></div>`;
  const nb = cal.querySelector('.sm-body');
  if (scroll) { nb.scrollTop = scroll[0]; nb.scrollLeft = scroll[1]; }
  else { const first = Math.min(...list.filter((a) => dates.includes(E.businessDate(a))).map((a) => E.minutesFrom(E.businessDate(a), a.startsAt)), 9 * 60); nb.scrollTop = Math.max(0, ((first - lo) / 60) * px - 20); }
}

function renderMonth(cal) {
  const g = E.monthGrid(S.anchor);
  const issues = issueIndex();
  const list = storeShifts();
  const today = E.todayBkk();
  cal.innerHTML = `<div class="sm-month">${E.DAY_NAMES.map((d) => `<div class="mh">${d}</div>`).join('')}
    ${g.days.map((d) => {
      const day = list.filter((a) => E.businessDate(a) === d).sort((x, y) => E.toMs(x.startsAt) - E.toMs(y.startsAt));
      const c = E.coverageForDate(d, list, S.data.requirements, { storeId: S.store, settings: settings() });
      const flag = c.hasTargets && c.understaffedMinutes ? `<span title="Understaffed ${esc(E.fmtHours(c.understaffedMinutes))}" style="color:var(--sm-under)">⚠ short</span>` : '';
      return `<button class="sm-mday ${d.slice(0, 7) !== g.month ? 'out' : ''}" data-sm="month-day" data-date="${d}" aria-label="${esc(d)}: ${day.length} shifts${flag ? ', understaffed' : ''}">
        <span class="n"><span ${d === today ? 'style="color:var(--brand)"' : ''}>${Number(d.slice(8))}</span>${flag}</span>
        ${day.slice(0, 4).map((a) => `<span translate="no" class="sm-chip ${(issues.get(a.id) || []).some((x) => x.sev === 'error') ? 'bad' : ''}" style="${colorVars(a.employeeId)}">${esc(E.bkkTime(a.startsAt))} ${esc(empName(a.employeeId))}</span>`).join('')}
        ${day.length > 4 ? `<span class="sm-muted">+${day.length - 4} more</span>` : ''}</button>`;
    }).join('')}</div>`;
}

function renderStaffView(cal) {
  const ws = E.weekStartOf(S.anchor), dates = E.weekDates(ws);
  const issues = issueIndex();
  const hours = new Map(E.weeklyHours(S.assignments, employees(), ws, settings()).map((r) => [r.employeeId, r]));
  const rows = activeEmployees().slice().sort((a, b) => a.name.localeCompare(b.name)).map((e) => {
    const cells = dates.map((d) => {
      const mine = S.assignments.filter((a) => a.employeeId === e.id && E.businessDate(a) === d);
      const onLeave = S.leave.some((l) => l.employeeId === e.id && l.status === 'approved' && E.overlaps(l, { startsAt: E.iso(E.bkkMs(d)), endsAt: E.iso(E.bkkMs(d) + E.DAY_MS) }));
      return `<td class="cell ${onLeave ? 'off' : ''}" data-sm="cell" data-emp="${esc(e.id)}" data-date="${d}" aria-label="${esc(e.name)} ${d}${onLeave ? ', on leave' : ''}">
        ${mine.map((a) => a.storeId === S.store
          ? `<button translate="no" class="sm-chip ${(issues.get(a.id) || []).some((x) => x.sev === 'error') ? 'bad' : ''}" data-sm="open" data-id="${a.id}" style="${colorVars(e.id)}" aria-label="${esc(e.name)} ${esc(E.fmtRange(a))}">${esc(E.fmtRange(a))}${a.role ? ' · ' + esc(a.role) : ''}</button>`
          : `<span translate="no" class="sm-chip" style="${colorVars(e.id)};opacity:.6" title="At ${esc(storeName(a.storeId))}">${esc(E.fmtRange(a))} @${esc(storeName(a.storeId))}</span>`).join('')}
        ${onLeave ? '<span class="sm-muted">On leave</span>' : ''}</td>`;
    }).join('');
    const h = hours.get(e.id);
    return `<tr><td class="who" translate="no"><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${colors().get(e.id).bg};border:1px solid ${colors().get(e.id).border}"></span> <b>${esc(e.name)}</b><br><span class="sm-muted">${esc(roleLabel(e.role))} · ${esc(E.fmtHours(h?.minutes || 0))}${h?.over ? ' ⚠' : ''}</span></td>${cells}</tr>`;
  }).join('');
  cal.innerHTML = `<div style="overflow:auto;max-height:calc(100vh - 250px)"><table class="sm-staffgrid"><thead><tr><th>Staff</th>${dates.map((d) => `<th><button class="sm-btn" style="min-height:0;padding:3px 8px;border:0" data-sm="pick-date" data-date="${d}">${esc(E.fmtDateShort(d))}</button></th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="8" class="sm-empty">No staff accounts yet — add them in the staff portal under Staff Management.</td></tr>`}</tbody></table></div>`;
}
const roleLabel = (r) => ({ owner: 'Owner', manager: 'Manager', professional: 'Professional', parttime: 'Part-time', kitchen: 'Kitchen' }[r] || r || '');

/* ---------------- render: side panel ---------------- */

function renderSide() {
  const side = el().querySelector('#smSide');
  if (!side) return;
  side.classList.toggle('open', S.sheet);
  const d = S.selectedDate;
  const list = E.staffForDate(d, employees(), S.assignments, { leave: S.leave, availability: S.availability, settings: settings() });
  const free = list.filter((x) => x.status === 'free'), shown = S.showAssigned ? list : free;
  const counts = { assigned: list.filter((x) => x.status === 'assigned').length, leave: list.filter((x) => x.status === 'leave').length };
  side.innerHTML = `${narrow() ? '<div style="display:flex;justify-content:flex-end"><button class="sm-btn" data-sm="sheet-close">Close</button></div>' : ''}
    ${S.edit ? `<section id="smEditor">${editorHtml()}</section>` : ''}
    <section><h3>${esc(E.DAY_NAMES_LONG[E.weekday(d)])}, ${esc(E.fmtDateShort(d).slice(4))} ${d.slice(0, 4)}</h3>
      <div class="sm-muted" style="margin-bottom:8px">Pick a template, then drag a person onto the calendar — or tap a person to fill in the form.</div>
      <div class="sm-tpls" role="group" aria-label="Shift templates">${S.data.templates.filter((t) => !t.storeId || t.storeId === S.store).map((t) => `<button class="sm-tpl" data-sm="tpl" data-id="${t.id}" aria-pressed="${S.tpl === t.id}" title="${esc(`${t.startTime}–${t.endTime}${t.breakMinutes ? `, ${t.breakMinutes} min break` : ''}${t.role ? ', ' + t.role : ''}`)}">${esc(t.name)} <span class="sm-muted">${esc(t.startTime)}–${esc(t.endTime)}</span></button>`).join('') || '<span class="sm-muted">No templates yet.' + (S.data.can?.settings ? ' Add them in ⚙ Shift settings.' : '') + '</span>'}</div></section>
    <section><h3>Available staff <span class="sm-muted">(${free.length} free${counts.assigned ? ` · ${counts.assigned} assigned` : ''}${counts.leave ? ` · ${counts.leave} on leave` : ''})</span></h3>
      <label class="sm-toggle"><input type="checkbox" data-sm-change="show-assigned" ${S.showAssigned ? 'checked' : ''}> Show assigned staff</label>
      <div role="list">${shown.map((x) => {
        const c = colors().get(x.id) || E.PALETTE[0];
        const tag = x.status === 'assigned' ? `<span class="tag">${esc(x.shifts.map((a) => E.fmtRange(a) + (a.storeId !== S.store ? ' @' + storeName(a.storeId) : '')).join(', '))}</span>`
          : x.status === 'leave' ? '<span class="tag leave">On leave</span>' : x.status === 'unavailable' ? '<span class="tag leave">Unavailable</span>'
          : x.partlyUnavailable ? '<span class="tag warn" title="Marked unavailable for part of this day">Part unavailable</span>' : '';
        const canDrag = x.status === 'free' || (x.status === 'assigned' && settings().splitShifts?.allowed);
        return `<button role="listitem" class="sm-staff ${x.status !== 'free' ? 'assigned' : ''}" data-sm="pick-staff" data-emp="${esc(x.id)}" ${canDrag ? 'draggable="true"' : ''}
          aria-label="${esc(x.name)}, ${esc(roleLabel(x.role))}, ${esc(x.status)}. Activate to add a shift.">
          <span class="sw" style="background:${c.bg};border-color:${c.border}"></span><span class="who" translate="no"><b>${esc(x.name)}</b><small>${esc(roleLabel(x.role))}</small></span>${tag}</button>`;
      }).join('') || `<p class="sm-muted">${list.length ? 'Everyone is already scheduled on this date. Tick "Show assigned staff" to see them.' : 'No staff accounts yet — create them in the staff portal (Staff Management).'}</p>`}</div></section>`;
  if (S.edit) renderEditorIssues();
}

function editorHtml() {
  const f = S.edit, set = settings();
  const opts = E.staffForDate(f.date, employees(), S.assignments.filter((a) => a.id !== f.id), { leave: S.leave, availability: S.availability, settings: set });
  const step = inc() * 60;
  return `<h3>${f.id ? 'Edit shift' : 'New shift'}</h3>
  <form class="sm-form" data-sm-form="shift" autocomplete="off">
    <label>Employee<select name="employeeId" required><option value="">Choose…</option>${opts.map((x) => `<option value="${esc(x.id)}" ${x.id === f.employeeId ? 'selected' : ''}>${esc(x.name)}${x.status === 'assigned' ? ' — already scheduled' : x.status === 'leave' ? ' — on leave' : x.partlyUnavailable ? ' — part unavailable' : ''}</option>`).join('')}</select></label>
    <label>Template<select name="templateId"><option value="">Custom</option>${S.data.templates.map((t) => `<option value="${t.id}" ${t.id === f.templateId ? 'selected' : ''}>${esc(t.name)} (${t.startTime}–${t.endTime})</option>`).join('')}</select></label>
    <div class="row3"><label>Date<input type="date" name="date" value="${esc(f.date)}" required></label>
      <label>Start<input type="time" name="start" step="${step}" value="${esc(f.start)}" required></label>
      <label>End<input type="time" name="end" step="${step}" value="${esc(f.end)}" required></label></div>
    <div class="row2"><label>Role<input name="role" list="smRoles" maxlength="40" value="${esc(f.role || '')}" placeholder="e.g. Budtender"></label>
      <label>Unpaid break (min)<input type="number" name="breakMinutes" min="0" max="600" step="5" value="${esc(f.breakMinutes || 0)}"></label></div>
    <datalist id="smRoles">${[...new Set([...ROLES, ...S.data.templates.map((t) => t.role).filter(Boolean)])].map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
    <label>Notes<textarea name="notes" rows="2" maxlength="500">${esc(f.notes || '')}</textarea></label>
    ${set.splitShifts?.allowed ? `<label class="check"><input type="checkbox" name="splitOverride" ${f.splitOverride ? 'checked' : ''}> Allow split shift (second shift this day, at least ${set.splitShifts.minRestMinutes} min rest)</label>` : ''}
    <div class="sm-muted" id="smDur"></div>
    <ul class="sm-issues" id="smEditorIssues" aria-live="polite"></ul>
    <div class="actions"><button class="sm-btn primary" type="submit">${f.id ? 'Save changes' : 'Add shift'}</button>
      ${f.id ? '<button class="sm-btn" type="button" data-sm="dup">Duplicate</button><button class="sm-btn danger" type="button" data-sm="del">Delete</button>' : ''}
      <button class="sm-btn" type="button" data-sm="cancel-edit">Cancel</button></div>
  </form>`;
}

function editorProposal() {
  const f = S.edit;
  if (!E.isDateStr(f.date) || !E.isTimeStr(f.start) || !E.isTimeStr(f.end)) return null;
  return { id: f.id || 'new', employeeId: f.employeeId, storeId: S.store, ...E.localToRange(f.date, f.start, f.end), role: f.role || null,
    breakMinutes: Number(f.breakMinutes) || 0, notes: f.notes || null, templateId: f.templateId || null, splitOverride: Boolean(f.splitOverride) };
}
const localCheck = (p) => E.validateAssignment(p, { assignments: S.assignments, leave: S.leave, availability: S.availability, employees: employees(), settings: settings() });

function renderEditorIssues() {
  const ul = el().querySelector('#smEditorIssues'), dur = el().querySelector('#smDur');
  if (!ul) return;
  const p = editorProposal();
  if (!p) { ul.innerHTML = ''; dur.textContent = ''; return; }
  const v = p.employeeId ? localCheck(p) : { errors: [], warnings: [] };
  const mins = E.durationMinutes(p);
  dur.textContent = mins > 0 ? `${E.fmtHours(mins)} long · ${E.fmtHours(E.paidMinutes(p))} paid${E.bkkDate(p.endsAt) !== E.bkkDate(p.startsAt) ? ' · ends next day' : ''}` : '';
  const shared = p.employeeId ? E.findSharedCoverage([...storeShifts().filter((a) => a.id !== p.id), p]).filter((s) => s.a.id === p.id || s.b.id === p.id) : [];
  ul.innerHTML = [...v.errors.map((x) => `<li class="error">${esc(x.message)}</li>`), ...v.warnings.map((x) => `<li class="warning">${esc(x.message)}</li>`),
    ...shared.map((s) => `<li class="info">With ${esc(empName((s.a.id === p.id ? s.b : s.a).employeeId))} ${esc(E.bkkTime(s.startsAt))}–${esc(E.bkkTime(s.endsAt))} — fine, different people.</li>`)].join('');
}

/* ---------------- render: weekly hours + coverage ---------------- */

function renderBelow() {
  const hoursEl = el().querySelector('#smHours'), covEl = el().querySelector('#smCov');
  if (!hoursEl) return;
  const ws = weekOfAnchor();
  const rows = E.weeklyHours(S.assignments, activeEmployees(), ws, settings()).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  hoursEl.innerHTML = rows.map((r) => {
    const c = colors().get(r.employeeId) || E.PALETTE[0];
    const pct = Math.min(100, Math.round((r.minutes / (r.threshold * 60)) * 100));
    return `<div><div class="sm-hrow"><span class="sw" style="background:${c.bg};border-color:${c.border}"></span>
      <span class="nm" translate="no">${esc(r.name)} <small>${r.days} day${r.days === 1 ? '' : 's'} · ${esc(roleLabel(r.role))}</small></span>
      <span class="v ${r.over ? 'over' : ''}">${esc(E.fmtHours(r.minutes))} / ${r.threshold}h${r.over ? ` <span class="sm-sr">over threshold by</span> ⚠+${esc(E.fmtHours(r.over))}` : ''}</span></div>
      <div class="sm-hrow"><span></span><div class="sm-bar ${r.over ? 'over' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${r.threshold * 60}" aria-valuenow="${r.minutes}" aria-label="${esc(r.name)} weekly hours"><i style="width:${pct}%"></i></div></div></div>`;
  }).join('') || '<p class="sm-muted">No staff yet.</p>';
  covEl.innerHTML = E.weekDates(ws).map((d) => {
    const c = E.coverageForDate(d, storeShifts(), S.data.requirements, { storeId: S.store, settings: settings() });
    const cls = !c.hasTargets ? '' : c.understaffedMinutes ? 'under' : 'met';
    return `<div class="sm-covday ${cls}"><b>${esc(E.fmtDateShort(d))}</b>
      ${c.hasTargets ? `<span class="big">${c.metPercent}%</span> <span class="sm-muted">of target time covered</span><br>
        ${c.understaffedMinutes ? `⚠ Short ${esc(E.fmtHours(c.understaffedMinutes))} · lowest ${c.lowestDuringTargets} on shift` : '✓ Every target window met'}`
        : `<span class="sm-muted">No staffing target · peak ${c.peak} on shift</span>`}
      <br><span class="sm-muted">${c.uniqueStaff} people scheduled</span></div>`;
  }).join('');
}

/* ---------------- render: modals ---------------- */

function renderModal() {
  const box = el()?.querySelector('#smModal') || S.root.querySelector('#smModal');
  if (!box) return;
  if (!S.modal) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="sm-modal" data-sm="modal-bg"><div class="sm-dialog" role="dialog" aria-modal="true" aria-labelledby="smModalTitle">${S.modal.html()}</div></div>`;
  box.querySelector('.sm-dialog [autofocus], .sm-dialog button, .sm-dialog input')?.focus();
}
function openModal(html, extra = {}) { S.modal = { html, ...extra }; renderModal(); }
function closeModal() { S.modal = null; renderModal(); }

function publishModal() {
  const r = S.report;
  if (!r?.period) return openModal(() => `<h2 id="smModalTitle">Publish week</h2><p>There are no shifts in this week yet.</p><div class="foot"><button class="sm-btn" data-sm="close">Close</button></div>`);
  S.ack = new Set(S.ack || []);
  const v = r.validation, needs = new Set(v.needsAck);
  openModal(() => {
    const allAck = v.needsAck.every((k) => S.ack.has(k));
    return `<h2 id="smModalTitle">Publish ${esc(storeName(S.store))} · week of ${esc(E.fmtDateShort(weekOfAnchor()))}</h2>
    <p class="sm-muted">Staff see a week only once it is published. ${r.period.publishedNo ? `Currently published: v${r.period.publishedNo}.` : 'Never published.'} ${r.dirty ? 'There are changes since the last publication.' : r.period.publishedNo ? 'Nothing has changed since the last publication.' : ''}</p>
    ${v.errors.length ? `<h3>Must fix before publishing (${v.errors.length})</h3><ul class="sm-issues">${v.errors.map((x) => `<li class="error">${esc(x.message)}</li>`).join('')}</ul>` : '<p><b style="color:var(--sm-met)">✓ No blocking problems.</b> No one is double-booked or scheduled on approved leave.</p>'}
    ${v.warnings.length ? `<h3 style="margin-top:14px">Warnings (${v.warnings.length})</h3>
      ${v.needsAck.length > 1 ? `<label class="sm-toggle" style="color:var(--text);font-weight:600"><input type="checkbox" data-sm-change="ack-all" ${allAck ? 'checked' : ''}> I have reviewed all ${v.needsAck.length} warnings and want to publish anyway (each is logged with this publication)</label>` : ''}
      <ul class="sm-issues">${v.warnings.map((x) => `<li class="warning">${needs.has(x.key) ? `<label><input type="checkbox" data-sm-change="ack" data-key="${esc(x.key)}" ${S.ack.has(x.key) ? 'checked' : ''}> <span>${esc(x.message)} <b>— tick to acknowledge</b></span></label>` : esc(x.message)}</li>`).join('')}</ul>` : ''}
    ${v.shared.length ? `<h3 style="margin-top:14px">Shared coverage (valid, for information)</h3><ul class="sm-issues">${dedupeShared(v.shared).map((t) => `<li class="info">${esc(t)}</li>`).join('')}</ul>` : ''}
    ${r.history?.length ? `<details style="margin-top:14px"><summary>Publication history</summary><table class="sm-table"><tr><th>Version</th><th>When</th><th>By</th><th>Acknowledged</th></tr>${r.history.map((h) => `<tr><td>v${h.no}</td><td>${esc(new Date(h.publishedAt).toLocaleString('en-GB', { timeZone: E.ZONE }))}</td><td>${esc(empName(h.publishedBy))}</td><td>${(h.acknowledged || []).length}</td></tr>`).join('')}</table></details>` : ''}
    <div class="foot"><button class="sm-btn" data-sm="close">Cancel</button><button class="sm-btn primary" data-sm="do-publish" ${v.errors.length || !allAck || (!r.dirty && r.period.publishedNo) ? 'disabled' : ''}>${r.period.publishedNo ? 'Republish' : 'Publish'}</button></div>`;
  });
}
function dedupeShared(shared) {
  const seen = new Map();
  for (const s of shared) {
    const ids = [s.a.employeeId, s.b.employeeId].sort();
    const k = `${s.date}|${ids}|${E.bkkTime(s.startsAt)}`;
    if (!seen.has(k)) seen.set(k, `${empName(ids[0])} and ${empName(ids[1])} both scheduled ${E.fmtDateShort(s.date)} ${E.bkkTime(s.startsAt)}–${E.bkkTime(s.endsAt)} (shared coverage)`);
  }
  return [...seen.values()];
}

async function copyWeekModal(fromWeek) {
  const toWeek = weekOfAnchor();
  fromWeek = fromWeek || E.addDays(toWeek, -7);
  openModal(() => `<h2 id="smModalTitle">Copy previous week</h2><p class="sm-muted">Checking…</p>`);
  let res;
  try { res = await api('POST', 'copy-week', { storeId: S.store, fromWeek, toWeek }); }
  catch (e) { return openModal(() => `<h2 id="smModalTitle">Copy previous week</h2><p class="sm-error">${esc(e.message)}</p><div class="foot"><button class="sm-btn" data-sm="close">Close</button></div>`); }
  S.copy = { fromWeek, toWeek, proposals: res.proposals, coverage: res.coverage, hours: res.hours, pick: new Set(res.proposals.filter((p) => !p.skip && !p.errors.length).map((p) => p.copySourceId)) };
  renderCopyModal();
}
function renderCopyModal() {
  const c = S.copy;
  openModal(() => `<h2 id="smModalTitle">Copy ${esc(E.fmtDateShort(c.fromWeek))} week → ${esc(E.fmtDateShort(c.toWeek))} week</h2>
    <p class="sm-muted">Copies go in as a <b>draft</b>. Nothing is published. Rows that would break a rule are unticked and cannot be copied; already-copied rows are skipped, so running this twice is safe.</p>
    <label class="sm-muted">Copy from week starting <input type="date" data-sm-change="copy-from" value="${esc(c.fromWeek)}"></label>
    ${c.proposals.length ? `<div style="overflow:auto;margin-top:10px"><table class="sm-table"><tr><th></th><th>Day</th><th>Employee</th><th>Time</th><th>Check</th></tr>
      ${c.proposals.map((p) => {
        const blocked = p.skip || p.errors.length;
        return `<tr><td><input type="checkbox" aria-label="Copy this shift" data-sm-change="copy-pick" data-src="${p.copySourceId}" ${c.pick.has(p.copySourceId) ? 'checked' : ''} ${blocked ? 'disabled' : ''}></td>
          <td>${esc(E.fmtDateShort(E.businessDate(p)))}</td><td><span class="sm-chip" style="${colorVars(p.employeeId)};display:inline-block">${esc(empName(p.employeeId))}</span></td><td>${esc(E.fmtRange(p))}${p.role ? ' · ' + esc(p.role) : ''}</td>
          <td>${p.skip ? '<span class="sm-muted">Already copied</span>' : p.errors.map((x) => `<div class="sm-error">⛔ ${esc(x.message)}</div>`).join('') + p.warnings.map((x) => `<div style="color:var(--sm-warn)">⚠ ${esc(x.message)}</div>`).join('') || '✓'}</td></tr>`;
      }).join('')}</table></div>` : '<p class="sm-empty">That week has no shifts at this location.</p>'}
    ${c.coverage.length || c.hours.length ? `<h3 style="margin-top:12px">After copying</h3><ul class="sm-issues">${[...c.coverage, ...c.hours].map((w) => `<li class="warning">${esc(w.message)}</li>`).join('')}</ul>` : ''}
    <div class="foot"><button class="sm-btn" data-sm="close">Cancel</button><button class="sm-btn primary" data-sm="do-copy" ${c.pick.size ? '' : 'disabled'}>Copy ${c.pick.size} shift${c.pick.size === 1 ? '' : 's'} as draft</button></div>`);
}

function staffPdfModal() {
  openModal(() => `<h2 id="smModalTitle">Individual staff schedule</h2>
    <form class="sm-form" data-sm-form="pdf-staff"><label>Employee<select name="employee">${activeEmployees().map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>
    <label>Period<select name="type"><option value="staff-week">This week</option><option value="staff-month">This month</option></select></label>
    <label>Source<select name="source"><option value="draft">Current draft</option><option value="published">As published</option></select></label>
    <div class="foot"><button class="sm-btn" type="button" data-sm="close">Cancel</button><button class="sm-btn primary" type="submit">Open PDF preview</button></div></form>`);
}
function openPdf(params) {
  const q = new URLSearchParams({ store: S.store, week: params.type === 'monthly' || params.type === 'staff-month' ? S.anchor : weekOfAnchor(), ...params });
  // No 'noopener': the new tab must inherit this tab's sessionStorage login
  // when "remember me" was off. It is this site's own page.
  window.open(`shift-print.html?${q}`, '_blank');
}

/* ---------------- settings (owner) ---------------- */

function settingsModal(tab = S.settingsTab || 'templates') {
  S.settingsTab = tab;
  const set = settings();
  const tabs = [['templates', 'Templates'], ['targets', 'Staffing targets'], ['rules', 'Rules & thresholds']];
  openModal(() => `<h2 id="smModalTitle">Shift settings</h2>
    <span class="sm-seg" role="tablist" style="margin:6px 0 12px">${tabs.map(([k, l]) => `<button role="tab" data-sm="settings-tab" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</span>
    ${tab === 'templates' ? `<table class="sm-table"><tr><th>Name</th><th>Time</th><th>Break</th><th>Role</th><th>Location</th><th></th></tr>
      ${S.data.templates.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.startTime)}–${esc(t.endTime)}</td><td>${t.breakMinutes} min</td><td>${esc(t.role || '—')}</td><td>${esc(t.storeId ? storeName(t.storeId) : 'All')}</td><td><button class="sm-btn danger" data-sm="tpl-del" data-id="${t.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6" class="sm-muted">No templates yet.</td></tr>'}</table>
      <form class="sm-form" data-sm-form="tpl" style="margin-top:12px"><div class="row3"><label>Name<input name="name" required maxlength="60" placeholder="Morning"></label><label>Start<input type="time" name="startTime" value="09:00" required></label><label>End<input type="time" name="endTime" value="17:00" required></label></div>
      <div class="row3"><label>Break (min)<input type="number" name="breakMinutes" value="60" min="0" max="600"></label><label>Role<input name="role" list="smRoles2" maxlength="40"></label><label>Location<select name="storeId"><option value="">All</option>${S.data.stores.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label></div>
      <datalist id="smRoles2">${ROLES.map((r) => `<option value="${r}">`).join('')}</datalist><div class="actions"><button class="sm-btn primary" type="submit">Add template</button></div></form>` : ''}
    ${tab === 'targets' ? `<p class="sm-muted">Minimum people on shift during a time window. A rule for a specific date replaces the weekday rules for that date.</p>
      <table class="sm-table"><tr><th>When</th><th>Time</th><th>Role</th><th>Min</th><th>Location</th><th></th></tr>
      ${S.data.requirements.map((r) => `<tr><td>${r.onDate ? esc(r.onDate) : r.weekday == null ? 'Every day' : E.DAY_NAMES_LONG[r.weekday]}</td><td>${esc(r.startTime)}–${esc(r.endTime)}</td><td>${esc(r.role || 'Any')}</td><td>${r.minStaff}</td><td>${esc(r.storeId ? storeName(r.storeId) : 'All')}</td><td><button class="sm-btn danger" data-sm="req-del" data-id="${r.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6" class="sm-muted">No targets yet — coverage shows counts only.</td></tr>'}</table>
      <form class="sm-form" data-sm-form="req" style="margin-top:12px"><div class="row3"><label>Day<select name="weekday"><option value="">Every day</option>${E.DAY_NAMES_LONG.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></label><label>Start<input type="time" name="startTime" value="09:00" required></label><label>End<input type="time" name="endTime" value="12:00" required></label></div>
      <div class="row3"><label>Minimum staff<input type="number" name="minStaff" value="2" min="0" max="100" required></label><label>Role (optional)<input name="role" maxlength="40" placeholder="Any"></label><label>Location<select name="storeId"><option value="">All</option>${S.data.stores.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label></div>
      <label>Specific date instead (optional)<input type="date" name="onDate"></label><div class="actions"><button class="sm-btn primary" type="submit">Add target</button></div></form>` : ''}
    ${tab === 'rules' ? `<form class="sm-form" data-sm-form="rules">
      <div class="row3"><label>Default increment<select name="incrementMinutes">${[15, 30, 60].map((m) => `<option ${m === set.incrementMinutes ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>Calendar starts<input type="number" name="dayStartHour" min="0" max="23" value="${set.dayStartHour}"></label><label>Calendar ends<input type="number" name="dayEndHour" min="1" max="30" value="${set.dayEndHour}"></label></div>
      <p class="sm-muted" style="margin:0">Weekly-hours alert thresholds (planning only — not a legal or payroll overtime rule):</p>
      <div class="row3">${['manager', 'professional', 'parttime', 'kitchen', 'default'].map((k) => `<label>${k === 'default' ? 'Everyone else' : roleLabel(k)} (h)<input type="number" name="thr_${k}" min="1" max="168" value="${set.hourThresholds[k] ?? set.hourThresholds.default}"></label>`).join('')}</div>
      <label>Longest allowed shift (hours)<input type="number" name="maxShiftHours" min="1" max="24" value="${set.maxShiftHours}"></label>
      <label class="check"><input type="checkbox" name="splitAllowed" ${set.splitShifts.allowed ? 'checked' : ''}> Allow split shifts (two non-overlapping shifts in one day, manager ticks per shift)</label>
      <label>Minimum rest between split shifts (min)<input type="number" name="minRest" min="0" max="720" value="${set.splitShifts.minRestMinutes}"></label>
      <label>When someone marked themselves unavailable<select name="unavailablePolicy"><option value="warn" ${set.unavailablePolicy === 'warn' ? 'selected' : ''}>Warn the manager</option><option value="block" ${set.unavailablePolicy === 'block' ? 'selected' : ''}>Block the assignment</option></select></label>
      <label>Coverage shortages at publish<select name="coverageOnPublish"><option value="acknowledge" ${set.coverageOnPublish !== 'ignore' ? 'selected' : ''}>Must be acknowledged</option><option value="ignore" ${set.coverageOnPublish === 'ignore' ? 'selected' : ''}>Show only</option></select></label>
      <label>Hours above threshold at publish<select name="hoursOnPublish"><option value="acknowledge" ${set.hoursOnPublish !== 'ignore' ? 'selected' : ''}>Must be acknowledged</option><option value="ignore" ${set.hoursOnPublish === 'ignore' ? 'selected' : ''}>Show only</option></select></label>
      <div class="actions"><button class="sm-btn primary" type="submit">Save rules</button></div></form>` : ''}
    <div class="foot"><button class="sm-btn" data-sm="close">Done</button></div>`);
}

/* ---------------- leave & availability tab ---------------- */

async function renderLeaveTab() {
  const root = el();
  root.innerHTML = `${S.heading('Leave & Availability')}<div class="sm-panel" style="padding:14px" id="smLeave"><p class="sm-muted">Loading…</p></div><div id="smModal"></div>`;
  let leave, avail;
  try { [leave, avail] = await Promise.all([api('GET', 'leave'), api('GET', 'availability')]); }
  catch (e) { root.querySelector('#smLeave').innerHTML = `<p class="sm-error">${esc(e.message)}</p>`; return; }
  const rows = leave.rows.slice().sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || E.toMs(b.startsAt) - E.toMs(a.startsAt));
  const fmt = E.fmtSpan;
  root.querySelector('#smLeave').innerHTML = `
    <h3>Leave requests</h3><p class="sm-muted">Approved leave is a hard block: nobody can be scheduled over it, and a week cannot be published while a shift sits on it. Approving leave never deletes shifts — clashes are listed for you to fix.</p>
    <div style="overflow:auto"><table class="sm-table"><tr><th>Staff</th><th>When</th><th>Type</th><th>Reason</th><th>Status</th><th></th></tr>
    ${rows.map((l) => `<tr><td>${esc(empName(l.employeeId))}</td><td>${esc(fmt(l))}</td><td>${esc(LEAVE_LABEL[l.leaveType] || l.leaveType)}</td><td>${esc(l.reason || '')}</td>
      <td><span class="sm-tag ${l.status}">${esc(l.status)}</span>${l.decidedBy ? `<br><span class="sm-muted">by ${esc(empName(l.decidedBy))}</span>` : ''}</td>
      <td>${l.status === 'pending' ? `<button class="sm-btn primary" data-sm="leave-decide" data-id="${l.id}" data-status="approved">Approve</button> <button class="sm-btn" data-sm="leave-decide" data-id="${l.id}" data-status="rejected">Reject</button>` : l.status === 'approved' ? `<button class="sm-btn" data-sm="leave-decide" data-id="${l.id}" data-status="cancelled">Cancel leave</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="sm-muted">No leave requests.</td></tr>'}</table></div>
    <details style="margin-top:10px"><summary><b>Record leave for someone</b> (e.g. they phoned in sick)</summary>
      <form class="sm-form" data-sm-form="leave" style="margin-top:10px;max-width:560px"><div class="row2"><label>Staff<select name="employeeId" required>${activeEmployees().map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>
      <label>Type<select name="leaveType">${Object.entries(LEAVE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
      <div class="row2"><label>From<input type="date" name="fromDate" required value="${E.todayBkk()}"></label><label>To (inclusive)<input type="date" name="toDate" required value="${E.todayBkk()}"></label></div>
      <label>Reason<input name="reason" maxlength="500"></label><div class="actions"><button class="sm-btn primary" type="submit">Save as approved leave</button></div></form></details>
    <h3 style="margin-top:22px">Availability from staff</h3><p class="sm-muted">Informal. "Unavailable" warns when someone is scheduled then (or blocks, if Shift settings say so). Approved leave always wins.</p>
    <div style="overflow:auto"><table class="sm-table"><tr><th>Staff</th><th>Type</th><th>When</th><th>Time</th><th>Reason</th><th></th></tr>
    ${avail.rows.map((a) => `<tr><td>${esc(empName(a.employeeId))}</td><td>${esc(a.kind)}</td><td>${a.onDate ? esc(E.fmtDateShort(a.onDate)) : 'Every ' + E.DAY_NAMES_LONG[a.weekday]}</td><td>${a.startTime ? esc(a.startTime + '–' + a.endTime) : 'All day'}</td><td>${esc(a.reason || '')}</td>
      <td>${a.reviewedAt ? `<span class="sm-muted">Seen by ${esc(empName(a.reviewedBy))}</span>` : `<button class="sm-btn" data-sm="avail-review" data-id="${a.id}">Mark reviewed</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="sm-muted">Nobody has entered availability yet. Staff add it from My Shifts in the staff portal.</td></tr>'}</table></div>`;
}

/* ---------------- shift requests tab ---------------- */

async function renderRequestsTab() {
  const root = el();
  root.innerHTML = `${S.heading('Shift Requests')}<div class="sm-panel" style="padding:14px" id="smReq"><p class="sm-muted">Loading…</p></div><div id="smModal"></div>`;
  let reqs, range;
  try {
    reqs = await api('GET', 'change-requests');
    const today = E.todayBkk();
    range = await api('GET', 'range', null, { from: E.addDays(today, -31), to: E.addDays(today, 31) });
  } catch (e) { root.querySelector('#smReq').innerHTML = `<p class="sm-error">${esc(e.message)}</p>`; return; }
  const byId = new Map(range.assignments.map((a) => [a.id, a]));
  const rows = reqs.rows.slice().sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0));
  root.querySelector('#smReq').innerHTML = `<p class="sm-muted">Staff never change a published shift themselves. Approving re-checks the change against conflicts, leave and availability; if it no longer fits, the request stays pending and you see why. Approved changes reach staff when you republish the week.</p>
    <div style="overflow:auto"><table class="sm-table"><tr><th>From</th><th>Shift</th><th>Request</th><th>Reason</th><th>Status</th><th></th></tr>
    ${rows.map((r) => { const a = byId.get(r.assignmentId);
      const what = r.kind === 'change' ? `Move to ${E.fmtDateShort(E.bkkDate(r.proposedStartsAt))} ${E.bkkTime(r.proposedStartsAt)}–${E.bkkTime(r.proposedEndsAt)}` : r.kind === 'swap' ? `Swap with ${empName(r.swapEmployeeId)}` : 'Cannot work this shift';
      return `<tr><td>${esc(empName(r.requesterId))}</td><td>${a ? esc(`${E.fmtDateShort(E.businessDate(a))} ${E.fmtRange(a)} · ${storeName(a.storeId)}`) : '<span class="sm-muted">removed / out of range</span>'}</td>
        <td><b>${esc(KIND_LABEL[r.kind])}</b><br>${esc(what)}</td><td>${esc(r.reason)}</td><td><span class="sm-tag ${r.status}">${esc(r.status)}</span>${r.decisionNote ? `<br><span class="sm-muted">${esc(r.decisionNote)}</span>` : ''}</td>
        <td>${r.status === 'pending' ? `<button class="sm-btn primary" data-sm="req-decide" data-id="${r.id}" data-status="approved">Approve</button> <button class="sm-btn" data-sm="req-decide" data-id="${r.id}" data-status="rejected">Reject</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="sm-muted">No shift requests yet.</td></tr>'}</table></div>`;
}

/* ---------------- mutations (optimistic, always rolled back on failure) ---------------- */

function busy(n) { S.inflight += n; renderStatus(); const b = el().querySelector('[data-sm="save-draft"]'); if (b) b.textContent = S.inflight ? 'Saving…' : 'Save draft'; }
function showProblems(e) {
  const list = e.data?.errors || [];
  S.notify(list.length ? list.map((x) => x.message).join(' · ') : e.message, true);
}

async function createShift(p) {
  const v = localCheck(p);
  if (v.errors.length) { S.notify(v.errors[0].message, true); return false; }
  const a = { ...p, id: crypto.randomUUID(), version: 1, _saving: true };
  S.assignments.push(a); render(); busy(1);
  try {
    const r = await api('POST', 'assignment', { ...a, _saving: undefined });
    Object.assign(a, r.assignment); delete a._saving;
    if (r.warnings?.length) S.notify('Saved. ' + r.warnings.map((w) => w.message).join(' · '));
    return true;
  } catch (e) {
    S.assignments = S.assignments.filter((x) => x !== a);
    showProblems(e);
    if (e.status === 409) load({ quiet: true });
    return false;
  } finally { busy(-1); render(); refreshReportSoon(); }
}

async function patchShift(a, patch) {
  const before = { ...a };
  const next = { ...a, ...patch };
  const v = localCheck(next);
  if (v.errors.length) { S.notify(v.errors[0].message, true); render(); return false; }
  Object.assign(a, patch, { _saving: true }); render(); busy(1);
  try {
    const r = await api('PATCH', 'assignment', { id: a.id, version: before.version, employeeId: a.employeeId, storeId: a.storeId, startsAt: a.startsAt, endsAt: a.endsAt,
      role: a.role, breakMinutes: a.breakMinutes, notes: a.notes, templateId: a.templateId, splitOverride: a.splitOverride });
    Object.assign(a, r.assignment); delete a._saving;
    if (r.warnings?.length) S.notify('Saved. ' + r.warnings.map((w) => w.message).join(' · '));
    return true;
  } catch (e) {
    for (const k of Object.keys(a)) delete a[k];
    Object.assign(a, before);
    showProblems(e);
    if (e.status === 409 || e.status === 404) load({ quiet: true });
    return false;
  } finally { busy(-1); render(); refreshReportSoon(); }
}

async function deleteShift(a) {
  const i = S.assignments.indexOf(a);
  S.assignments.splice(i, 1); render(); busy(1);
  try { await api('DELETE', 'assignment', { id: a.id, version: a.version }); S.notify(`Removed ${empName(a.employeeId)} ${E.fmtRange(a)}`); return true; }
  catch (e) { S.assignments.splice(i, 0, a); showProblems(e); if (e.status === 409 || e.status === 404) load({ quiet: true }); return false; }
  finally { busy(-1); render(); refreshReportSoon(); }
}

function defaultTimes() {
  const t = S.data.templates.find((x) => x.id === S.tpl);
  return t ? { start: t.startTime, end: t.endTime, role: t.role, breakMinutes: t.breakMinutes, templateId: t.id } : { start: '09:00', end: '17:00', role: null, breakMinutes: 0, templateId: null };
}
function openEditor(id, preset = {}) {
  if (id) {
    const a = S.assignments.find((x) => x.id === id);
    if (!a) return;
    S.edit = { id: a.id, employeeId: a.employeeId, date: E.businessDate(a), start: E.bkkTime(a.startsAt), end: E.bkkTime(a.endsAt), role: a.role, breakMinutes: a.breakMinutes, notes: a.notes, templateId: a.templateId, splitOverride: a.splitOverride };
    S.selectedDate = E.businessDate(a);
  } else {
    const d = defaultTimes();
    S.edit = { id: null, employeeId: preset.employeeId || '', date: preset.date || S.selectedDate, ...d, ...(preset.start ? { start: preset.start, end: E.bkkTime(E.bkkMs(preset.date || S.selectedDate, preset.start) + (E.durationMinutes(E.localToRange('2026-01-05', d.start, d.end)) * 60000)) } : {}), notes: '', splitOverride: false };
    S.selectedDate = S.edit.date;
  }
  S.editDirty = false; S.sheet = true;
  renderSide(); renderCalendar();
  el().querySelector('#smEditor select, #smEditor input')?.focus();
}
function closeEditor() { S.edit = null; S.editDirty = false; S.sheet = false; renderSide(); }

async function submitEditor() {
  const p = editorProposal();
  if (!p || !p.employeeId) { S.notify('Choose an employee, a date and times.', true); return; }
  const id = S.edit.id;
  const ok = id ? await patchShift(S.assignments.find((x) => x.id === id), { ...p, id }) : await createShift({ ...p, id: undefined });
  if (ok) closeEditor();
}

/* ---------------- events ---------------- */

function bindOnce(root) {
  if (root.dataset.smBound) return;
  root.dataset.smBound = '1';
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', (e) => e.target.closest?.('.sm-col,td.cell')?.classList.remove('drop'));
  root.addEventListener('drop', onDrop);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (S.modal) closeModal(); else if (S.menu) { S.menu = null; renderToolbar(); } else if (S.edit) closeEditor(); } });
  window.addEventListener('beforeunload', (e) => { if (S && (S.inflight || S.editDirty)) { e.preventDefault(); e.returnValue = ''; } });
}

function minuteAt(col, clientY, offsetMin = 0) {
  const r = col.getBoundingClientRect();
  const raw = ((clientY - r.top) / hourPx()) * 60 + S.grid.lo - offsetMin;
  return Math.max(S.grid.lo, Math.min(S.grid.hi - inc(), Math.round(raw / inc()) * inc()));
}
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function onClick(e) {
  if (S.suppressClick) { S.suppressClick = false; return; }
  const t = e.target.closest('[data-sm]');
  if (!t) {
    if (S.menu && !e.target.closest('.sm-menu')) { S.menu = null; renderToolbar(); }
    return;
  }
  const act = t.dataset.sm;
  if (act !== 'menu' && S.menu && !t.closest('.sm-menu-list')) { S.menu = null; renderToolbar(); }
  switch (act) {
    case 'retry': return mount(S.root, { tab: S.tab, getToken: S.token, toast: S.notify, heading: S.heading });
    case 'today': S.anchor = S.selectedDate = E.todayBkk(); return load();
    case 'prev': case 'next': {
      const dir = act === 'next' ? 1 : -1;
      if (S.view === 'day') S.anchor = E.addDays(S.anchor, dir);
      else if (S.view === 'month') { const [y, m] = S.anchor.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + dir, 1)); S.anchor = d.toISOString().slice(0, 10); }
      else S.anchor = E.addDays(S.anchor, 7 * dir);
      if (S.view !== 'month') S.selectedDate = S.view === 'day' ? S.anchor : E.weekStartOf(S.anchor) <= S.selectedDate && S.selectedDate <= E.addDays(E.weekStartOf(S.anchor), 6) ? S.selectedDate : E.weekStartOf(S.anchor);
      return load();
    }
    case 'view': S.view = t.dataset.v; if (S.view === 'day') S.anchor = S.selectedDate; return load();
    case 'pick-date': S.selectedDate = t.dataset.date; if (S.view === 'staff') { S.view = 'day'; S.anchor = t.dataset.date; return load(); } renderCalendar(); renderSide(); return;
    case 'month-day': S.selectedDate = S.anchor = t.dataset.date; S.view = 'day'; return load();
    case 'open': return openEditor(t.dataset.id);
    case 'cell': {
      if (e.target.closest('.sm-chip')) return;
      S.selectedDate = t.dataset.date;
      return openEditor(null, { employeeId: t.dataset.emp, date: t.dataset.date });
    }
    case 'pick-staff': return openEditor(null, { employeeId: t.dataset.emp, date: S.selectedDate });
    case 'tpl': {
      S.tpl = S.tpl === t.dataset.id ? null : t.dataset.id;
      if (S.edit && S.tpl) { const d = defaultTimes(); Object.assign(S.edit, { start: d.start, end: d.end, role: d.role, breakMinutes: d.breakMinutes, templateId: d.templateId }); S.editDirty = true; }
      return renderSide();
    }
    case 'cancel-edit': return closeEditor();
    case 'dup': S.edit = { ...S.edit, id: null, date: E.addDays(S.edit.date, 1) }; S.selectedDate = S.edit.date; renderSide(); renderCalendar(); return S.notify('Duplicated to the next day — adjust and press Add shift.');
    case 'del': {
      const a = S.assignments.find((x) => x.id === S.edit.id);
      if (a && confirm(`Delete ${empName(a.employeeId)}'s shift ${E.fmtDateShort(E.businessDate(a))} ${E.fmtRange(a)}?`)) { closeEditor(); await deleteShift(a); }
      return;
    }
    case 'fab': S.sheet = true; return openEditor(null, { date: S.selectedDate });
    case 'sheet-close': S.sheet = false; S.edit = null; return renderSide();
    case 'save-draft': await load({ quiet: true }); return S.notify(S.inflight ? 'Still saving…' : 'All changes are saved as a draft. Staff will not see them until you publish.');
    case 'publish': S.ack = new Set(); await loadReport(); renderStatus(); return publishModal();
    case 'do-publish': {
      t.disabled = true;
      try {
        const r = await api('POST', 'publish', { storeId: S.store, weekStart: weekOfAnchor(), version: S.report.period.version, acknowledge: [...S.ack] });
        closeModal(); S.notify(`Published v${r.publicationNo}. ${r.notified ? `${r.notified} staff notified.` : 'No one’s shifts changed, so nobody was notified.'}`);
      } catch (err) { showProblems(err); }
      await load({ quiet: true }); if (S.modal) publishModal(); return;
    }
    case 'copy-week': return copyWeekModal();
    case 'do-copy': {
      t.disabled = true;
      try {
        const r = await api('POST', 'copy-week', { storeId: S.store, fromWeek: S.copy.fromWeek, toWeek: S.copy.toWeek, apply: true, selected: [...S.copy.pick] });
        closeModal(); S.notify(`Copied ${r.created.length} shift(s) as draft${r.failed.length ? `, ${r.failed.length} could not be copied` : ''}${r.skipped.length ? `, ${r.skipped.length} already there` : ''}.`, r.failed.length > 0);
      } catch (err) { showProblems(err); }
      return load({ quiet: true });
    }
    case 'menu': S.menu = S.menu === t.dataset.menu ? null : t.dataset.menu; return renderToolbar();
    case 'pdf': S.menu = null; renderToolbar(); return openPdf({ type: t.dataset.type, source: t.dataset.source });
    case 'pdf-staff': S.menu = null; renderToolbar(); return staffPdfModal();
    case 'settings': return settingsModal();
    case 'settings-tab': return settingsModal(t.dataset.tab);
    case 'tpl-del': try { await api('DELETE', 'templates', { id: t.dataset.id }); S.data.templates = S.data.templates.filter((x) => x.id !== t.dataset.id); settingsModal(); renderSide(); } catch (err) { showProblems(err); } return;
    case 'req-del': try { await api('DELETE', 'requirements', { id: t.dataset.id }); S.data.requirements = S.data.requirements.filter((x) => x.id !== t.dataset.id); settingsModal(); render(); } catch (err) { showProblems(err); } return;
    case 'close': return closeModal();
    case 'modal-bg': if (e.target === t) closeModal(); return;
    case 'goto-requests': { const b = document.querySelector('[data-act="staff-tab"][data-tab="shiftrequests"]'); if (b) b.click(); return; }
    case 'leave-decide': {
      const note = t.dataset.status === 'approved' ? '' : (prompt('Note for the staff member (optional):') ?? null);
      if (note === null) return;
      try {
        const r = await api('PATCH', 'leave', { id: t.dataset.id, status: t.dataset.status, note });
        if (r.affected?.length) alert(`Leave approved. These shifts now sit on approved leave and must be reassigned or removed before the week can be (re)published:\n\n${r.affected.map((a) => `• ${E.fmtDateShort(E.businessDate(a))} ${E.fmtRange(a)} at ${storeName(a.storeId)}${a.published ? ' (published)' : ''}`).join('\n')}`);
        else S.notify(`Leave ${t.dataset.status}.`);
      } catch (err) { showProblems(err); }
      return renderLeaveTab();
    }
    case 'avail-review': try { await api('PATCH', 'availability', { id: t.dataset.id }); } catch (err) { showProblems(err); } return renderLeaveTab();
    case 'req-decide': {
      const note = t.dataset.status === 'rejected' ? prompt('Reason for rejecting (shown to the staff member):') : '';
      if (note === null) return;
      try { await api('PATCH', 'change-requests', { id: t.dataset.id, status: t.dataset.status, note }); S.notify(t.dataset.status === 'approved' ? 'Approved and applied to the draft. Republish the week so staff see it.' : 'Request rejected.'); }
      catch (err) { showProblems(err); }
      return renderRequestsTab();
    }
  }
}

function onColClick(e) {
  const col = e.target.closest('.sm-col');
  if (!col || e.target.closest('.sm-shift')) return false;
  const d = col.dataset.col;
  S.selectedDate = d;
  openEditor(null, { date: d, start: hhmm(minuteAt(col, e.clientY)) });
  return true;
}

function onChange(e) {
  const t = e.target, k = t.dataset.smChange;
  if (k === 'store') { S.store = t.value; try { localStorage.setItem('dankShiftStore', t.value); } catch {} return load(); }
  if (k === 'inc') { S.incOverride = Number(t.value); return render(); }
  if (k === 'show-assigned') { S.showAssigned = t.checked; return renderSide(); }
  if (k === 'ack') { t.checked ? S.ack.add(t.dataset.key) : S.ack.delete(t.dataset.key); return publishModal(); }
  if (k === 'ack-all') { S.ack = new Set(t.checked ? S.report.validation.needsAck : []); return publishModal(); }
  if (k === 'copy-pick') { t.checked ? S.copy.pick.add(t.dataset.src) : S.copy.pick.delete(t.dataset.src); return renderCopyModal(); }
  if (k === 'copy-from') { if (E.isDateStr(t.value)) copyWeekModal(E.weekStartOf(t.value)); return; }
  if (t.closest('[data-sm-form="shift"]')) onInput(e);
}
function onInput(e) {
  const form = e.target.closest('[data-sm-form="shift"]');
  if (!form || !S.edit) return;
  const n = e.target.name;
  if (!n) return;
  S.edit[n] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  S.editDirty = true;
  if (n === 'templateId' && e.type === 'change') {
    const tp = S.data.templates.find((x) => x.id === e.target.value);
    if (tp) { Object.assign(S.edit, { start: tp.startTime, end: tp.endTime, role: tp.role, breakMinutes: tp.breakMinutes }); renderSide(); return; }
  }
  if (n === 'date' && E.isDateStr(S.edit.date)) { S.selectedDate = S.edit.date; }
  renderEditorIssues();
}

async function onSubmit(e) {
  const form = e.target.closest('[data-sm-form]');
  if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const kind = form.dataset.smForm;
  try {
    if (kind === 'shift') return submitEditor();
    if (kind === 'pdf-staff') { closeModal(); return openPdf({ type: f.type, employee: f.employee, source: f.source }); }
    if (kind === 'tpl') { const r = await api('POST', 'templates', f); S.data.templates.push(r.row); settingsModal('templates'); renderSide(); return; }
    if (kind === 'req') { const r = await api('POST', 'requirements', { ...f, weekday: f.onDate ? null : f.weekday }); S.data.requirements.push(r.row); settingsModal('targets'); render(); return; }
    if (kind === 'rules') {
      const fd = new FormData(form);
      const thr = {}; for (const k of ['manager', 'professional', 'parttime', 'kitchen', 'default']) thr[k] = Number(fd.get('thr_' + k));
      const r = await api('PATCH', 'settings', { settings: { incrementMinutes: Number(fd.get('incrementMinutes')), dayStartHour: Number(fd.get('dayStartHour')), dayEndHour: Number(fd.get('dayEndHour')),
        maxShiftHours: Number(fd.get('maxShiftHours')), hourThresholds: thr, splitShifts: { allowed: fd.get('splitAllowed') === 'on', minRestMinutes: Number(fd.get('minRest')) },
        unavailablePolicy: fd.get('unavailablePolicy'), coverageOnPublish: fd.get('coverageOnPublish'), hoursOnPublish: fd.get('hoursOnPublish') } });
      S.data.settings = r.settings; S.incOverride = null; S.notify('Shift rules saved.'); closeModal(); render(); refreshReportSoon(); return;
    }
    if (kind === 'leave') {
      const r = await api('POST', 'leave', f);
      if (r.affected?.length) alert(`Leave recorded. These shifts clash with it and must be reassigned or removed:\n\n${r.affected.map((a) => `• ${E.fmtDateShort(E.businessDate(a))} ${E.fmtRange(a)}${a.published ? ' (published)' : ''}`).join('\n')}`);
      else S.notify('Leave recorded.');
      return renderLeaveTab();
    }
  } catch (err) { showProblems(err); }
}

/* ---- pointer drag: move and resize shift cards (week/day), move chips (staff view) ---- */

function onPointerDown(e) {
  if (e.button !== 0 || S.tab !== 'shifts') return;
  const card = e.target.closest('.sm-shift[data-id], .sm-staffgrid .sm-chip[data-id]');
  if (!card) {
    if (e.target.closest('.sm-col') && !e.target.closest('.sm-shift')) { S.colDown = { x: e.clientX, y: e.clientY }; }
    return;
  }
  const a = S.assignments.find((x) => x.id === card.dataset.id);
  if (!a) return;
  const resize = Boolean(e.target.closest('[data-rz]'));
  const col = card.closest('.sm-col');
  const grabMin = col ? ((e.clientY - card.getBoundingClientRect().top) / hourPx()) * 60 : 0;
  S.drag = { a, card, x: e.clientX, y: e.clientY, resize, started: false, grabMin, pointerId: e.pointerId };
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp, { once: true });
}
function onPointerMove(e) {
  const d = S.drag;
  if (!d) return;
  if (!d.started) { if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return; d.started = true; d.card.classList.add('dragging'); }
  e.preventDefault();
  for (const g of el().querySelectorAll('.sm-ghost')) g.remove();
  for (const c of el().querySelectorAll('.drop')) c.classList.remove('drop');
  d.proposal = null;
  if (S.view === 'staff') {
    const cell = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.matches?.('td.cell'));
    if (!cell) return;
    cell.classList.add('drop');
    const delta = Math.round((E.bkkMs(cell.dataset.date) - E.bkkMs(E.businessDate(d.a))) / E.DAY_MS) * E.DAY_MS;
    d.proposal = { employeeId: cell.dataset.emp, startsAt: E.iso(E.toMs(d.a.startsAt) + delta), endsAt: E.iso(E.toMs(d.a.endsAt) + delta) };
    return;
  }
  const col = d.resize ? d.card.closest('.sm-col') : document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.matches?.('.sm-col'));
  if (!col) return;
  const date = col.dataset.col, px = hourPx();
  let s, en;
  if (d.resize) {
    s = E.toMs(d.a.startsAt);
    const m = Math.max(E.minutesFrom(date, d.a.startsAt) + inc(), minuteAt(col, e.clientY) + inc());
    en = E.bkkMs(date) + m * 60000;
  } else {
    const m = minuteAt(col, e.clientY, d.grabMin);
    s = E.bkkMs(date) + m * 60000; en = s + (E.toMs(d.a.endsAt) - E.toMs(d.a.startsAt));
  }
  d.proposal = { startsAt: E.iso(s), endsAt: E.iso(en) };
  const top = ((E.minutesFrom(date, s) - S.grid.lo) / 60) * px, h = ((en - s) / 3600000) * px;
  const bad = localCheck({ ...d.a, ...d.proposal }).errors.length;
  col.insertAdjacentHTML('beforeend', `<div class="sm-ghost" style="top:${top}px;height:${h}px;${bad ? 'border-color:var(--sm-under);color:var(--sm-under)' : ''}">${E.bkkTime(s)}–${E.bkkTime(en)}${bad ? ' ⛔' : ''}</div>`);
}
async function onPointerUp() {
  document.removeEventListener('pointermove', onPointerMove);
  const d = S.drag; S.drag = null;
  if (!d) return;
  for (const g of el().querySelectorAll('.sm-ghost')) g.remove();
  for (const c of el().querySelectorAll('.drop')) c.classList.remove('drop');
  d.card.classList.remove('dragging');
  if (!d.started) return; // a plain click: the click handler opens the editor
  S.suppressClick = true; setTimeout(() => { S.suppressClick = false; }, 0);
  const p = d.proposal;
  if (!p) return render();
  if (p.startsAt === d.a.startsAt && p.endsAt === d.a.endsAt && (!p.employeeId || p.employeeId === d.a.employeeId)) return render();
  await patchShift(d.a, p);
}
// Column click → create at that time (registered here so it never fires after a card drag).
document.addEventListener('click', (e) => {
  if (!S || S.tab !== 'shifts' || !S.root.contains(e.target)) return;
  if (S.suppressClick) return;
  if (e.target.closest('.sm-col') && !e.target.closest('.sm-shift')) onColClick(e);
}, true);

/* ---- HTML5 drag: a staff card from the side panel onto the calendar ---- */

function onDragStart(e) {
  const card = e.target.closest?.('.sm-staff[draggable="true"]');
  if (!card) return;
  e.dataTransfer.setData('text/plain', 'sm-emp:' + card.dataset.emp);
  e.dataTransfer.effectAllowed = 'copy';
  S.dragEmp = card.dataset.emp;
}
function onDragOver(e) {
  if (!S.dragEmp) return;
  const target = e.target.closest?.('.sm-col, td.cell');
  if (!target) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  for (const c of el().querySelectorAll('.drop')) if (c !== target) c.classList.remove('drop');
  target.classList.add('drop');
}
async function onDrop(e) {
  const emp = S.dragEmp; S.dragEmp = null;
  const target = e.target.closest?.('.sm-col, td.cell');
  for (const c of el().querySelectorAll('.drop')) c.classList.remove('drop');
  if (!emp || !target) return;
  e.preventDefault();
  const t = defaultTimes();
  const date = target.dataset.col || target.dataset.date;
  let start = t.start, end = t.end;
  if (target.classList.contains('sm-col') && !S.tpl) {
    const m = minuteAt(target, e.clientY);
    start = hhmm(m); end = hhmm(m + 8 * 60);
  }
  S.selectedDate = date;
  await createShift({ employeeId: emp, storeId: S.store, ...E.localToRange(date, start, end), role: t.role, breakMinutes: t.breakMinutes, templateId: t.templateId, notes: null, splitOverride: false });
}
