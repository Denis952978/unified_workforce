
/* ============ scheduler: the eight jobs + simulated colleagues ============ */
function runJobs(target) {
  target = target || now(); let t = state.lastJobRun; if (target <= t) return;
  while (t < target) { const t1 = Math.min(target, Math.floor(t / STEP) * STEP + STEP); tick(t, t1); t = t1; }
  state.lastJobRun = target;
}
function tick(t0, t1) {
  const today = ymd(t1); const dates = [addDays(today, -1), today];
  // 1. Daily roster (00:00): EXPECTED / REST DAY / HOLIDAY / LEAVE rows
  if (state.jobs.roster !== today) { for (const e of state.employees) if (e.active) { ensureDay(e, today); ensureDay(e, addDays(today, 1)); } state.jobs.roster = today; state.jobs.last.roster = t1; }
  // the browser extension reported "Start labeling": open the production shift
  for (const a of Object.values(state.activity || {})) {
    if (pshiftFor(a.e, a.d) || !dates.includes(a.d)) continue; const emp = empById(a.e); if (!emp || !emp.active) continue;
    const w = windowFor(emp, a.d); if (!w || t1 < w.start || a.startedAt >= w.end) continue;
    try { startProduction(emp, Math.max(a.startedAt, w.start), { ip: 'browser extension', zone: 'Labelbox' }); } catch (e) { }
  }
  // heartbeats → productive seconds (only while the Labelbox tab is focused and the user is active)
  for (const ps of state.pshifts.slice(-60)) {
    if (ps.st !== 'OPEN') continue; if (activityFor(ps.e, ps.d)) continue; const ex = state.ext[ps.e]; if (!ex || ex.state !== 'active') continue;
    const emp = empById(ps.e); const w = windowFor(emp, ps.d); const a = Math.max(t0, w.start, ps.start), b = Math.min(t1, w.end);
    if (b > a) { const sec = (b - a) / 1000; if (ex.task === 'REVIEW') ps.rs += sec; else ps.ls += sec; ps.prod += sec; ex.beats = (ex.beats || 0) + sec / 60; ex.last = b; }
  }
  // 4. Labelbox sync every 5 min during shifts (from the watermark)
  if (Math.floor(t1 / STEP) !== Math.floor(t0 / STEP) || t1 % STEP === 0) { for (const ps of state.pshifts.slice(-60)) if (ps.st === 'OPEN') labelboxPull(ps, t1); state.jobs.last.sync = t1; }
  // 5. Shift close at each shift end
  for (const ps of state.pshifts.slice(-60)) if (ps.st === 'OPEN') { const w = windowFor(empById(ps.e), ps.d); if (t1 >= w.end) { closeProductionShift(ps, w.end); state.jobs.last.close = t1; } }
  // reason timeout (12h) → "No reason given", flagged
  const rt = state.settings.reason_timeout_hours * HOUR;
  for (const ps of state.pshifts.slice(-60)) if (ps.st === 'AWAITING_REASON' && t1 >= ps.closed + rt) submitReport(ps, ps.closed + rt, { cat: 'NONE', text: '', auto: true });
  // 3. Auto-close forgotten sessions at shift end + grace
  const grace = state.settings.autoclose_grace_hours * HOUR;
  for (const s of [...mem.openByEmp.values()]) {
    const emp = empById(s.e); const w = windowFor(emp, s.d); const limit = w && w.end > s.in ? w.end + grace : s.in + 12 * HOUR;
    if (t1 >= limit) {
      const at = w && w.end > s.in ? w.end : s.in + 10 * HOUR; doCheckOut(emp, at, { ip: 'server', zone: 'scheduler' }, 'AUTO_CLOSED');
      const a = assignmentOf(emp.id); const u = userOfEmp(emp.id);
      notify([u && u.id, a && a.sup], `Session auto-closed: ${emp.full_name}, ${fmtDate(s.d)}`, `No check-out was recorded. The session was closed at the scheduled shift end (${fmtDT(at, COMPANY_TZ)}, ${COMPANY_TZ}) and flagged AUTO_CLOSED. A supervisor can file a correction with a reason.`, t1);
      state.jobs.last.autoclose = t1;
    }
  }
  // 2. Absence finalisation (shift start + finalisation period) and day finalisation
  const fin = state.settings.finalisation_hours * HOUR;
  for (const e of state.employees) { if (!e.active) continue; for (const d of dates) {
    const day = state.days[e.id + '|' + d]; if (!day || day.fin) continue; const w = windowFor(e, d); if (!w) continue;
    if (day.st === 'EXPECTED' && t1 >= w.start + fin) { day.st = 'ABSENT'; day.fin = t1; emit('attendance.AttendanceDayFinalized', { attendance_date: d, status: 'ABSENT' }, { t: t1, emp: e }); state.jobs.last.finalise = t1; }
    else if (day.st === 'COMPLETED' && t1 >= w.end + grace) { day.fin = t1; emit('attendance.AttendanceDayFinalized', { attendance_date: d, status: 'COMPLETED', presence_seconds: day.ps }, { t: t1, emp: e }); }
  } }
  // 6. Daily production summary (each shift close + 30 min) to PM and Production Manager
  for (const def of state.shiftDefs) for (const d of dates) {
    const key = def.id + '|' + d; if (state.jobs.summaries[key]) continue; const w = defWindow(def, d);
    if (t1 < w.end + 30 * MIN || t0 > w.end + 6 * HOUR) continue;
    const pss = state.pshifts.filter(p => p.d === d && p.sid === def.id && p.st !== 'OPEN'); state.jobs.summaries[key] = t1;
    if (!pss.length) continue; const p = projById(def.project_id);
    const avg = k => r1(pss.reduce((a, x) => a + (x.m[k] || 0), 0) / pss.length);
    notify([...usersWithRole('project_manager', p.id).filter(id => roleProjects(userById(id), 'project_manager').includes(p.id)), ...usersWithRole('production_manager')],
      `Daily summary: ${p.name} ${def.name.toLowerCase()} shift, ${fmtDate(d)}`,
      `${pss.length} staff closed the shift.\nAnnotations labelled: ${pss.reduce((a, x) => a + x.ul, 0).toLocaleString()}\nAnnotations reviewed: ${pss.reduce((a, x) => a + x.ur, 0).toLocaleString()}\nProduction hours: ${fmtDur(pss.reduce((a, x) => a + x.prod, 0))}\nAverage quantity: ${avg('qty')}%  Average rating: ${avg('rating')}%\nBelow target: ${pss.filter(x => x.m.below).length}`, t1);
    state.jobs.last.summary = t1;
  }
  // 7. Meal cut-off per vendor
  for (const v of state.vendors) { if (!v.active) continue; for (let i = -1; i <= 2; i++) { const d = addDays(today, i); const c = cutoffAt(v, d); if (t1 >= c && !state.orders.some(o => o.v === v.id && o.d === d)) { dispatchOrder(v, d, c); state.jobs.last.cutoff = t1; } } }
  // 8. Meal period close (24th, 23:59)
  for (const d of dates) { const per = periodFor(d); if (per.status === 'OPEN' && t1 >= zoned(per.ends, '23:59', COMPANY_TZ)) { closePeriod(per, zoned(per.ends, '23:59', COMPANY_TZ)); state.jobs.last.period = t1; } }
}

