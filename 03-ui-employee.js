
/* ======================= UI ======================= */
const $ = (s, r = document) => r.querySelector(s);
const STATUS_LABEL = c => (state.statuses.find(s => s.code === c) || { label: c }).label;
const chip = (code, label) => `<span class="chip s-${code}">${esc(label || STATUS_LABEL(code))}</span>`;
const ROLE_LABEL = { employee: 'Employee', supervisor: 'Supervisor', project_manager: 'Project Manager', production_manager: 'Production Manager', logistics: 'Logistics', finance: 'Finance', vendor: 'Vendor', admin: 'Admin' };
const mainRole = u => (u.roles.find(r => r.role !== 'employee') || u.roles[0]);
function roleText(u) { const r = mainRole(u); const p = r.project_id ? ', ' + projById(r.project_id).name : ''; return ROLE_LABEL[r.role] + p; }
function pctCell(v, low) { if (v == null) return '—'; const w = Math.max(2, Math.min(60, v * 0.5)); return `<span class="bar ${v < (low || 100) ? 'low' : ''}" style="width:${w}px"></span> ${r1(v)}%`; }
const route = () => local.session.route;
const params = () => local.session.params || {};
function go(r, p = {}) { local.session.route = r; local.session.params = p; save(); render(true); const m = $('#main'); if (m) m.scrollTop = 0; window.scrollTo(0, 0); }
function toast(html, err) { const el = $('#toast'); el.innerHTML = `<div class="toast ${err ? 'err' : ''}">${html}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => el.innerHTML = '', err ? 7000 : 4200); }
function openDialog(html) { const d = $('#dlg'); d.innerHTML = html; if (!d.open) d.showModal(); }
function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }
function unread(u) { const r = (local.readAt || {})[u.id] || 0; return state.notifications.filter(n => n.u === u.id && n.at > r).length; }

const NAV = [
  { id: 'home', label: 'Attendance', show: u => !!u.employee_id },
  { id: 'history', label: 'My history', show: u => !!u.employee_id },
  { id: 'performance', label: 'My shift performance', show: u => isLabeler(empOf(u)) },
  { id: 'meals', label: 'Meals', show: u => !!u.employee_id },
  { id: 'team', label: 'Team attendance', show: u => isManager(u) },
  { id: 'teamperf', label: 'Team performance', show: u => isManager(u) },
  { id: 'projects', label: 'Projects', show: u => isAdmin(u) || has(u, 'project_manager'), count: u => pendingFor(u).length },
  { id: 'ranking', label: 'Team ranking', show: u => canRank(u) },
  { id: 'approvals', label: 'Corrections', show: u => has(u, 'supervisor') || has(u, 'project_manager') || has(u, 'admin'), count: u => pendingAdjFor(u).length },
  { id: 'reports', label: 'Daily reports', show: u => has(u, 'project_manager') || has(u, 'production_manager') || has(u, 'admin') },
  { id: 'overview', label: 'Production overview', show: u => has(u, 'production_manager') || has(u, 'admin') },
  { id: 'logistics', label: 'Orders and headcount', show: u => has(u, 'logistics') || has(u, 'admin') },
  { id: 'finance', label: 'Finance', show: u => has(u, 'finance') || has(u, 'admin') },
  { id: 'vendor', label: 'Vendor portal', show: u => has(u, 'vendor') },
  { id: 'admin', label: 'Admin', show: u => has(u, 'admin'), count: () => state.users.filter(x => x.status === 'PENDING').length },
  { id: 'events', label: 'Event log', show: u => has(u, 'admin') },
  { id: 'inbox', label: 'Inbox', show: () => true, count: u => unread(u) }];
function pendingAdjFor(u) { return state.adjustments.filter(a => a.status === 'PENDING' && canSee(u, a.e) && (has(u, 'project_manager') || has(u, 'admin') || a.req === u.id)); }

let _renderSeq = 0;
function isTyping() { const a = document.activeElement; return !!a && a.closest && a.closest('#root') && (a.matches('input:not([type=checkbox]):not([type=radio]),textarea,select')); }
function render(force) {
  if (!force && isTyping()) { mem.pendingRender = true; return; }
  mem.pendingRender = false; _renderSeq++;
  const u = currentUser(); const root = $('#root');
  const sx = window.scrollX, sy = window.scrollY;
  root.innerHTML = u ? shell(u) : authView() + (state.users.length ? demoBar() : '');
  window.scrollTo(sx, sy);
  tickTimers();
}
function shell(u) {
  const items = NAV.filter(n => n.show(u)); if (!items.some(n => n.id === route()) && !(route() === 'employee' && isManager(u))) local.session.route = items[0].id;
  let main; try { guardNetwork(); main = VIEWS[route()](u); } catch (e) { main = e instanceof ApiError ? blockedView(e) : errorView(e); }
  const tzs = allZones();
  return `<div class="app">
  <aside class="side">
    <div class="brand"><span class="brand-mark" aria-hidden="true">UW</span>${esc(state.company.name || 'UnifiedWorkforce')}</div>
    <div class="who"><strong>${esc(u.name)}</strong><span class="muted small">${esc(roleText(u))}${u.employee_id ? ', staff ' + esc(empOf(u).staff_no) : ''}</span></div>
    <nav class="nav" aria-label="Main">${items.map(n => { const c = n.count ? n.count(u) : 0; return `<button data-act="nav" data-r="${n.id}" ${(route() === n.id || (route() === 'employee' && n.id === 'team')) ? 'aria-current="page"' : ''}><span>${n.label}</span>${c ? `<span class="count">${c}</span>` : ''}</button>`; }).join('')}</nav>
    <div class="mobile-nav"><label class="f">Go to<select data-change="nav">${items.map(n => `<option value="${n.id}" ${route() === n.id ? 'selected' : ''}>${n.label}${n.count && n.count(u) ? ' (' + n.count(u) + ')' : ''}</option>`).join('')}</select></label></div>
    <div class="side-foot">
      <label class="f">Display timezone
        <input list="tzlist" data-change="tz" value="${esc(displayTz())}" aria-describedby="tzhelp">
        <datalist id="tzlist">${tzs.map(z => `<option value="${z}">${z} (${tzLabel(z)})</option>`).join('')}</datalist>
      </label>
      <span id="tzhelp" class="muted small">${esc(tzLabel(displayTz()))}. Times are stored in UTC.</span>
      <button class="btn" data-act="pw-open">Change password</button>
      <button class="btn" data-act="logout">Sign out</button>
    </div>
  </aside>
  <main class="main" id="main">${main}</main></div>${demoBar()}`;
}
function errorView(e) { console.error(e); return `<div class="blocked panel"><h2>This page failed to load</h2><p class="muted">${esc(e.message)}</p></div>`; }
function blockedView(e) {
  const c = netCtx();
  return `<div class="blocked stack"><p class="code">${e.status} ${esc(e.code)}</p><h1>You're outside the company network</h1>
  <p>${esc(e.message)}</p><p class="muted">The server checks the source address of every request against the network allowlist (${state.zones.filter(z => z.active).map(z => esc(z.name) + ' ' + esc(z.cidr)).join(', ')}). Your address is ${esc(c.ip)}.</p>
  <p class="muted small">Use the device selector in the demo controls at the bottom of the screen to switch networks.</p></div>`;
}

/* ---------- demo controls (stand-ins for real time passing and for which network you're on) ---------- */
function nextAt(date, time, tz, t) { let x = zoned(date, time, tz); if (x <= t) x = zoned(addDays(date, 1), time, tz); return x; }
function jumpTargets() {
  const t = now(); const out = [];
  for (const def of state.shiftDefs) { const p = projById(def.project_id); const d = ymd(t, p.tz); const n = def.name === 'NIGHT' ? 'night' : 'day';
    out.push([`${p.name} ${n} shift start (${def.start})`, nextAt(d, def.start, p.tz, t) + MIN]);
    out.push([`${p.name} ${n} shift end (${def.end})`, nextAt(d, def.end, p.tz, t) + 2 * MIN]);
    const lead = Number(state.settings.meal_reminder_minutes ?? 30); if (lead > 0) out.push([`${p.name} ${n} meal reminder (${lead} min before ${def.end})`, nextAt(d, def.end, p.tz, t) - lead * MIN + MIN]); }
  const d = ymd(t);
  for (const v of state.vendors.filter(v => v.active)) { let c = cutoffAt(v, d); if (c <= t) c = cutoffAt(v, addDays(d, 1)); out.push([`${v.name} cut-off`, c + MIN]); }
  const per = periodFor(d); out.push([`Meal period close (${fmtDate(per.ends)}, 23:59)`, zoned(per.ends, '23:59', COMPANY_TZ) + 2 * MIN]);
  return out.sort((a, b) => a[1] - b[1]);
}
const toIp = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
function ipInside(cidr) { const [base, bits] = cidr.split('/'); const b = +bits; const mask = b === 0 ? 0 : (0xFFFFFFFF << (32 - b)) >>> 0; return toIp(((ipInt(base) & mask) >>> 0) + (b >= 31 ? 0 : 17)); }
function devices() { const out = state.zones.map(z => [ipInside(z.cidr), `On ${z.name}`]); out.push(['192.168.88.14', 'Guest Wi-Fi'], ['197.248.10.5', 'Home broadband']); if (!out.some(d => d[0] === local.device.ip)) out.push([local.device.ip, 'Current device']); return out; }
function demoBar() {
  const c = netCtx(); const tz = currentUser() ? displayTz() : COMPANY_TZ;
  return `<div class="demobar" role="region" aria-label="Test controls"><span class="lbl hide-m" title="Stand-ins for time passing and for which network your browser is on">Test controls</span><span class="sep hide-m"></span>
  <span class="lbl hide-m">Server clock</span><span class="clk" data-clock="${esc(tz)}"></span>
  ${canClock() ? `<button data-act="adv" data-ms="${15 * MIN}" title="Moves the shared server clock for everyone">+15 min</button>
  <button data-act="adv" data-ms="${HOUR}" title="Moves the shared server clock for everyone">+1 h</button>
  <button data-act="adv" data-ms="${6 * HOUR}" class="hide-m">+6 h</button>
  <select data-change="jump" aria-label="Jump the shared server clock to"><option value="">Jump to…</option>${jumpTargets().map(([l, at]) => `<option value="${at}">${esc(l)}, ${esc(fmtDT(at, tz))}</option>`).join('')}</select>` : ''}
  <span class="sep hide-m"></span>
  <span class="lbl hide-m">Device</span>
  <select data-change="device" aria-label="Network you are connecting from">${devices().map(([ip, l]) => `<option value="${ip}" ${ip === local.device.ip ? 'selected' : ''}>${esc(l)}, ${ip}</option>`).join('')}</select>
  <span><span class="netdot" style="background:${c.zone ? 'var(--present-bg)' : 'var(--absent-bg)'}"></span>${c.zone ? esc(c.zone) : 'Not allowed'}</span>
  <span class="sep hide-m"></span>
  ${canClock() ? '<button data-act="reset" class="hide-m">Erase all data</button>' : ''}<span class="saving" aria-live="polite">${sync.busy ? 'Saving…' : ''}</span>
  </div>`;
}

/* ---------- employee: attendance home ---------- */
function vHome(u) {
  const emp = empOf(u); const t = now(); const date = attendanceDateFor(emp, t);
  const day = getDay(emp.id, date) || { st: rosterStatus(emp, date), ps: 0 }; const w = windowFor(emp, date);
  const open = openSession(emp.id); const ss = sessionsFor(emp.id, date); const st = open ? 'PRESENT' : day.st;
  const bands = { PRESENT: 'var(--present)', COMPLETED: 'var(--done)', EXPECTED: 'var(--expected)', ABSENT: 'var(--absent)', LEAVE: 'var(--leave)', REST_DAY: 'var(--rest)', HOLIDAY: 'var(--rest)' };
  const titles = { PRESENT: 'Present', COMPLETED: 'Attendance completed', EXPECTED: 'Not checked in', ABSENT: 'Marked absent', LEAVE: 'On leave', REST_DAY: 'Rest day', HOLIDAY: 'Public holiday' };
  const shiftTxt = w ? `${w.def.name === 'NIGHT' ? 'Night' : 'Day'} shift ${w.def.start}–${w.def.end}, ${esc(w.project.name)}` : 'No shift';
  let clock, meta = '', button = '';
  if (st === 'PRESENT') {
    clock = `<div class="clock" data-since="${open.in - (day.ps || 0) * 1000}" data-fmt="hm"></div><p class="muted">Present for</p>`;
    meta = `<div><span>Check-in</span><b>${fmtTime(day.fi || open.in)}</b>${day.late ? ' <span class="chip s-WARN nodot">Late</span>' : ''}</div>${w ? `<div><span>Shift ends</span><b>${fmtTime(w.end)}</b></div>` : ''}`;
    button = `<button class="bigbtn out" data-act="checkout-confirm">CHECK OUT</button>`;
  } else if (st === 'COMPLETED') {
    clock = `<div class="clock">${fmtDur(day.ps)}</div><p class="muted">Total presence</p>`;
    meta = `<div><span>Check-in</span><b>${fmtTime(day.fi)}</b></div><div><span>Check-out</span><b>${fmtTime(day.lo)}</b></div>`;
    button = `<button class="btn" data-act="checkin">Check in again after a break</button>`;
  } else {
    clock = `<div class="clock" data-clock="${esc(displayTz())}" data-short="1"></div><p class="muted">Server time, ${esc(displayTz())}</p>`;
    meta = w ? `<div><span>Shift starts</span><b>${fmtTime(w.start)}</b></div>` : '';
    button = ['EXPECTED', 'ABSENT'].includes(st) ? `<button class="bigbtn" data-act="checkin">CHECK IN</button>` : `<button class="btn" data-act="checkin">Check in anyway</button>`;
  }
  const auto = ss.find(s => s.cr === 'AUTO_CLOSED');
  const ps = pshiftFor(emp.id, date);
  const prompts = [];
  if (auto) prompts.push(`<div class="note warn">Your session on ${fmtDate(date)} was closed automatically at ${fmtTime(auto.out)} because no check-out was recorded. Ask your supervisor to file a correction if the time is wrong.</div>`);
  if (ps && ps.st === 'AWAITING_REASON') prompts.push(`<div class="note warn spread"><span>Your shift closed at ${ps.m.qty}% of the quantity target. Add a reason to submit your shift report.</span><button class="btn primary small" data-act="nav" data-r="performance">Add reason</button></div>`);
  const showMeal = (st === 'COMPLETED' && !isLabeler(emp)) || (ps && ps.st === 'SUBMITTED');
  if (showMeal) prompts.push(mealPrompt(emp, date));
  return `<div class="stack" style="--gap:18px">
  <section class="punch" style="--band:${bands[st]}">
    <div class="spread"><span class="state">${titles[st]}</span><span class="muted">${fmtDate(date, true)}</span></div>
    <div>${clock}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    <div class="row">${button}</div>
    <p class="muted small">${shiftTxt}. ${netCtx().zone ? 'Connected from ' + esc(netCtx().zone) + '.' : ''}</p>
  </section>
  ${prompts.join('')}
  ${ss.length > 1 || (ss.length && st !== 'PRESENT') ? `<section class="panel" style="max-width:720px"><h3>Sessions on ${fmtDate(date)}</h3><div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Check-in</th><th>Check-out</th><th class="num">Duration</th><th>Closed by</th></tr></thead><tbody>${ss.map(s => `<tr><td>${fmtTime(s.in)}</td><td>${s.out ? fmtTime(s.out) : '—'}</td><td class="num">${s.out ? fmtDur(s.dur, true) : `<span data-since="${s.in}" data-fmt="hms"></span>`}</td><td>${s.cr === 'AUTO_CLOSED' ? chip('WARN', 'Auto-closed') : s.cr === 'ADJUSTED' ? 'Correction' : s.out ? 'You' : 'Open'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
  </div>`;
}

/* ---------- meals prompt (end of shift) ---------- */
function mealPrompt(emp, fromDate) {
  const nd = nextMealDate(emp, fromDate); if (!nd) return '';
  const mt = mealTypeFor(emp, nd); const v = vendorFor(mt); if (!v) return '';
  const b = bookingFor(emp.id, nd, mt); const c = cutoffAt(v, nd); const t = now();
  if (t >= c) return '';
  if (b && b.st !== 'CANCELLED') {
    return `<div class="note">${b.st === 'NO_MEAL' ? `No meal for ${fmtDate(nd)}.` : `Meal booked for ${fmtDate(nd)} (${mt === 'LUNCH' ? 'lunch' : 'dinner'} from ${esc(v.name)}).`} You can change this until ${fmtDT(c)} in Meals.</div>`;
  }
  const rule = priceRule(mt, nd);
  return `<section class="panel stack" style="max-width:720px;--gap:12px"><div class="spread"><h2>Book your meal for ${fmtDate(nd, true)}</h2><span class="muted small">${mt === 'LUNCH' ? 'Lunch' : 'Dinner'} from ${esc(v.name)}, see this week's menu</span></div>
  <div class="row"><button class="btn primary" data-act="book" data-e="${emp.id}" data-d="${nd}" data-i="1">Book meal</button><button class="btn" data-act="book" data-e="${emp.id}" data-d="${nd}" data-i="">No meal ${nd === addDays(fromDate, 1) ? 'tomorrow' : 'that day'}</button></div>
  <p class="muted small">You pay ${kes(rule.es)}; the company adds ${kes(rule.cs)}. Booking closes ${fmtDT(c)}.</p></section>`;
}

/* ---------- employee: history ---------- */
function monthDays(eid, ym) { return Object.values(state.days).filter(d => d.e === eid && d.d.startsWith(ym) && d.d <= ymd(now())).sort((a, b) => a.d.localeCompare(b.d)); }
function monthSummary(eid, ym) {
  const ds = monthDays(eid, ym); const sch = ds.filter(d => SCHEDULED.has(d.st)); const pres = ds.filter(d => d.st === 'PRESENT' || d.st === 'COMPLETED');
  const tot = ds.reduce((a, d) => a + d.ps, 0);
  return { scheduled: sch.length, present: pres.length, absent: ds.filter(d => d.st === 'ABSENT').length, leave: ds.filter(d => d.st === 'LEAVE').length, total: tot, avg: pres.length ? tot / pres.length : 0, late: ds.filter(d => d.late).length };
}
function summaryStats(s) { return `<div class="stats"><div><span>Scheduled days</span><b>${s.scheduled}</b></div><div><span>Present</span><b>${s.present}</b></div><div><span>Absent</span><b>${s.absent}</b></div><div><span>Leave</span><b>${s.leave}</b></div><div><span>Total hours</span><b>${fmtDur(s.total)}</b></div><div><span>Average per day</span><b>${fmtDur(s.avg)}</b></div><div><span>Late arrivals</span><b>${s.late}</b></div></div>`; }
function monthOptions(sel) { const t = ymd(now()); const out = []; let [y, m] = t.split('-').map(Number); for (let i = 0; i < 2; i++) { const v = `${y}-${String(m).padStart(2, '0')}`; out.push(`<option value="${v}" ${v === sel ? 'selected' : ''}>${MONL[m - 1]} ${y}</option>`); m--; if (m < 1) { m = 12; y--; } } return out.join(''); }
function calendar(eid, ym) {
  const [y, m] = ym.split('-').map(Number); const first = `${ym}-01`; const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); const lead = (weekday(first) + 6) % 7; const today = ymd(now());
  let h = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('') + '<div class="cell blank"></div>'.repeat(lead);
  for (let i = 1; i <= dim; i++) {
    const d = `${ym}-${String(i).padStart(2, '0')}`; const day = getDay(eid, d); const st = day ? (openSession(eid) && openSession(eid).d === d ? 'PRESENT' : day.st) : (d > today ? '' : '');
    h += `<div class="cell ${st && d <= today ? 's-' + st : ''} ${d === today ? 'today' : ''}"><b>${i}</b><span>${day && d <= today ? esc(STATUS_LABEL(st)) : d > today && day ? esc(STATUS_LABEL(day.st)).replace('Not checked in', '') : ''}</span><span>${day && day.ps ? fmtDur(day.ps) : ''}</span></div>`;
  }
  return `<div class="cal">${h}</div>`;
}
function vHistory(u) {
  const emp = empOf(u); const ym = params().month || ymd(now()).slice(0, 7); const s = monthSummary(emp.id, ym);
  const ds = monthDays(emp.id, ym).reverse();
  return `<div class="pagehead"><div><h1>My history</h1><p class="muted">Every day is computed from your check-ins. Corrections go through your supervisor.</p></div>
  <label class="f">Month<select data-change="month">${monthOptions(ym)}</select></label></div>
  <div class="stack">${summaryStats(s)}<section class="panel">${calendar(emp.id, ym)}</section>
  ${dayTable(emp, ds, false)}</div>`;
}
function dayTable(emp, ds, manage) {
  const lab = isLabeler(emp);
  return `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Status</th><th>Check-in</th><th>Check-out</th><th class="num">Presence</th>${lab ? '<th class="num">Production</th><th class="num">Rating</th>' : ''}${manage ? '<th></th>' : ''}</tr></thead><tbody>
  ${ds.map(d => { const ps = pshiftFor(emp.id, d.d); const ss = sessionsFor(emp.id, d.d); return `<tr><td>${fmtDate(d.d)}</td><td>${chip(d.st)}${d.late ? ' <span class="chip s-WARN nodot">Late</span>' : ''}${ss.some(s => s.cr === 'AUTO_CLOSED') ? ' <span class="chip s-WARN nodot">Auto-closed</span>' : ''}</td><td>${fmtTime(d.fi)}</td><td>${fmtTime(d.lo)}</td><td class="num">${d.ps ? fmtDur(d.ps) : '—'}</td>${lab ? `<td class="num">${ps ? fmtDur(ps.prod) : '—'}</td><td class="num">${ps && ps.m ? ps.m.rating + '%' : '—'}</td>` : ''}${manage ? `<td>${ss.length ? `<button class="btn small" data-act="adj-open" data-e="${emp.id}" data-d="${d.d}">Request correction</button>` : ''}</td>` : ''}</tr>`; }).join('') || `<tr><td colspan="8" class="empty">No days recorded this month.</td></tr>`}
  </tbody></table></div>`;
}

/* ---------- employee: productivity + extension ---------- */
function extPopup(emp) {
  const t = now(); const date = attendanceDateFor(emp, t); const w = windowFor(emp, date); const ps = pshiftFor(emp.id, date);
  const ex = state.ext[emp.id] || { state: 'closed', task: 'LABEL', beats: 0 }; const m = ps ? liveMetrics(ps) : null;
  const inShift = w && t >= w.start && t < w.end && rosterStatus(emp, date) === 'EXPECTED';
  const lt = targetFor(emp.project_id, 'LABEL', date), rt = targetFor(emp.project_id, 'REVIEW', date);
  return `<div class="ext" aria-label="Browser extension popup">
  <div class="ext-bar"><span class="brand-mark" style="width:18px;height:18px;font-size:.55rem;border-radius:4px">UW</span>Extension, signed in as ${esc(emp.full_name)}</div>
  <div class="ext-body">
    ${inShift ? `<div><span class="muted small">Shift ends in</span><div class="timer" data-until="${w.end}"></div></div>` : `<p class="muted">No shift running. ${w && t < w.start ? 'Next shift starts ' + fmtDT(w.start) + '.' : ''}</p>`}
    <div><span class="muted small">Labelbox tab</span><div class="seg" role="group" aria-label="Labelbox tab">${[['active', 'Focused, active'], ['idle', 'Idle 5+ min'], ['closed', 'Closed']].map(([k, l]) => `<button data-act="ext" data-s="${k}" aria-pressed="${ex.state === k}">${l}</button>`).join('')}</div></div>
    <div><span class="muted small">Working on</span><div class="seg" role="group" aria-label="Task type">${[['LABEL', 'Labelling'], ['REVIEW', 'Review']].map(([k, l]) => `<button data-act="ext-task" data-s="${k}" aria-pressed="${ex.task === k}">${l}</button>`).join('')}</div></div>
    ${ps ? `<div class="stats" style="grid-template-columns:1fr 1fr"><div><span>Labelled</span><b>${ps.ul.toLocaleString()}</b></div><div><span>Reviewed</span><b>${ps.ur.toLocaleString()}</b></div><div><span>Production time</span><b>${fmtDur(ps.prod)}</b></div><div><span>Quality</span><b>${ps.qual == null ? '—' : ps.qual + '%'}</b></div></div>
    <div><div class="spread small"><span>Quantity vs target (${lt}/hr label, ${rt}/hr review)</span><b>${m.qty}%</b></div><div class="meter ${m.qty < 100 ? 'low' : ''}"><i style="width:${Math.min(100, m.qty)}%"></i></div></div>
    <p class="muted small">Last synced ${fmtTime(ps.sync)}. ${Math.round(ex.beats || 0)} heartbeats this session.</p>${ps.st === 'OPEN' ? sandboxForm(ps) : ''}` : `<p class="muted small">Production starts when a Labelbox tab is focused during your shift.</p>`}
  </div></div>`;
}
function metricRows(m) {
  return `<div class="tablewrap"><table><thead><tr><th>Task</th><th class="num">Annotations</th><th class="num">Productive time</th><th class="num">Rate / hr</th><th class="num">Target / hr</th><th>Quantity</th></tr></thead><tbody>
  ${m.rows.map(r => `<tr><td>${r.task === 'LABEL' ? 'Labelling' : 'Review'}</td><td class="num">${r.units.toLocaleString()}</td><td class="num">${fmtDur(r.hours * 3600)}</td><td class="num">${Math.round(r.rate)}</td><td class="num">${r.target}</td><td>${pctCell(r.qty)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No productive time yet.</td></tr>'}</tbody></table></div>`;
}
function vPerformance(u) {
  const emp = empOf(u); const t = now(); const date = attendanceDateFor(emp, t); const ps = pshiftFor(emp.id, date);
  const recent = state.pshifts.filter(p => p.e === emp.id && p.st !== 'OPEN').sort((a, b) => b.d.localeCompare(a.d)).slice(0, 14);
  const awaiting = state.pshifts.filter(p => p.e === emp.id && p.st === 'AWAITING_REASON');
  const proj = projById(assignmentOf(emp.id).project_id); const w = weightsFor(proj.id);
  let cur = '';
  if (ps) {
    const m = liveMetrics(ps);
    cur = `<section class="panel stack" style="--gap:12px"><div class="spread"><h2>${ps.st === 'OPEN' ? 'Current shift' : 'Shift summary'}, ${fmtDate(ps.d)}</h2>${ps.st === 'OPEN' ? '<span class="live">Live</span>' : chip(ps.st === 'SUBMITTED' ? 'COMPLETED' : 'WARN', ps.st === 'SUBMITTED' ? 'Submitted' : 'Awaiting reason')}</div>
    <div class="stats"><div><span>Quantity</span><b>${m.qty}%</b></div><div><span>Quality</span><b>${m.qual == null ? '—' : m.qual + '%'}</b></div><div><span>Rating</span><b>${m.rating}%</b></div><div><span>Production time</span><b>${fmtDur(ps.prod)}</b></div></div>
    ${metricRows(m)}<p class="muted small">Rating = quantity × ${w.q} + quality × ${w.ql}, capped at ${state.settings.rating_cap}%. Quality target ${proj.quality_target}%. Production time counts only focused, active Labelbox time and is kept separate from attendance.</p></section>`;
  }
  const reasonForms = awaiting.map(p => `<section class="panel stack" style="--gap:12px;border-color:var(--warn)"><h2>Why was ${fmtDate(p.d)} below target?</h2>
    <p class="muted">You reached ${p.m.qty}% of the quantity target. Your report is sent to you and your supervisor when you save. If no reason is given within ${state.settings.reason_timeout_hours} hours it is submitted as "No reason given" and flagged.</p>
    <form data-form="reason" data-id="${p.id}" class="form"><label class="f">Reason<select name="cat" required>${Object.entries(REASONS).filter(([k]) => k !== 'NONE').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <label class="f" style="flex:1 1 260px">Details<input name="text" maxlength="300" placeholder="What slowed you down?"></label><button class="btn primary">Submit shift report</button></form></section>`).join('');
  const lastSubmitted = recent.find(p => p.st === 'SUBMITTED' && p.r && now() - p.r.at < 18 * HOUR);
  return `<div class="pagehead"><div><h1>My shift performance</h1><p class="muted">${esc(proj.name)}. Working time and counts come from the browser extension while you work in Labelbox.</p></div></div>
  <div class="grid2" style="grid-template-columns:minmax(260px,340px) 1fr">${extPopup(emp)}<div class="stack">${reasonForms}${lastSubmitted ? mealPrompt(emp, lastSubmitted.d) : ''}${cur}</div></div>
  <section class="stack" style="margin-top:24px;--gap:10px"><h2>Recent shifts</h2>${perfTable(recent, false)}</section>`;
}
function perfTable(list, withName) {
  return `<div class="tablewrap"><table><thead><tr>${withName ? '<th>Employee</th>' : ''}<th>Date</th><th class="num">Prod. time</th><th class="num">Labelled</th><th class="num">Label/hr</th><th class="num">Reviewed</th><th class="num">Review/hr</th><th>Quantity</th><th>Quality</th><th class="num">Rating</th><th>Reason</th></tr></thead><tbody>
  ${list.map(p => { const m = liveMetrics(p); const L = m.rows.find(r => r.task === 'LABEL'), R = m.rows.find(r => r.task === 'REVIEW'); const e = empById(p.e); const qt = projById(p.p).quality_target;
    return `<tr ${withName ? `class="click" data-act="emp" data-e="${p.e}"` : ''}>${withName ? `<td>${esc(e.staff_no)} ${esc(e.full_name)}</td>` : ''}<td>${fmtDate(p.d)}</td><td class="num">${fmtDur(prodSeconds(p))}</td><td class="num">${liveCount(p, 'ul').toLocaleString()}</td><td class="num">${L ? Math.round(L.rate) : '—'}</td><td class="num">${liveCount(p, 'ur').toLocaleString()}</td><td class="num">${R ? Math.round(R.rate) : '—'}</td><td>${pctCell(m.qty)}</td><td>${m.qual == null ? '—' : (m.qual < qt ? `<span class="chip s-WARN nodot">${m.qual}%</span>` : m.qual + '%')}</td><td class="num"><b>${m.rating}%</b></td><td class="wrap small">${p.st === 'OPEN' ? '<span class="live">Live</span>' : p.st === 'AWAITING_REASON' ? chip('WARN', 'Awaiting reason') : p.r && p.r.cat ? (p.r.auto ? chip('BAD', 'No reason given') : esc(REASONS[p.r.cat]) + (p.r.text ? ': ' + esc(p.r.text) : '')) : '<span class="muted">On target</span>'}</td></tr>`; }).join('') || '<tr><td colspan="11" class="empty">No shifts yet.</td></tr>'}
  </tbody></table></div>`;
}

/* ---------- employee: meals ---------- */
function vMeals(u) {
  const emp = empOf(u); const t = now(); const today = ymd(t); const per = periodFor(today);
  const mine = state.bookings.filter(b => b.e === emp.id).sort((a, b) => b.d.localeCompare(a.d));
  const upcoming = mine.filter(b => b.d >= today && b.st !== 'CANCELLED');
  const inPer = mine.filter(b => b.per === per.id && (b.st === 'LOCKED' || b.st === 'BOOKED'));
  const date = attendanceDateFor(emp, t);
  const options = []; for (let i = 0; i <= 4; i++) { const d = addDays(date, i); if (rosterStatus(emp, d) === 'EXPECTED') { const mt = mealTypeFor(emp, d); const v = vendorFor(mt); if (v && t < cutoffAt(v, d)) options.push(d); } }
  const sel = params().date && options.includes(params().date) ? params().date : options[0];
  let picker = '<p class="muted">No upcoming meals are open for booking.</p>';
  if (sel) {
    const mt = mealTypeFor(emp, sel); const v = vendorFor(mt); const b = bookingFor(emp.id, sel, mt); const rule = priceRule(mt, sel);
    picker = `<div class="tabs" role="tablist">${options.map(d => `<button role="tab" aria-selected="${d === sel}" data-act="meal-date" data-d="${d}">${fmtDate(d)}</button>`).join('')}</div>
    <div class="spread" style="margin-bottom:12px"><span>${mt === 'LUNCH' ? 'Lunch' : 'Dinner'} from <b>${esc(v.name)}</b>, delivered ${v.slot}</span><span class="muted small">Closes ${fmtDT(cutoffAt(v, sel))}</span></div>
    <div class="row" style="margin-top:4px"><button class="btn ${b && b.st === 'BOOKED' ? '' : 'primary'}" data-act="book" data-e="${emp.id}" data-d="${sel}" data-i="1" aria-pressed="${!!(b && b.st === 'BOOKED')}" ${b && b.st === 'BOOKED' ? 'disabled' : ''}>${b && b.st === 'BOOKED' ? 'Meal booked' : 'Book meal'}</button>
    <button class="btn" data-act="book" data-e="${emp.id}" data-d="${sel}" data-i="" aria-pressed="${!!(b && b.st === 'NO_MEAL')}">${b && b.st === 'NO_MEAL' ? 'No meal (selected)' : 'No meal that day'}</button>${b && b.st === 'BOOKED' ? `<button class="btn danger" data-act="cancel-booking" data-b="${b.id}">Cancel booking</button>` : ''}</div>
    <p class="muted small" style="margin-top:10px">You pay ${kes(rule.es)}, the company ${kes(rule.cs)}. What's served is on this week's menu from ${esc(v.name)}.</p>`;
  }
  return `<div class="pagehead"><div><h1>Meals</h1><p class="muted">Prices are fixed when you book. Your share is deducted from salary at the end of the meal period.</p></div></div>
  <div class="stack" style="--gap:20px">
  <div class="stats"><div><span>Meal period</span><b style="font-size:1rem">${fmtDate(per.starts)} – ${fmtDate(per.ends)}</b></div><div><span>Meals so far</span><b>${inPer.length}</b></div><div><span>Deducted so far</span><b>${kes(inPer.reduce((a, b) => a + b.es, 0))}</b></div><div><span>Upcoming bookings</span><b>${upcoming.filter(b => b.st !== 'NO_MEAL').length}</b></div></div>
  <section class="panel">${picker}</section>
  ${has(u, 'supervisor') ? guestMealForm(u) : ''}
  <section class="stack" style="--gap:10px"><h2>My bookings</h2><div class="tablewrap"><table><thead><tr><th>Date</th><th>Meal</th><th>Vendor</th><th>Status</th><th class="num">Your share</th><th class="num">Company</th></tr></thead><tbody>
  ${mine.slice(0, 30).map(b => `<tr><td>${fmtDate(b.d)}</td><td>${b.mt === 'DINNER' ? 'Dinner' : 'Lunch'}</td><td>${esc(vendorById(b.v)?.name)}</td><td>${{ BOOKED: chip('PRESENT', 'Booked'), LOCKED: chip('COMPLETED', b.d < today ? 'Served' : 'Sent to vendor'), CANCELLED: chip('REST_DAY', 'Cancelled'), NO_MEAL: chip('REST_DAY', 'No meal') }[b.st]}</td><td class="num">${b.es ? kes(b.es) : '—'}</td><td class="num">${b.cs ? kes(b.cs) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No bookings yet. Book from the menu above.</td></tr>'}
  </tbody></table></div></section></div>`;
}
function guestMealForm(u) {
  const t = now(); const d = addDays(ymd(t), 1); if (!priceRule('GUEST', d) || !state.vendors.length) return '';
  return `<section class="panel stack" style="--gap:10px"><h2>Guest or overtime meal</h2><p class="muted small">Charged to the company only (${kes(priceRule('GUEST', d).cs)} per meal). Staff number is not required.</p>
  <form data-form="guest" class="form"><label class="f">Date<input type="date" name="d" value="${d}" min="${ymd(t)}" required></label><label class="f">Meal<select name="mt"><option value="LUNCH">Lunch</option><option value="DINNER">Dinner</option></select></label><label class="f">Guest name or note<input name="g" required maxlength="60"></label><button class="btn">Book guest meal</button></form></section>`;
}
