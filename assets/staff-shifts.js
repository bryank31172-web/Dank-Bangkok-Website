/* DANK Shift Maker — "My Shifts" in the staff portal (staffportal.html).

   Mobile-first. Shows only the signed-in person's PUBLISHED shifts and their
   own hours, leave, availability and requests — the server (/api/my-shifts)
   enforces that; this page never receives anyone else's schedule. Staff
   cannot edit a published shift: they file a request a manager decides. */
import * as E from './shift-engine.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEAVE = { annual: 'Annual', sick: 'Sick', personal: 'Personal', unpaid: 'Unpaid', other: 'Other' };
const KIND = { change: 'Change time', absence: 'Can’t work it', swap: 'Swap with someone' };
let M = null;

const CSS = `
.ms{display:grid;gap:14px;color:var(--txt,#14231c)}
.ms *{box-sizing:border-box}
.ms-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
.ms-tabs button{border:1px solid var(--line2,#e4e8ee);background:var(--panel,#fff);color:var(--muted,#5b6b64);border-radius:999px;padding:8px 14px;font:600 13px/1 inherit;white-space:nowrap;min-height:38px}
.ms-tabs button[aria-pressed="true"]{background:#007A4D;border-color:#007A4D;color:#fff}
.ms-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.ms-card{background:var(--panel,#fff);border:1px solid var(--line,#edf0f3);border-radius:14px;padding:14px}
.ms-card h4{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#5b6b64)}
.ms-card .big{font-size:20px;font-weight:800;line-height:1.15}
.ms-card .sub{color:var(--muted,#5b6b64);font-size:13px;margin-top:3px}
.ms-bar{height:8px;border-radius:9px;background:var(--line,#edf0f3);margin-top:8px;overflow:hidden}
.ms-bar i{display:block;height:100%;background:#007A4D;border-radius:9px}
.ms-bar.over i{background:var(--danger,#c0392b)}
.ms-sec{background:var(--panel,#fff);border:1px solid var(--line,#edf0f3);border-radius:14px;padding:14px}
.ms-sec h3{margin:0 0 10px;font-size:15px}
.ms-shift{display:grid;grid-template-columns:62px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line,#edf0f3)}
.ms-shift:first-of-type{border-top:0}
.ms-date{text-align:center;border-radius:10px;background:var(--panel2,#f8fafc);padding:6px 0}
.ms-date b{display:block;font-size:20px;line-height:1}
.ms-date span{font-size:11px;color:var(--muted,#5b6b64);text-transform:uppercase}
.ms-date.today{background:#007A4D;color:#fff}.ms-date.today span{color:#e6f5ee}
.ms-shift .t{font-weight:700;font-size:15px}
.ms-shift .m{color:var(--muted,#5b6b64);font-size:12.5px}
.ms-btn{border:1px solid var(--line2,#e4e8ee);background:var(--panel,#fff);color:var(--txt,#14231c);border-radius:10px;padding:8px 12px;font:600 13px/1.2 inherit;min-height:38px}
.ms-btn.primary{background:#007A4D;border-color:#007A4D;color:#fff}
.ms-btn.danger{color:var(--danger,#c0392b)}
.ms-form{display:grid;gap:10px;margin-top:10px;padding:12px;border-radius:12px;background:var(--panel2,#f8fafc)}
.ms-form label{display:grid;gap:4px;font-size:12.5px;font-weight:600;color:var(--muted,#5b6b64)}
.ms-form input,.ms-form select,.ms-form textarea{font:inherit;font-size:14px;padding:9px 10px;border:1px solid var(--line2,#e4e8ee);border-radius:10px;background:var(--panel,#fff);color:var(--txt,#14231c);min-height:40px;width:100%}
.ms-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ms-row3{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:8px}
.ms-acts{display:flex;gap:8px;flex-wrap:wrap}
.ms-tag{display:inline-block;font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 9px;border:1px solid var(--line2,#e4e8ee)}
.ms-tag.pending{color:#9a6400}.ms-tag.approved{color:#00804f}.ms-tag.rejected,.ms-tag.cancelled{color:var(--muted,#5b6b64)}
.ms-list{list-style:none;margin:0;padding:0}
.ms-list li{padding:10px 0;border-top:1px solid var(--line,#edf0f3);display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.ms-list li:first-child{border-top:0}
.ms-list li.unread{font-weight:700}
.ms-muted{color:var(--muted,#5b6b64);font-size:13px}
.ms-err{color:var(--danger,#c0392b);font-weight:600}
.ms-month{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;font-size:12px}
.ms-month .h{color:var(--muted,#5b6b64);font-weight:700}
.ms-month .d{border-radius:10px;padding:6px 0;min-height:44px;background:var(--panel2,#f8fafc)}
.ms-month .d.out{opacity:.4}
.ms-month .d.on{background:#e6f5ee;color:#00603c;font-weight:700}
.ms-month .d.today{outline:2px solid #007A4D}
.ms-month .d small{display:block;font-size:10px;font-weight:600}
@media (max-width:520px){.ms-row,.ms-row3{grid-template-columns:1fr}.ms-shift{grid-template-columns:54px 1fr;align-items:start}.ms-shift .ms-btn,.ms-shift .ms-tag{grid-column:1/-1;justify-self:start}}
`;

