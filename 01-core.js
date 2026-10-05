'use strict';
/* ============================================================
   UnifiedWorkforce — in-browser implementation of the design.
   "Server" functions below own time, network checks and totals;
   UI code only calls them and renders their results.
   ============================================================ */
let COMPANY_TZ = 'Africa/Nairobi';
const MIN = 60000, HOUR = 3600000, DAY = 86400000, STEP = 5 * MIN;
const STORE_KEY = 'uws-shared-v1';
let local = { session: { userId: null, route: 'home', params: {} }, device: { ip: '10.20.4.17' }, tz: null, readAt: {} };
let state = null;
const mem = { openByEmp: new Map(), psIdx: new Map(), bkIdx: new Map(), win: new Map(), flash: null, pendingRender: false };

/* ---------- small utils ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function uid(p = '') { return p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(key) { let t = (hashStr(key) + 0x6D2B79F5) | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const r1 = n => Math.round(n * 10) / 10;
const kes = c => 'KES ' + String(Math.round((c || 0) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

/* ---------- time (server stores UTC ms; displays in chosen IANA zone) ---------- */
const _dtf = {}; const _offc = new Map();
function partsIntl(ms, tz) {
  const f = _dtf[tz] || (_dtf[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value; return o;
}
function tzOffset(ms, tz) {
  const b = Math.floor(ms / (15 * MIN)); const k = tz + b; let off = _offc.get(k);
  if (off === undefined) { const at = b * 15 * MIN; const p = partsIntl(at, tz); off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - at; if (_offc.size > 50000) _offc.clear(); _offc.set(k, off); }
  return off;
}
const pad2 = n => String(n).padStart(2, '0');
function parts(ms, tz) { const d = new Date(ms + tzOffset(ms, tz)); return { year: String(d.getUTCFullYear()), month: pad2(d.getUTCMonth() + 1), day: pad2(d.getUTCDate()), hour: pad2(d.getUTCHours()), minute: pad2(d.getUTCMinutes()), second: pad2(d.getUTCSeconds()) }; }
const _zmemo = new Map();
function zoned(date, time, tz) {
  const key = date + time + tz; const hit = _zmemo.get(key); if (hit !== undefined) return hit;
  if (_zmemo.size > 20000) _zmemo.clear();
  const v = zonedRaw(date, time, tz); _zmemo.set(key, v); return v;
}
function zonedRaw(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm); const off = tzOffset(guess, tz); let t = guess - off;
  const off2 = tzOffset(t, tz); if (off2 !== off) t = guess - off2; return t;
}
function ymd(ms, tz = COMPANY_TZ) { return new Date(ms + tzOffset(ms, tz)).toISOString().slice(0, 10); }
const _adm = new Map();
function addDays(date, n) { const k = date + n; let v = _adm.get(k); if (v === undefined) { const [y, m, d] = date.split('-').map(Number); v = new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); if (_adm.size > 20000) _adm.clear(); _adm.set(k, v); } return v; }
function weekday(date) { return new Date(date + 'T00:00:00Z').getUTCDay(); }
function now() { return Date.now() + state.clockOffset; }
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(date, long) { const [y, m, d] = date.split('-').map(Number); return long ? `${DOWL[weekday(date)]} ${String(d).padStart(2, '0')} ${MONL[m - 1]} ${y}` : `${DOW[weekday(date)]} ${String(d).padStart(2, '0')} ${MON[m - 1]}`; }
function fmtTime(ms, tz) { if (!ms) return '—'; const p = parts(ms, tz || displayTz()); return `${p.hour}:${p.minute}`; }
function fmtDT(ms, tz) { if (!ms) return '—'; const t = tz || displayTz(); return fmtDate(ymd(ms, t)) + ', ' + fmtTime(ms, t); }
function fmtDur(sec, withS) { sec = Math.max(0, Math.round(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return withS ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` : `${h}h ${String(m).padStart(2, '0')}m`; }
function tzLabel(tz, at) { const off = tzOffset(at || Date.now(), tz) / MIN; const s = off < 0 ? '-' : '+'; const a = Math.abs(off); return `UTC${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`; }
let _zones = null;
function allZones() { if (_zones) return _zones; try { _zones = Intl.supportedValuesOf('timeZone'); } catch (e) { _zones = [COMPANY_TZ, 'UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata']; } if (!_zones.includes('UTC')) _zones = ['UTC', ..._zones]; return _zones; }
function validTz(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (e) { return false; } }

/* ---------- lookups ---------- */
const empById = id => state.employees.find(e => e.id === id);
const userById = id => state.users.find(u => u.id === id);
const projById = id => state.projects.find(p => p.id === id);
const defById = id => state.shiftDefs.find(d => d.id === id);
const vendorById = id => state.vendors.find(v => v.id === id);
const itemById = id => state.menu.find(m => m.id === id);
const empOf = u => u && u.employee_id ? empById(u.employee_id) : null;
const userOfEmp = eid => state.users.find(u => u.employee_id === eid);
const has = (u, role) => !!u && u.roles.some(r => r.role === role);
const roleProjects = (u, role) => u.roles.filter(r => r.role === role).map(r => r.project_id);
const isLabeler = emp => !!emp && state.assignments.some(a => a.employee_id === emp.id && !a.valid_to);
const assignmentOf = eid => state.assignments.find(a => a.employee_id === eid && !a.valid_to);
function displayTz() { const u = currentUser(); if (local.tz) return local.tz; const e = empOf(u); if (e) return projById(e.project_id).tz; return COMPANY_TZ; }
function currentUser() { if (!state || !local.session.userId) return null; const u = userById(local.session.userId); return u && u.status === 'ACTIVE' ? u : null; }

/* ---------- network gate ---------- */
const ipInt = ip => ip.split('.').reduce((a, b) => a * 256 + (+b), 0);
function inCidr(ip, cidr) { const [base, bits] = cidr.split('/'); const b = +bits; const mask = b === 0 ? 0 : (0xFFFFFFFF << (32 - b)) >>> 0; return ((ipInt(ip) & mask) >>> 0) === ((ipInt(base) & mask) >>> 0); }
function netCtx(ip = local.device.ip) { const z = state.zones.find(z => z.active && inCidr(ip, z.cidr)); return { ip, zone: z ? z.name : null, zone_id: z ? z.id : null }; }
function guardNetwork() { const c = netCtx(); if (!c.zone) throw new ApiError(403, 'NETWORK_NOT_AUTHORIZED', `Requests from ${c.ip} are outside the company network allowlist. Connect to the office network or company VPN.`); return c; }

/* ---------- shifts, roster ---------- */
function shiftDefFor(emp, date) { return defById(state.shiftAssign[emp.id + '|' + date] || emp.shift_id); }
function windowFor(emp, date) {
  const def = shiftDefFor(emp, date); if (!def) return null; const p = projById(def.project_id);
  const k = def.id + def.start + def.end + p.tz + date; let w = mem.win.get(k);
  if (!w) { const start = zoned(date, def.start, p.tz); const end = zoned(def.end <= def.start ? addDays(date, 1) : date, def.end, p.tz); w = { start, end }; mem.win.set(k, w); }
  return { start: w.start, end: w.end, def, project: p };
}
function defWindow(def, date) { const p = projById(def.project_id); return { start: zoned(date, def.start, p.tz), end: zoned(def.end <= def.start ? addDays(date, 1) : date, def.end, p.tz) }; }
const projTz = emp => projById(emp.project_id).tz;
function onLeave(eid, date) { return state.leave.some(l => l.e === eid && l.status === 'APPROVED' && l.start <= date && l.end >= date); }
function rosterStatus(emp, date) {
  if (state.holidays.some(h => h.date === date)) return 'HOLIDAY';
  if (onLeave(emp.id, date)) return 'LEAVE';
  if (weekday(date) === emp.rest) return 'REST_DAY';
  return 'EXPECTED';
}
const SCHEDULED = new Set(['EXPECTED', 'PRESENT', 'COMPLETED', 'ABSENT', 'LEAVE']);
function getDay(eid, date) { return state.days[eid + '|' + date]; }
function ensureDay(emp, date) {
  const k = emp.id + '|' + date; let d = state.days[k];
  if (!d) { const def = shiftDefFor(emp, date); d = { e: emp.id, d: date, p: def ? def.project_id : emp.project_id, st: rosterStatus(emp, date), fi: null, lo: null, ps: 0, late: false, fin: null }; state.days[k] = d; }
  return d;
}
function attendanceDateFor(emp, t) {
  const today = ymd(t, projTz(emp)); const lead = state.settings.checkin_lead_hours * HOUR, grace = state.settings.autoclose_grace_hours * HOUR;
  for (const d of [today, addDays(today, -1)]) {
    const w = windowFor(emp, d); if (!w) continue;
    if (t >= w.start - lead && t < w.end + grace && (d === today || rosterStatus(emp, d) !== 'REST_DAY')) return d;
  }
  return today;
}

/* ---------- indexes ---------- */
function rebuildIndexes() {
  if (state.company && state.company.tz) COMPANY_TZ = state.company.tz;
  mem.openByEmp.clear(); mem.psIdx.clear(); mem.bkIdx.clear();
  for (const s of state.sessions) if (!s.out) mem.openByEmp.set(s.e, s);
  for (const p of state.pshifts) mem.psIdx.set(p.e + '|' + p.d, p);
  for (const b of state.bookings) if (b.e) mem.bkIdx.set(b.e + '|' + b.d + '|' + b.mt, b);
}
const openSession = eid => mem.openByEmp.get(eid) || null;
function sessionsFor(eid, date) { const out = []; for (let i = state.sessions.length - 1; i >= 0; i--) { const s = state.sessions[i]; if (s.e === eid && s.d === date) out.push(s); if (s.d < addDays(date, -3)) break; } return out.reverse(); }
const pshiftFor = (eid, date) => mem.psIdx.get(eid + '|' + date) || null;

/* ---------- events (outbox + consumers) ---------- */
const listeners = new Set();
function emit(type, payload, o = {}) {
  const emp = o.emp; const a = emp ? assignmentOf(emp.id) : null;
  const ev = {
    event_id: uid('ev_'), seq: ++state.seq, type, version: 1, occurred_at: iso(o.t || now()),
    actor: o.actor ? { user_id: o.actor.id, kind: o.actor.roles[0].role } : { user_id: null, kind: o.kind || 'system' },
    subject: emp ? { employee_id: emp.id, staff_no: emp.staff_no } : (o.subject || {}),
    scope: { project_id: emp ? (a ? a.project_id : emp.project_id) : (o.project_id || null), supervisor_ids: a && a.sup ? [a.sup] : [] },
    context: o.ctx ? { source_ip: o.ctx.ip, network_zone: o.ctx.zone } : {},
    payload, published_at: iso(o.t || now())
  };
  state.outbox.push(ev); if (state.outbox.length > 300) state.outbox.splice(0, state.outbox.length - 240);
  // consumer: audit log (permanent in production; capped in this demo store)
  state.audit.push({ at: o.t || now(), actor: o.actor ? o.actor.id : 'system', action: type, entity: emp ? 'employee' : (o.entity || '—'), entity_id: emp ? emp.staff_no : (o.entity_id || ''), ip: o.ctx ? o.ctx.ip : null, detail: o.detail || '' });
  if (state.audit.length > 460) state.audit.splice(0, state.audit.length - 400);
  if (!state.quiet && emp) mem.flash = { e: emp.id, at: Date.now() };
  if (!state.quiet) listeners.forEach(fn => { try { fn(ev); } catch (e) { } });
  return ev;
}
function notify(userIds, subject, body, t) {
  if (state.quiet) return;
  for (const id of new Set(userIds.filter(Boolean))) state.notifications.push({ id: uid('n_'), u: id, subject, body, at: t || now(), status: 'SENT', ch: 'email' });
  if (state.notifications.length > 320) state.notifications.splice(0, state.notifications.length - 260);
}
const usersWithRole = (role, pid) => state.users.filter(u => u.roles.some(r => r.role === role && (pid === undefined || r.project_id == null || r.project_id === pid))).map(u => u.id);
function audit(actor, action, entity, entity_id, detail, ip) { state.audit.push({ at: now(), actor: actor ? actor.id : 'system', action, entity, entity_id, detail, ip: ip || null }); }

/* ---------- attendance ---------- */
function doCheckIn(emp, t, ctx, via, actor) {
  const open = openSession(emp.id); if (open) return { existing: true, session: open };
  const date = attendanceDateFor(emp, t); const day = ensureDay(emp, date); const w = windowFor(emp, date);
  const s = { id: uid('s_'), e: emp.id, d: date, in: t, out: null, dur: null, ip: ctx.ip, z: ctx.zone, oip: null, cr: null, via };
  state.sessions.push(s); mem.openByEmp.set(emp.id, s);
  if (!day.fi) { day.fi = t; day.late = !!(w && t > w.start + w.def.grace * MIN); }
  day.st = 'PRESENT';
  emit('attendance.EmployeeCheckedIn', { session_id: s.id, attendance_date: date, check_in_at: iso(t), via, is_late: day.late }, { t, emp, ctx, actor, kind: 'employee' });
  return { existing: false, session: s };
}
function doCheckOut(emp, t, ctx, reason = 'USER', actor) {
  const s = openSession(emp.id); if (!s) throw new ApiError(409, 'NO_OPEN_SESSION', 'There is no open attendance session to close.');
  s.out = Math.max(t, s.in + 1000); s.dur = Math.round((s.out - s.in) / 1000); s.oip = ctx.ip; s.cr = reason; mem.openByEmp.delete(emp.id);
  recalcDay(emp.id, s.d);
  emit(reason === 'AUTO_CLOSED' ? 'attendance.AttendanceSessionAutoClosed' : 'attendance.EmployeeCheckedOut',
    { session_id: s.id, attendance_date: s.d, check_out_at: iso(s.out), duration_seconds: s.dur, close_reason: reason }, { t, emp, ctx, actor, kind: reason === 'AUTO_CLOSED' ? 'system' : 'employee' });
  return s;
}
function recalcDay(eid, date) {
  const emp = empById(eid); const day = ensureDay(emp, date); const ss = sessionsFor(eid, date);
  day.ps = ss.reduce((a, s) => a + (s.dur || 0), 0);
  day.fi = ss.length ? Math.min(...ss.map(s => s.in)) : null;
  const closed = ss.filter(s => s.out); day.lo = closed.length ? Math.max(...closed.map(s => s.out)) : null;
  if (ss.some(s => !s.out)) day.st = 'PRESENT'; else if (ss.length) day.st = 'COMPLETED';
  else if (day.st === 'PRESENT' || day.st === 'COMPLETED') day.st = rosterStatus(emp, date);
  const w = windowFor(emp, date); if (day.fi && w) day.late = day.fi > w.start + w.def.grace * MIN;
}

/* ---------- productivity ---------- */
function targetFor(pid, task, date) { const ts = state.targets.filter(x => x.p === pid && x.task === task && x.from <= date).sort((a, b) => b.from.localeCompare(a.from)); return ts.length ? ts[0].uph : (task === 'LABEL' ? 900 : 1400); }
function weightsFor(pid) { return state.weights[pid] || { q: 0.5, ql: 0.5 }; }
function startProduction(emp, t, ctx, actor) {
  const date = attendanceDateFor(emp, t); const w = windowFor(emp, date);
  if (!w || t < w.start || t >= w.end || rosterStatus(emp, date) !== 'EXPECTED') throw new ApiError(409, 'NO_ACTIVE_SHIFT', 'You have no rostered shift running right now, so production time is not being recorded.');
  let ps = pshiftFor(emp.id, date);
  if (ps && ps.st !== 'OPEN') throw new ApiError(409, 'SHIFT_CLOSED', 'This shift has already been closed.');
  if (!ps) {
    const a = assignmentOf(emp.id);
    ps = { id: uid('ps_'), e: emp.id, p: a ? a.project_id : emp.project_id, d: date, sid: w.def.id, start: t, closed: null, prod: 0, ls: 0, rs: 0, ul: 0, ur: 0, qual: null, sync: t, st: 'OPEN', m: null, r: null, meal: false };
    state.pshifts.push(ps); mem.psIdx.set(emp.id + '|' + date, ps);
    emit('productivity.ProductionSessionStarted', { production_shift_id: ps.id, shift_date: date, tool: 'labelbox' }, { t, emp, ctx, actor, kind: 'extension' });
  }
  return ps;
}
function labelboxPull(ps, t) {
  // Test build: counts come from the Labelbox sandbox panel (in production, the Labelbox API read from the watermark).
  const emp = empById(ps.e); const act = activityFor(ps.e, ps.d);
  if (act) { ps.ls = act.ls; ps.rs = act.rs; ps.prod = act.ls + act.rs; } // time and items measured by the browser extension
  ps.ul = (act ? act.ul : 0) + (ps.sbL || 0); ps.ur = (act ? act.ur : 0) + (ps.sbR || 0);
  ps.qual = (ps.ul + ps.ur) > 0 ? (ps.sbQ == null ? 100 : ps.sbQ) : null; ps.sync = t;
  state.watermarks[ps.p + '|' + (emp.labelbox_user_id || emp.id)] = t;
}
function computeMetrics(ps) {
  const lh = ps.ls / 3600, rh = ps.rs / 3600; const tl = targetFor(ps.p, 'LABEL', ps.d), tr = targetFor(ps.p, 'REVIEW', ps.d);
  const rows = [];
  const R4 = n => Math.round(n * 1e4) / 1e4;
  if (lh > 0) rows.push({ task: 'LABEL', units: ps.ul, hours: R4(lh), rate: r1(ps.ul / lh), target: tl, qty: r1(ps.ul / lh / tl * 100) });
  if (rh > 0) rows.push({ task: 'REVIEW', units: ps.ur, hours: R4(rh), rate: r1(ps.ur / rh), target: tr, qty: r1(ps.ur / rh / tr * 100) });
  const th = lh + rh; const qty = th > 0 ? rows.reduce((a, r) => a + r.qty * r.hours, 0) / th : 0;
  const w = weightsFor(ps.p); const qual = ps.qual == null ? 0 : ps.qual;
  const rating = Math.min(state.settings.rating_cap, qty * w.q + qual * w.ql);
  return { rows, qty: r1(qty), qual: ps.qual, rating: r1(rating), below: r1(qty) < 100 };
}
function activityFor(e, d) { return (state.activity || {})[e + '|' + d] || null; }
/** Current figures for a shift: final once closed, otherwise including the extension's latest report. */
function liveMetrics(ps) { if (ps.m) return ps.m; if (activityFor(ps.e, ps.d)) { const tmp = { ...ps }; const w = state.watermarks; labelboxPull(tmp, ps.sync); state.watermarks = w; return computeMetrics(tmp); } return computeMetrics(ps); }
function prodSeconds(ps) { const a = ps.st === 'OPEN' ? activityFor(ps.e, ps.d) : null; return a ? a.ls + a.rs : ps.prod; }
function workingNow(eid, ps) { const a = ps ? activityFor(eid, ps.d) : null; if (a) return a.state === 'active' && a.lastBeat && now() - a.lastBeat < 3 * MIN; return !!(state.ext[eid] && state.ext[eid].state === 'active'); }
function closeProductionShift(ps, t) {
  labelboxPull(ps, t); ps.closed = t; ps.m = computeMetrics(ps);
  ps.st = ps.m.below ? 'AWAITING_REASON' : 'SUBMITTED';
  const emp = empById(ps.e); if (state.ext[ps.e]) state.ext[ps.e].state = 'closed';
  emit('productivity.ProductionShiftClosed', { production_shift_id: ps.id, shift_date: ps.d, productive_seconds: Math.round(ps.prod), quantity_pct: ps.m.qty, quality_pct: ps.m.qual, rating_pct: ps.m.rating, below_target: ps.m.below }, { t, emp });
  if (!ps.m.below) submitReport(ps, t, null);
}
function submitReport(ps, t, reason, actor) {
  ps.r = reason ? { cat: reason.cat, text: reason.text || '', at: t, auto: !!reason.auto } : { cat: null, text: '', at: t, auto: false };
  ps.st = 'SUBMITTED'; const emp = empById(ps.e); const u = userOfEmp(emp.id); const a = assignmentOf(emp.id);
  emit('productivity.ShiftReportSubmitted', { production_shift_id: ps.id, shift_date: ps.d, rating_pct: ps.m.rating, below_target: ps.m.below, reason_category: ps.r.cat, auto_submitted: ps.r.auto }, { t, emp, actor });
  const lines = ps.m.rows.map(r => `${r.task === 'LABEL' ? 'Labelling' : 'Review'}: ${r.units.toLocaleString()} annotations in ${fmtDur(r.hours * 3600)} = ${Math.round(r.rate)}/hr vs target ${r.target}/hr (${r1(r.qty)}%)`).join('\n');
  notify([u && u.id], `Shift report: ${fmtDate(ps.d)} (${ps.m.rating}% rating)`, `${lines || 'No productive time recorded.'}\nQuality: ${ps.m.qual ?? '—'}%\nRating: ${ps.m.rating}%${ps.r.cat ? `\nReason: ${REASONS[ps.r.cat] || ps.r.cat}${ps.r.text ? ' — ' + ps.r.text : ''}` : ''}`, t);
  if (ps.m.below && a) notify([a.sup], `Below target: ${emp.full_name} (${emp.staff_no}) ${ps.m.qty}%`, `${emp.full_name} closed ${fmtDate(ps.d)} at ${ps.m.qty}% of quantity target.\nReason: ${REASONS[ps.r.cat] || ps.r.cat}${ps.r.text ? ' — ' + ps.r.text : ''}`, t);
}
const REASONS = { TOOLING: 'Tooling down', INSTRUCTIONS: 'Unclear instructions', LONG_TASKS: 'Long tasks', TRAINING: 'Training', OTHER: 'Other', NONE: 'No reason given' };

/* ---------- meals ---------- */
function mealTypeFor(emp, date) { const def = shiftDefFor(emp, date); return def && def.name === 'NIGHT' ? 'DINNER' : 'LUNCH'; }
function vendorFor(mt) { return state.vendors.find(v => v.active && v.meal_type === mt) || null; }
function cutoffAt(v, date) { return zoned(addDays(date, v.deadline_day), v.deadline, COMPANY_TZ) - v.lead_min * MIN; }
function menuFor(v, date) { const items = state.menu.filter(m => m.v === v.id && m.active); if (items.length <= 3) return items; const k = Math.floor(new Date(date + 'T00:00:00Z').getTime() / DAY); return [0, 1, 2].map(i => items[(k + i * 2) % items.length]).filter((x, i, a) => a.indexOf(x) === i); }
function priceRule(mt, date) { return state.priceRules.filter(r => r.mt === mt && r.from <= date && (!r.to || r.to >= date)).sort((a, b) => b.from.localeCompare(a.from))[0]; }
function periodBounds(date) { const [y, m, d] = date.split('-').map(Number); let ey = y, em = m; if (d >= 25) { em = m + 1; if (em > 12) { em = 1; ey++; } } const ends = `${ey}-${String(em).padStart(2, '0')}-24`; let sy = ey, sm = em - 1; if (sm < 1) { sm = 12; sy--; } const starts = `${sy}-${String(sm).padStart(2, '0')}-25`; return { id: `P-${ey}-${String(em).padStart(2, '0')}`, starts, ends }; }
function periodFor(date) { const b = periodBounds(date); if (!state.periods[b.id]) state.periods[b.id] = { ...b, status: 'OPEN', closed_at: null }; return state.periods[b.id]; }
function nextMealDate(emp, afterDate) { for (let i = 1; i <= 7; i++) { const d = addDays(afterDate, i); if (rosterStatus(emp, d) === 'EXPECTED') return d; } return null; }
const bookingFor = (eid, date, mt) => mem.bkIdx.get(eid + '|' + date + '|' + mt) || null;
/** Books a meal for that day (`book` true) or records "no meal" (`book` false). The weekly menu is shared outside the system. */
function bookMeal(emp, date, book, t, ctx, actor) {
  const mt = mealTypeFor(emp, date); const v = vendorFor(mt);
  if (!v) throw new ApiError(409, 'NO_VENDOR', 'No vendor is serving this meal yet.');
  if (onLeave(emp.id, date)) throw new ApiError(409, 'ON_LEAVE', 'You are on approved leave that day.');
  const c = cutoffAt(v, date); if (t >= c) throw new ApiError(409, 'BOOKING_CUTOFF_PASSED', `Bookings for ${fmtDate(date)} closed at ${fmtDT(c)}.`);
  const per = periodFor(date); if (per.status === 'CLOSED') throw new ApiError(409, 'PERIOD_LOCKED', 'That meal period is closed.');
  let b = bookingFor(emp.id, date, mt); const rule = priceRule(mt, date);
  if (b && b.st === 'LOCKED') throw new ApiError(409, 'BOOKING_CUTOFF_PASSED', 'That order has already gone to the vendor.');
  if (!b) { b = { id: uid('b_'), e: emp.id, d: date, mt }; state.bookings.push(b); mem.bkIdx.set(emp.id + '|' + date + '|' + mt, b); }
  Object.assign(b, { item: null, v: v.id, es: book ? rule.es : 0, cs: book ? rule.cs : 0, st: book ? 'BOOKED' : 'NO_MEAL', at: t, per: per.id, col: null });
  if (book) {
    const meal = mt === 'LUNCH' ? 'Lunch' : 'Dinner';
    emit('meals.MealBooked', { booking_id: b.id, meal_date: date, meal_type: mt, vendor_id: v.id, employee_share_cents: b.es, company_share_cents: b.cs }, { t, emp, ctx, actor });
    const u = userOfEmp(emp.id); notify([u && u.id], `Meal booked: ${fmtDate(date)}`, `${meal} from ${v.name}, ${fmtDate(date, true)}.\nYour share: ${kes(b.es)} (deducted from salary). Company subsidy: ${kes(b.cs)}.\nYou can cancel until ${fmtDT(c, COMPANY_TZ)} (${COMPANY_TZ}).`, t);
  }
  return b;
}
function cancelBooking(b, t, ctx, actor, why) {
  const v = vendorById(b.v); if (b.st !== 'BOOKED') throw new ApiError(409, 'NOT_CANCELLABLE', 'Only open bookings can be cancelled.');
  if (t >= cutoffAt(v, b.d)) throw new ApiError(409, 'BOOKING_CUTOFF_PASSED', 'The cut-off has passed; the vendor is already preparing this meal.');
  b.st = 'CANCELLED'; b.at = t;
  emit('meals.MealBookingCancelled', { booking_id: b.id, meal_date: b.d, reason: why || 'EMPLOYEE' }, { t, emp: b.e ? empById(b.e) : null, ctx, actor, entity: 'booking', entity_id: b.id });
}
function dispatchOrder(v, date, t) {
  const bs = state.bookings.filter(b => b.v === v.id && b.d === date && b.st === 'BOOKED');
  bs.forEach(b => b.st = 'LOCKED');
  const all = state.bookings.filter(b => b.v === v.id && b.d === date && b.st === 'LOCKED');
  const byShift = {}; all.forEach(b => { const sh = b.g ? 'GUEST' : (shiftDefFor(empById(b.e), date)?.name || 'DAY'); byShift[sh] = (byShift[sh] || 0) + 1; });
  const o = { id: uid('o_'), v: v.id, d: date, slot: v.slot, at: t, total: all.reduce((a, b) => a + b.es + b.cs, 0), meals: all.length, lines: [], staff: all.map(b => b.g ? 'GUEST' : empById(b.e).staff_no).sort(), shifts: byShift, site: 'HQ' };
  state.orders.push(o);
  emit('meals.VendorOrderDispatched', { order_id: o.id, vendor_id: v.id, meal_date: date, meals: all.length, total_cents: o.total }, { t, entity: 'vendor_order', entity_id: o.id, subject: { vendor_id: v.id } });
  if (all.length) notify([...state.users.filter(u => u.vendor_id === v.id).map(u => u.id), ...usersWithRole('logistics')], `Order: ${v.name}, ${fmtDate(date)} (${all.length} meals)`, `${all.length} meals, delivery ${v.slot} at HQ.\n` + Object.entries(byShift).map(([k, n]) => `${k === 'GUEST' ? 'Guests' : k === 'NIGHT' ? 'Night shift' : 'Day shift'}: ${n}`).join('\n') + `\nStaff numbers: ${o.staff.join(', ')}`, t);
  return o;
}
function closePeriod(per, t) {
  const bs = state.bookings.filter(b => b.per === per.id && (b.st === 'LOCKED' || b.st === 'BOOKED'));
  bs.forEach(b => b.st = 'LOCKED');
  for (const v of state.vendors) {
    const vb = bs.filter(b => b.v === v.id); if (!vb.length) continue;
    const inv = { id: uid('inv_'), v: v.id, per: per.id, no: `INV-${v.code}-${per.id.slice(2)}`, et: vb.reduce((a, b) => a + b.es, 0), ct: vb.reduce((a, b) => a + b.cs, 0), gt: 0, etims: null, etimsAmt: null, at: t, n: vb.length, lines: vb.map(b => [b.d, b.g ? 'GUEST' : empById(b.e).staff_no, b.es, b.cs]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])) };
    inv.gt = inv.et + inv.ct; state.invoices = state.invoices.filter(i => !(i.v === v.id && i.per === per.id)); state.invoices.push(inv);
  }
  state.deductions = state.deductions.filter(d => d.per !== per.id);
  const byEmp = {}; bs.filter(b => b.e).forEach(b => { byEmp[b.e] = byEmp[b.e] || { e: b.e, per: per.id, n: 0, amt: 0 }; byEmp[b.e].n++; byEmp[b.e].amt += b.es; });
  state.deductions.push(...Object.values(byEmp));
  per.status = 'CLOSED'; per.closed_at = t;
  emit('meals.MealPeriodClosed', { period_id: per.id, starts_on: per.starts, ends_on: per.ends, meals: bs.length }, { t, entity: 'meal_period', entity_id: per.id });
  const tot = state.invoices.filter(i => i.per === per.id).reduce((a, i) => a + i.gt, 0);
  notify([...usersWithRole('finance'), ...usersWithRole('logistics')], `Meal period closed: ${fmtDate(per.starts)} – ${fmtDate(per.ends)}`, `Invoices, finance report, logistics report and payroll deduction file are ready.\nMeals: ${bs.length}\nTotal payable to vendors: ${kes(tot)}`, t);
  for (const inv of state.invoices.filter(i => i.per === per.id)) notify(state.users.filter(u => u.vendor_id === inv.v).map(u => u.id), `Invoice ${inv.no}`, `Final statement for ${fmtDate(per.starts)} – ${fmtDate(per.ends)}: ${inv.n} meals, ${kes(inv.gt)}.\nPlease enter your KRA eTIMS invoice number in the vendor portal.`, t);
}

/* ---------- leave & adjustments ---------- */
function approveLeave(emp, start, end, type, actor, t) {
  const l = { id: uid('l_'), e: emp.id, start, end, type, status: 'APPROVED', by: actor ? actor.id : null, at: t };
  state.leave.push(l);
  for (let d = start; d <= end; d = addDays(d, 1)) { const day = ensureDay(emp, d); if (!sessionsFor(emp.id, d).length) day.st = rosterStatus(emp, d); }
  let cancelled = 0;
  state.bookings.filter(b => b.e === emp.id && b.d >= start && b.d <= end && b.st === 'BOOKED').forEach(b => { try { cancelBooking(b, t, null, actor, 'LEAVE'); cancelled++; } catch (e) { } });
  emit('leave.LeaveApproved', { leave_id: l.id, start_date: start, end_date: end, type, meals_auto_cancelled: cancelled }, { t, emp, actor });
  return l;
}
function cancelLeave(l, actor, t) {
  l.status = 'CANCELLED'; const emp = empById(l.e);
  for (let d = l.start; d <= l.end; d = addDays(d, 1)) { const day = state.days[emp.id + '|' + d]; if (day && day.st === 'LEAVE') day.st = rosterStatus(emp, d); }
  emit('leave.LeaveCancelled', { leave_id: l.id }, { t, emp, actor });
}
function applyAdjustment(adj, actor, t) {
  const s = state.sessions.find(x => x.id === adj.sid); if (!s) throw new ApiError(404, 'NOT_FOUND', 'Session not found.');
  const nv = adj.nv;
  if (adj.field === 'check_in_at') { if (s.out && nv >= s.out) throw new ApiError(422, 'INVALID_TIME', 'Check-in must be before check-out.'); s.in = nv; }
  else { if (nv <= s.in) throw new ApiError(422, 'INVALID_TIME', 'Check-out must be after check-in.'); if (!s.out) mem.openByEmp.delete(s.e); s.out = nv; s.cr = s.cr || 'ADJUSTED'; }
  if (s.out) s.dur = Math.round((s.out - s.in) / 1000);
  adj.status = 'APPROVED'; adj.by = actor.id; adj.at2 = t;
  recalcDay(s.e, s.d);
  emit('attendance.AttendanceAdjusted', { adjustment_id: adj.id, session_id: s.id, field: adj.field, old_value: iso(adj.ov), new_value: iso(nv), reason: adj.reason }, { t, emp: empById(s.e), actor });
}

/* ---------- scope resolver ---------- */
function visibleEmpIds(u) {
  const out = new Set(); if (!u) return out;
  if (has(u, 'admin')) { state.employees.forEach(e => out.add(e.id)); return out; }
  if (has(u, 'production_manager')) state.assignments.filter(a => !a.valid_to && projById(a.project_id).production).forEach(a => out.add(a.employee_id));
  const pmP = roleProjects(u, 'project_manager'); state.assignments.filter(a => !a.valid_to && pmP.includes(a.project_id)).forEach(a => out.add(a.employee_id));
  if (has(u, 'supervisor')) state.assignments.filter(a => !a.valid_to && a.sup === u.id).forEach(a => out.add(a.employee_id));
  if (u.employee_id) out.add(u.employee_id);
  return out;
}
function canSee(u, eid) { return visibleEmpIds(u).has(eid); }
function teamFor(u, pid) { const vis = visibleEmpIds(u); return state.assignments.filter(a => !a.valid_to && vis.has(a.employee_id) && (!pid || a.project_id === pid)).map(a => empById(a.employee_id)).filter(e => e && e.active && (userOfEmp(e.id) || {}).status !== 'INVITED'); }
function teamProjects(u) { const ids = new Set(teamFor(u).map(e => assignmentOf(e.id).project_id)); return state.projects.filter(p => ids.has(p.id)); }
const isManager = u => ['supervisor', 'project_manager', 'production_manager', 'admin'].some(r => has(u, r));