/* ============ blank system ============ */
const KENYA_HOLIDAYS = [['2026-01-01', "New Year's Day"], ['2026-04-03', 'Good Friday'], ['2026-04-06', 'Easter Monday'], ['2026-05-01', 'Labour Day'], ['2026-06-01', 'Madaraka Day'], ['2026-10-10', 'Mazingira Day'], ['2026-10-20', 'Mashujaa Day'], ['2026-12-12', 'Jamhuri Day'], ['2026-12-25', 'Christmas Day'], ['2026-12-26', 'Boxing Day']];
function blankState() {
  return {
    v: 4, clockOffset: 0, lastJobRun: Date.now(), seq: 0, quiet: false, savedAt: 0,
    company: { name: '', tz: 'Africa/Nairobi', created: null },
    settings: { finalisation_hours: 4, autoclose_grace_hours: 2, reason_timeout_hours: 12, rating_cap: 100, checkin_lead_hours: 2, idle_minutes: 5, meal_reminder_minutes: 30 },
    projects: [], shiftDefs: [], shiftAssign: {}, employees: [], users: [], assignments: [], zones: [], holidays: [],
    statuses: [
      { code: 'EXPECTED', label: 'Not checked in', present: false }, { code: 'PRESENT', label: 'Present', present: true },
      { code: 'COMPLETED', label: 'Checked out', present: true }, { code: 'LEAVE', label: 'Leave', present: false },
      { code: 'ABSENT', label: 'Absent', present: false }, { code: 'REST_DAY', label: 'Rest day', present: false }, { code: 'HOLIDAY', label: 'Holiday', present: false }],
    leave: [], days: {}, sessions: [], adjustments: [], targets: [], weights: {}, pshifts: [], ext: {}, watermarks: {},
    vendors: [], menu: [], priceRules: [], periods: {}, bookings: [], orders: [], invoices: [], deductions: [],
    outbox: [], audit: [], notifications: [], perfHistory: {}, jobs: { roster: null, summaries: {}, last: {} }
  };
}

/* ============ persistence: per-person store (db), with a local copy ============ */
const GROUPS = { days: ['days'], sessions: ['sessions', 'adjustments', 'leave'], prod: ['pshifts', 'watermarks', 'ext'], bookings: ['bookings'], mealdocs: ['orders', 'invoices', 'deductions', 'periods'], outbox: ['outbox'], notes: ['audit', 'notifications'] };
const grouped = new Set([...Object.values(GROUPS).flat(), 'activity']);
var prune = function () {
  const cut = addDays(ymd(now()), -50);
  for (const k of Object.keys(state.days)) if (state.days[k].d < cut) delete state.days[k];
  state.sessions = state.sessions.filter(s => s.d >= cut || !s.out);
  state.pshifts = state.pshifts.filter(p => p.d >= addDays(cut, 8) || p.st !== 'SUBMITTED');
  state.pshifts.forEach(p => { p.ls = Math.round(p.ls); p.rs = Math.round(p.rs); p.prod = Math.round(p.prod); });
  const keepPer = new Set(Object.values(state.periods).sort((a, b) => b.ends.localeCompare(a.ends)).slice(0, 2).map(p => p.id));
  state.bookings = state.bookings.filter(b => keepPer.has(b.per) || b.st === 'BOOKED');
  state.orders = state.orders.filter(o => o.d >= cut);
  rebuildIndexes();
};
function snapshotGroups() {
  const out = {}; const core = {};
  for (const k of Object.keys(state)) if (!grouped.has(k)) core[k] = state[k];
  out.core = JSON.stringify(core);
  for (const [g, keys] of Object.entries(GROUPS)) { const o = {}; keys.forEach(k => o[k] = state[k]); out[g] = JSON.stringify(o); }
  return out;
}
function fromGroups(snap) { const s = blankState(); if (snap.core) Object.assign(s, JSON.parse(snap.core)); for (const g of Object.keys(GROUPS)) if (snap[g]) Object.assign(s, JSON.parse(snap[g])); return s; }