export async function mount(root, { getToken }) {
  if (!document.getElementById('msCss')) { const s = document.createElement('style'); s.id = 'msCss'; s.textContent = CSS; document.head.appendChild(s); }
  M = { root, token: getToken, tab: M?.tab || 'shifts', data: null, open: null, month: E.todayBkk().slice(0, 7) };
  root.innerHTML = '<div class="ms"><p class="ms-muted">Loading your shifts…</p></div>';
  if (!root.dataset.msBound) {
    root.dataset.msBound = '1';
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('change', onChange);
  }
  await load();
}

async function call(method, body, query = '') {
  const r = await fetch(`/api/my-shifts${query}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${M.token()}` }, body: method === 'GET' ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
async function load() {
  const today = E.todayBkk();
  const from = E.weekStartOf(E.addDays(today, -7)), to = E.addDays(E.weekStartOf(today), 41);
  try { M.data = await call('GET', null, `?from=${from}&to=${to}`); M.error = null; }
  catch (e) { M.error = e; }
  render();
}
const storeName = (id) => M.data?.stores.find((s) => s.id === id)?.name || id;

function render() {
  const el = M.root.querySelector('.ms') || M.root;
  if (M.error) {
    el.innerHTML = `<div class="ms-sec"><p class="ms-err">${esc(M.error.status === 503 ? 'Shift scheduling is not switched on yet.' : M.error.message)}</p><button class="ms-btn" data-ms="reload">Try again</button></div>`;
    return;
  }
  const d = M.data, today = E.todayBkk(), now = Date.now();
  const upcoming = d.shifts.filter((a) => E.toMs(a.endsAt) > now);
  const todays = d.shifts.filter((a) => E.businessDate(a) === today);
  const next = upcoming.find((a) => E.toMs(a.startsAt) > now) || null;
  const thisWeek = d.hours.find((h) => h.weekStart === E.weekStartOf(today)) || { minutes: 0, days: 0, threshold: 48 };
  const unread = d.notifications.filter((n) => !n.read).length;
  const pendingReq = d.requests.filter((r) => r.status === 'pending').length;
  const tabs = [['shifts', 'My shifts'], ['month', 'Month'], ['requests', `Requests${pendingReq ? ` (${pendingReq})` : ''}`], ['leave', 'Leave & availability'], ['inbox', `Updates${unread ? ` (${unread})` : ''}`]];
  el.innerHTML = `
    <div class="ms-cards">
      <div class="ms-card"><h4>Today</h4>${todays.length ? todays.map((a) => `<div class="big">${esc(E.fmtRange(a))}</div><div class="sub">${esc(a.role || 'Shift')} · ${esc(storeName(a.storeId))}</div>`).join('') : '<div class="big">Off today</div><div class="sub">No published shift</div>'}</div>
      <div class="ms-card"><h4>Next shift</h4>${next ? `<div class="big">${esc(E.fmtDateShort(E.businessDate(next)))}</div><div class="sub">${esc(E.fmtRange(next))} · ${esc(next.role || 'Shift')} · ${esc(storeName(next.storeId))}</div>` : '<div class="big">—</div><div class="sub">Nothing published yet</div>'}</div>
      <div class="ms-card"><h4>This week</h4><div class="big">${esc(E.fmtHours(thisWeek.minutes))}</div><div class="sub">${thisWeek.days} day${thisWeek.days === 1 ? '' : 's'} · planning guide ${thisWeek.threshold}h</div>
        <div class="ms-bar ${thisWeek.minutes > thisWeek.threshold * 60 ? 'over' : ''}" role="progressbar" aria-label="Hours this week" aria-valuenow="${thisWeek.minutes}" aria-valuemax="${thisWeek.threshold * 60}"><i style="width:${Math.min(100, (thisWeek.minutes / (thisWeek.threshold * 60)) * 100)}%"></i></div></div>
    </div>
    <div class="ms-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-ms="tab" data-tab="${k}" aria-pressed="${M.tab === k}">${esc(l)}</button>`).join('')}</div>
    ${M.tab === 'shifts' ? shiftsHtml(upcoming) : M.tab === 'month' ? monthHtml() : M.tab === 'requests' ? requestsHtml() : M.tab === 'leave' ? leaveHtml() : inboxHtml()}`;
}

function shiftsHtml(upcoming) {
  const today = E.todayBkk();
  const byWeek = new Map();
  for (const a of upcoming) { const w = E.weekStartOf(E.businessDate(a)); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(a); }
  const open = new Set(M.data.requests.filter((r) => r.status === 'pending').map((r) => r.assignmentId));
  const weekLabel = (w) => w === E.weekStartOf(today) ? 'This week' : w === E.addDays(E.weekStartOf(today), 7) ? 'Next week' : `Week of ${E.fmtDateShort(w)}`;
  return `<div class="ms-acts"><button class="ms-btn" data-ms="pdf" data-type="staff-week">Download this week (PDF)</button><button class="ms-btn" data-ms="pdf" data-type="staff-month">Download this month (PDF)</button></div>
  ${[...byWeek].map(([w, list]) => {
    const h = M.data.hours.find((x) => x.weekStart === w);
    return `<section class="ms-sec"><h3>${esc(weekLabel(w))} <span class="ms-muted">· ${esc(E.fmtHours(h?.minutes || 0))} scheduled</span></h3>
      ${list.map((a) => {
        const d = E.businessDate(a);
        return `<div class="ms-shift"><div class="ms-date ${d === today ? 'today' : ''}"><span>${E.DAY_NAMES[E.weekday(d)]}</span><b>${Number(d.slice(8))}</b></div>
          <div><div class="t">${esc(E.fmtRange(a))}${E.bkkDate(a.endsAt) !== d ? ' <span class="ms-muted">(ends next day)</span>' : ''}</div>
          <div class="m">${esc(a.role || 'Shift')} · ${esc(storeName(a.storeId))}${a.breakMinutes ? ` · ${a.breakMinutes} min break` : ''}${a.notes ? ` · ${esc(a.notes)}` : ''}</div></div>
          ${open.has(a.id) ? '<span class="ms-tag pending">Request pending</span>' : `<button class="ms-btn" data-ms="ask" data-id="${a.id}" aria-expanded="${M.open === a.id}">Request change</button>`}
          ${M.open === a.id ? `<form class="ms-form" data-ms-form="change" data-id="${a.id}" style="grid-column:1/-1">
            <label>What do you need?<select name="kind" data-ms-kind>${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${M.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            ${(M.kind || 'change') === 'change' ? `<div class="ms-row3"><label>Date<input type="date" name="date" value="${d}" required></label><label>Start<input type="time" name="start" value="${E.bkkTime(a.startsAt)}" required></label><label>End<input type="time" name="end" value="${E.bkkTime(a.endsAt)}" required></label></div>` : ''}
            ${M.kind === 'swap' ? `<label>Swap with<select name="swapEmployeeId" required><option value="">Choose a colleague…</option>${M.data.colleagues.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>` : ''}
            <label>Reason<textarea name="reason" rows="2" maxlength="500" required placeholder="A short reason for your manager"></textarea></label>
            <div class="ms-acts"><button class="ms-btn primary" type="submit">Send request</button><button class="ms-btn" type="button" data-ms="close">Cancel</button></div>
            <p class="ms-muted" style="margin:0">Your shift stays as it is until a manager approves and republishes the week.</p></form>` : ''}</div>`;
      }).join('')}</section>`;
  }).join('') || '<section class="ms-sec"><p class="ms-muted">No upcoming published shifts. When a manager publishes a week, it appears here.</p></section>'}`;
}

function monthHtml() {
  const today = E.todayBkk();
  const g = E.monthGrid(M.month + '-01');
  const [y, m] = M.month.split('-').map(Number);
  const name = `${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`;
  const mins = M.data.shifts.filter((a) => E.businessDate(a).slice(0, 7) === M.month).reduce((t, a) => t + E.paidMinutes(a), 0);
  return `<section class="ms-sec"><div class="ms-acts" style="justify-content:space-between;align-items:center;margin-bottom:10px">
    <button class="ms-btn" data-ms="month" data-dir="-1" aria-label="Previous month">‹</button><b>${esc(name)} · ${esc(E.fmtHours(mins))}</b><button class="ms-btn" data-ms="month" data-dir="1" aria-label="Next month">›</button></div>
    <div class="ms-month">${E.DAY_NAMES.map((d) => `<div class="h">${d}</div>`).join('')}${g.days.map((d) => {
      const list = M.data.shifts.filter((a) => E.businessDate(a) === d);
      return `<div class="d ${d.slice(0, 7) !== M.month ? 'out' : ''} ${list.length ? 'on' : ''} ${d === today ? 'today' : ''}" aria-label="${d}${list.length ? ': ' + list.map(E.fmtRange).join(', ') : ''}">${Number(d.slice(8))}${list.map((a) => `<small>${esc(E.bkkTime(a.startsAt))}</small>`).join('')}</div>`;
    }).join('')}</div>
    <p class="ms-muted">Only published shifts are shown. Months outside the loaded range (last week to six weeks ahead) appear empty.</p></section>`;
}

function requestsHtml() {
  const shift = (id) => M.data.shifts.find((a) => a.id === id);
  return `<section class="ms-sec"><h3>Shift requests</h3><ul class="ms-list">${M.data.requests.map((r) => {
    const a = shift(r.assignmentId);
    const what = r.kind === 'change' ? `Move to ${E.fmtDateShort(E.bkkDate(r.proposedStartsAt))} ${E.bkkTime(r.proposedStartsAt)}–${E.bkkTime(r.proposedEndsAt)}` : r.kind === 'swap' ? `Swap with ${M.data.colleagues.find((c) => c.id === r.swapEmployeeId)?.name || 'a colleague'}` : 'Can’t work this shift';
    return `<li><div><b>${esc(KIND[r.kind])}</b> · ${a ? esc(`${E.fmtDateShort(E.businessDate(a))} ${E.fmtRange(a)}`) : 'shift'}<br><span class="ms-muted">${esc(what)} — “${esc(r.reason)}”${r.decisionNote ? ` · Manager: ${esc(r.decisionNote)}` : ''}</span></div>
      <div class="ms-acts"><span class="ms-tag ${r.status}">${esc(r.status)}</span>${r.status === 'pending' ? `<button class="ms-btn danger" data-ms="cancel-change" data-id="${r.id}">Cancel</button>` : ''}</div></li>`;
  }).join('') || '<li class="ms-muted">No requests yet. Use “Request change” on any published shift.</li>'}</ul></section>`;
}

function leaveHtml() {
  const today = E.todayBkk();
  return `<section class="ms-sec"><h3>Leave</h3><ul class="ms-list">${M.data.leave.map((l) => `<li><div><b>${esc(LEAVE[l.leaveType] || l.leaveType)}</b> · ${esc(E.fmtSpan(l))}${l.reason ? `<br><span class="ms-muted">${esc(l.reason)}</span>` : ''}${l.decisionNote ? `<br><span class="ms-muted">Manager: ${esc(l.decisionNote)}</span>` : ''}</div>
      <div class="ms-acts"><span class="ms-tag ${l.status}">${esc(l.status)}</span>${l.status === 'pending' ? `<button class="ms-btn danger" data-ms="cancel-leave" data-id="${l.id}">Cancel</button>` : ''}</div></li>`).join('') || '<li class="ms-muted">No leave requests.</li>'}</ul>
    <form class="ms-form" data-ms-form="leave"><b>Request leave</b>
      <div class="ms-row"><label>From<input type="date" name="fromDate" value="${today}" required></label><label>To (inclusive)<input type="date" name="toDate" value="${today}" required></label></div>
      <div class="ms-row"><label>Type<select name="leaveType">${Object.entries(LEAVE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label>Reason<input name="reason" maxlength="500"></label></div>
      <div class="ms-acts"><button class="ms-btn primary" type="submit">Send leave request</button></div></form></section>
  <section class="ms-sec"><h3>Availability</h3><p class="ms-muted">Tell your manager when you usually can’t work, or prefer to. This guides scheduling; it is not leave.</p>
    <ul class="ms-list">${M.data.availability.map((a) => `<li><div><b>${esc(a.kind === 'unavailable' ? 'Unavailable' : a.kind === 'preferred' ? 'Prefer to work' : 'Available')}</b> · ${a.onDate ? esc(E.fmtDateShort(a.onDate)) : `every ${E.DAY_NAMES_LONG[a.weekday]}`} · ${a.startTime ? esc(`${a.startTime}–${a.endTime}`) : 'all day'}${a.reason ? `<br><span class="ms-muted">${esc(a.reason)}</span>` : ''}</div>
      <button class="ms-btn danger" data-ms="withdraw" data-id="${a.id}">Remove</button></li>`).join('') || '<li class="ms-muted">Nothing entered.</li>'}</ul>
    <form class="ms-form" data-ms-form="availability"><b>Add availability</b>
      <div class="ms-row"><label>Type<select name="kind"><option value="unavailable">I can’t work</option><option value="preferred">I prefer to work</option></select></label>
        <label>When<select name="weekday"><option value="">One date (below)</option>${E.DAY_NAMES_LONG.map((d, i) => `<option value="${i}">Every ${d}</option>`).join('')}</select></label></div>
      <div class="ms-row3"><label>Date<input type="date" name="onDate"></label><label>From (blank = all day)<input type="time" name="startTime"></label><label>To<input type="time" name="endTime"></label></div>
      <label>Reason<input name="reason" maxlength="300" placeholder="e.g. university class"></label>
      <div class="ms-acts"><button class="ms-btn primary" type="submit">Save</button></div></form></section>`;
}

function inboxHtml() {
  return `<section class="ms-sec"><div class="ms-acts" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Updates</h3>${M.data.notifications.some((n) => !n.read) ? '<button class="ms-btn" data-ms="read">Mark all read</button>' : ''}</div>
    <ul class="ms-list">${M.data.notifications.map((n) => `<li class="${n.read ? '' : 'unread'}"><div>${esc(n.title)}${n.body ? `<br><span class="ms-muted">${esc(n.body)}</span>` : ''}</div><span class="ms-muted">${esc(new Date(n.createdAt).toLocaleString('en-GB', { timeZone: E.ZONE, dateStyle: 'medium', timeStyle: 'short' }))}</span></li>`).join('') || '<li class="ms-muted">No updates yet.</li>'}</ul></section>`;
}

let toastT;
function toast(m, bad) {
  let t = document.getElementById('msToast');
  if (!t) {
    t = document.createElement('div'); t.id = 'msToast'; t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,520px);padding:12px 16px;border-radius:12px;color:#fff;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 10px 30px #0004;transition:opacity .2s';
    document.body.appendChild(t);
  }
  t.textContent = m; t.style.background = bad ? '#c0392b' : '#14231c'; t.style.opacity = '1';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = '0'; }, 3800);
}

async function act(fn, ok) {
  try { await fn(); if (ok) toast(ok); await load(); }
  catch (e) { toast(e.message, true); }
}

async function onClick(e) {
  const t = e.target.closest('[data-ms]');
  if (!t) return;
  switch (t.dataset.ms) {
    case 'reload': return load();
    case 'tab': M.tab = t.dataset.tab; M.open = null; return render();
    case 'ask': M.open = M.open === t.dataset.id ? null : t.dataset.id; M.kind = 'change'; return render();
    case 'close': M.open = null; return render();
    case 'month': { const [y, m] = M.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(t.dataset.dir), 1)); M.month = d.toISOString().slice(0, 7); return render(); }
    case 'pdf': {
      const week = t.dataset.type === 'staff-month' ? `${M.month}-01` : E.todayBkk();
      // Same-origin page; it needs this tab's sessionStorage login, so no 'noopener'.
      return window.open(`shift-print.html?self=1&type=${t.dataset.type}&week=${week}`, '_blank');
    }
    case 'cancel-change': return act(() => call('POST', { action: 'cancel-change', id: t.dataset.id }), 'Request cancelled.');
    case 'cancel-leave': return act(() => call('POST', { action: 'cancel-leave', id: t.dataset.id }), 'Leave request cancelled.');
    case 'withdraw': return act(() => call('POST', { action: 'withdraw-availability', id: t.dataset.id }), 'Removed.');
    case 'read': return act(() => call('POST', { action: 'read' }));
  }
}
function onChange(e) {
  if (e.target.matches('[data-ms-kind]')) { M.kind = e.target.value; render(); }
}
async function onSubmit(e) {
  const form = e.target.closest('[data-ms-form]');
  if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const btn = form.querySelector('[type="submit"]'); if (btn) btn.disabled = true;
  const kind = form.dataset.msForm;
  if (kind === 'change') {
    M.open = null;
    return act(() => call('POST', { action: 'change', assignmentId: form.dataset.id, kind: f.kind, date: f.date, start: f.start, end: f.end, swapEmployeeId: f.swapEmployeeId, reason: f.reason }), 'Request sent to your manager.');
  }
  if (kind === 'leave') return act(() => call('POST', { action: 'leave', ...f }), 'Leave request sent.');
  if (kind === 'availability') return act(() => call('POST', { action: 'availability', ...f, weekday: f.weekday === '' ? null : f.weekday }), 'Saved.');
}
