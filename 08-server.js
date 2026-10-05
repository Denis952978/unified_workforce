
/* ======================= connection to the UnifiedWorkforce server ======================= */
/* The server is the source of truth: it owns time, sign-in, the network check, invitations and email.
   The app keeps a copy of the company records, applies a change to the latest copy, and sends it back;
   if someone else saved first, the server answers STALE and the change is re-applied to the fresh copy. */
const GROUP_NAMES = ['core', ...Object.keys(GROUPS)];
const sync = { loaded: false, signedIn: false, setupRequired: false, setupTokenRequired: false, memberId: null, email: null, skew: 0,
  net: { ip: null, zone: null, enforce: false }, testControls: false, minPw: 10, raw: {}, revs: {}, busy: 0, queue: Promise.resolve(true),
  autoDone: false, canSearch: false, stream: null, err: null, pollMs: 15000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, opts = {}) {
  const r = await fetch('/api/v1' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new ApiError(r.status, j.code || 'HTTP_' + r.status, j.message || 'The server could not complete that request.'); e.details = j.details || {}; throw e; }
  return j;
}

/* server time and network (these replace the browser's own clock and the test "device" picker) */
function now() { return Date.now() + sync.skew + ((state && state.clockOffset) || 0); }
function netCtx() { return { ip: sync.net.ip || '—', zone: sync.net.zone || (sync.net.enforce ? null : 'any network'), zone_id: null }; }
function canClock() { return sync.testControls && has(currentUser(), 'admin'); }
function save() { try { localStorage.setItem(STORE_KEY + '-prefs', JSON.stringify({ session: { route: local.session.route, params: local.session.params }, tz: local.tz, readAt: local.readAt })); } catch (e) { } }
function loadPrefs() { try { const p = JSON.parse(localStorage.getItem(STORE_KEY + '-prefs') || 'null'); if (p) { local.tz = p.tz || null; local.readAt = p.readAt || {}; if (p.session) Object.assign(local.session, p.session); } } catch (e) { } }

function resolveMember() { const m = sync.memberId ? state.users.find(u => u.id === sync.memberId) : null; local.session.userId = m ? m.id : null; }
function assemble(raw) { const s = blankState(); if (raw.core) Object.assign(s, JSON.parse(raw.core)); for (const g of Object.keys(GROUPS)) if (raw[g]) Object.assign(s, JSON.parse(raw[g])); s.activity = raw.activity ? (JSON.parse(raw.activity).activity || {}) : {}; state = s; rebuildIndexes(); resolveMember(); }

async function loadSession() {
  const s = await api('/session');
  sync.setupRequired = s.setup_required; sync.setupTokenRequired = s.setup_token_required; sync.signedIn = s.signed_in; sync.memberId = s.member_id; sync.email = s.email;
  sync.skew = s.server_time - Date.now(); sync.net = { ip: s.client_ip, zone: s.network_zone, enforce: s.enforce_network }; sync.testControls = s.test_controls; sync.minPw = s.min_password_length; sync.pollMs = (s.poll_seconds || 15) * 1000;
}
async function loadState(names) {
  const r = await api('/state' + (names ? '?groups=' + names.join(',') : ''));
  for (const [n, g] of Object.entries(r.groups)) { if (g.json == null) delete sync.raw[n]; else sync.raw[n] = g.json; sync.revs[n] = g.rev; }
  for (const [n, v] of Object.entries(r.revs)) if (!(n in r.groups) && sync.revs[n] !== v) sync.revs[n] = sync.revs[n] ?? v;
}

function setBusy() { const el = document.querySelector('.saving'); if (el) el.textContent = sync.busy ? 'Saving…' : ''; document.body.classList.toggle('busy', sync.busy > 0); }
async function commit(fn) {
  sync.busy++; setBusy();
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      assemble(sync.raw);
      runJobs(); fn(); prune();
      const out = snapshotGroups(); const groups = {};
      for (const n of GROUP_NAMES) if (out[n] !== sync.raw[n]) groups[n] = out[n];
      if (!Object.keys(groups).length) return;
      try {
        const r = await api('/state/commit', { body: { base: { ...sync.revs }, groups } });
        for (const n of Object.keys(groups)) sync.raw[n] = groups[n]; Object.assign(sync.revs, r.revs); return;
      } catch (e) {
        if (e.code === 'STALE') { await loadState(); await sleep(50 + Math.random() * 200); continue; }
        throw e;
      }
    }
    throw new ApiError(409, 'BUSY', 'Several people are saving at once. Please try again.');
  } catch (e) { assemble(sync.raw); throw e; }
  finally { sync.busy--; setBusy(); }
}
function showErr(e) {
  if (e && e.code === 'NOT_SIGNED_IN') { sync.signedIn = false; render(true); return; }
  if (e instanceof ApiError) toast(`<code>${esc(e.code)}</code> ${esc(e.message)}`, true); else { console.error(e); toast(esc((e && e.message) || String(e)), true); }
}
function run(fn, gate) {
  sync.queue = sync.queue.then(async () => {
    let ok = true;
    try { await commit(() => { const net = gate ? guardNetwork() : netCtx(); fn(net); }); } catch (e) { ok = false; showErr(e); }
    render(true); return ok;
  });
  return sync.queue;
}
const act = fn => run(fn, true);
const actSys = fn => run(fn, false);

/* live updates: every few seconds the app asks which record groups changed, and fetches only those.
   (On Netlify, functions can't hold a connection open, so this replaces a push stream.) */
let _pollTimer = null;
function connectStream() {
  if (_pollTimer) return;
  const tick = async () => {
    if (!sync.signedIn) { _pollTimer = null; return; }
    if (typeof document === 'undefined' || !document.hidden) { try { const r = await api('/state/revs'); await refreshFrom(r.revs); } catch (e) { if (e.code === 'NOT_SIGNED_IN') { sync.signedIn = false; render(true); } } }
    _pollTimer = setTimeout(tick, document.hidden ? Math.max(60000, sync.pollMs * 4) : sync.pollMs);
  };
  _pollTimer = setTimeout(tick, sync.pollMs);
}
let _refreshing = false;
async function refreshFrom(revs) {
  const changed = [...GROUP_NAMES, 'activity'].filter(n => revs[n] !== undefined && revs[n] !== sync.revs[n]); if (!changed.length || _refreshing) return;
  _refreshing = true;
  try { await loadState(changed); if (!sync.busy) { const before = currentUser(); assemble(sync.raw); if (!before && currentUser()) onBecameMember(); render(); } }
  catch (e) { if (e.code === 'NOT_SIGNED_IN') { sync.signedIn = false; render(true); } }
  finally { _refreshing = false; }
}

function onBecameMember() {
  const u = currentUser(); if (!u) return;
  const items = NAV.filter(n => n.show(u)); if (!items.some(n => n.id === route()) && !(route() === 'employee' && isManager(u))) { local.session.route = has(u, 'vendor') ? 'vendor' : u.employee_id ? 'home' : items[0].id; local.session.params = {}; }
  maybeAutoCheckIn();
}
function maybeAutoCheckIn() {
  const u = currentUser(); const emp = empOf(u); if (!u || !emp || !emp.active || sync.autoDone) return; sync.autoDone = true;
  const need = () => { const u2 = currentUser(); const e2 = empOf(u2); if (!e2) return null; const t = now(); const date = attendanceDateFor(e2, t); const w = windowFor(e2, date); const day = getDay(e2.id, date); const st = day ? day.st : rosterStatus(e2, date);
    return w && t >= w.start - state.settings.checkin_lead_hours * HOUR && t < w.end && ['EXPECTED', 'ABSENT'].includes(st) && !sessionsFor(e2.id, date).length && !openSession(e2.id) ? { u2, e2 } : null; };
  if (!need() || !netCtx().zone) return;
  act(net => { const n = need(); if (!n) return; const r = doCheckIn(n.e2, now(), net, 'login', n.u2); toast(`Checked in automatically at ${fmtTime(r.session.in)}. Your first sign-in of the shift counts as check-in.`); });
}

/* ---------- sign-in and first-time setup ---------- */
const box = inner => `<main class="login"><div class="login-card stack" style="max-width:460px;--gap:16px"><div class="brand"><span class="brand-mark" aria-hidden="true">UW</span>${esc((state && state.company && state.company.name) || 'UnifiedWorkforce')}</div>${inner}</div></main>`;
function authView() {
  if (sync.err) return box(`<h1>Can't reach the server</h1><p class="muted">${esc(sync.err.message || '')}. Check your connection and reload.</p>`);
  if (!sync.loaded) return box(`<h1>Loading…</h1>`);
  if (sync.setupRequired) return setupView();
  if (sync.signedIn && !currentUser()) return box(`<h1>No access</h1><p class="muted">Your account isn't active in the company records. Ask an administrator.</p><div><button class="btn" data-act="logout">Sign out</button></div>`);
  const c = netCtx();
  return box(`<h1>Sign in</h1>${!c.zone ? `<div class="note bad small"><b>403 NETWORK_NOT_AUTHORIZED.</b> ${esc(c.ip)} is outside the company network. Connect to the office network or company VPN.</div>` : ''}
  <form data-auth="signin" class="panel stack" style="--gap:12px"><label class="f">Work email<input type="email" name="email" required autocomplete="username"></label>
  <label class="f">Password<input type="password" name="pw" required autocomplete="current-password"></label><button class="btn primary">Sign in</button>
  <p class="muted small">New here? You join through the invitation emailed to you. Forgotten your password? Ask an administrator to send you a reset link.</p></form>`);
}
function setupView() {
  const s = (n, l, v, extra = '') => `<label class="f">${l}<input name="${n}" value="${esc(v)}" ${extra}></label>`;
  return `<main class="login"><form data-auth="setup" class="login-card stack" style="max-width:820px;--gap:18px">${tzOptions()}
  <div class="stack" style="--gap:8px"><div class="brand"><span class="brand-mark" aria-hidden="true">UW</span>UnifiedWorkforce</div>
  <h1>Set up your company</h1><p class="muted">This system is new. Fill in the basics once; you become the first administrator. Everything can be changed later under Admin.</p></div>
  ${sync.setupTokenRequired ? `<section class="panel stack" style="--gap:12px"><h2>Setup code</h2>${s('setupToken', 'Setup code from your IT team', '', 'required autocomplete="off"')}</section>` : ''}
  <section class="panel stack" style="--gap:12px"><h2>Company</h2><div class="form">${s('company', 'Company name', '', 'required maxlength="80" style="min-width:260px"')}${s('ctz', 'Company timezone', 'Africa/Nairobi', 'list="tzlist" required style="min-width:240px"')}</div></section>
  <section class="panel stack" style="--gap:12px"><h2>Office network</h2><div class="form">${s('zname', 'Network name', 'Office LAN', 'required')}${s('cidr', 'Office internet address (CIDR)', sync.net.ip && /^\d+\.\d+\.\d+\.\d+$/.test(sync.net.ip) ? (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(sync.net.ip) ? sync.net.ip.split('.').slice(0, 2).join('.') + '.0.0/16' : sync.net.ip + '/32') : '10.20.0.0/16', 'required pattern="\\d+\\.\\d+\\.\\d+\\.\\d+/\\d+"')}</div>
  <p class="muted small">You're connecting from ${esc(sync.net.ip || 'an unknown address')}. If you're in the office now, keep this. It is your office's public internet address, which is what the system sees. When the network check is switched on (ENFORCE_NETWORK), only this address can use the system; invitation links still work from anywhere. Add more offices later under Admin.</p></section>
  <section class="panel stack" style="--gap:12px"><h2>First project</h2><div class="form">${s('pname', 'Project name', 'Project A', 'required')}${s('ptz', 'Project timezone', 'Africa/Nairobi', 'list="tzlist" required style="min-width:220px"')}</div>
  <div class="form"><b style="width:70px">Day shift</b>${s('dstart', 'Start', '06:00', 'type="time" required')}${s('dend', 'End', '15:00', 'type="time" required')}</div>
  <div class="form"><label class="row small"><input type="checkbox" name="night" checked> Night shift</label>${s('nstart', 'Start', '18:00', 'type="time"')}${s('nend', 'End', '06:00', 'type="time"')}</div>
  <div class="form">${s('tl', 'Labelling target / productive hr', '900', 'type="number" min="1" required')}${s('tr', 'Review target / productive hr', '1400', 'type="number" min="1" required')}${s('wq', 'Quantity weight', '0.4', 'type="number" step="0.05" min="0" max="1" required style="width:110px"')}${s('qt', 'Quality target %', '98', 'type="number" min="0" max="100" step="0.5" required style="width:110px"')}</div></section>
  <section class="panel stack" style="--gap:12px"><h2>Meals</h2>
  <div class="form">${s('lv', 'Lunch vendor', '', 'placeholder="Leave blank to skip"')}${s('ldl', 'Lunch order deadline', '07:00', 'type="time"')}${s('dv', 'Dinner vendor', '', 'placeholder="Leave blank to skip"')}${s('ddl', 'Dinner order deadline', '14:00', 'type="time"')}</div>
  <p class="muted small">Staff book a meal for their next working day; the weekly menu is agreed with the vendor outside the system.</p>
  <div class="form">${s('es', 'Employee share (KES)', '100', 'type="number" min="0" required')}${s('cs', 'Company subsidy (KES)', '150', 'type="number" min="0" required')}</div></section>
  <section class="panel stack" style="--gap:12px"><h2>Your administrator account</h2><div class="form">${s('name', 'Full name (as on payroll)', '', 'required maxlength="80" autocomplete="name"')}${s('email', 'Work email', '', 'type="email" required autocomplete="username"')}<label class="f">Your shift<select name="myshift"><option value="DAY">Day</option><option value="NIGHT">Night</option></select></label></div>
  <div class="form">${s('pw', `Password (at least ${sync.minPw} characters)`, '', `type="password" required minlength="${sync.minPw}" autocomplete="new-password"`)}${s('pw2', 'Confirm password', '', `type="password" required minlength="${sync.minPw}" autocomplete="new-password"`)}</div></section>
  <div><button class="btn primary">Create company</button></div></form></main>`;
}
async function doSetup(f) {
  if (f.get('pw') !== f.get('pw2')) throw new ApiError(422, 'PASSWORD_MISMATCH', 'The two passwords do not match.');
  const ctz = f.get('ctz').trim(); if (!validTz(ctz)) throw new ApiError(422, 'INVALID_TIMEZONE', `"${ctz}" is not an IANA timezone. Pick one from the list.`);
  const cidr = f.get('cidr').trim(); const [ip, bits] = cidr.split('/'); if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.split('.').some(x => +x > 255) || !(+bits >= 0 && +bits <= 32)) throw new ApiError(422, 'INVALID_CIDR', 'Enter a range like 10.20.0.0/16.');
  const t = now(); state = blankState(); state.lastJobRun = t; state.clockOffset = 0;
  state.company = { name: f.get('company').trim(), tz: ctz, created: t }; COMPANY_TZ = ctz;
  if (ctz === 'Africa/Nairobi') state.holidays = KENYA_HOLIDAYS.map(([date, name]) => ({ date, name }));
  state.zones.push({ id: uid('z_'), name: f.get('zname').trim(), cidr, active: true });
  const p = makeProject(f);
  const es = Math.round(+f.get('es') * 100), cs = Math.round(+f.get('cs') * 100);
  state.priceRules.push({ id: uid('pr_'), mt: 'LUNCH', es, cs, from: '2000-01-01', to: null }, { id: uid('pr_'), mt: 'DINNER', es, cs, from: '2000-01-01', to: null }, { id: uid('pr_'), mt: 'GUEST', es: 0, cs: es + cs, from: '2000-01-01', to: null });
  for (const [vk, dk, mt] of [['lv', 'ldl', 'LUNCH'], ['dv', 'ddl', 'DINNER']]) {
    const name = (f.get(vk) || '').trim(); if (!name) continue; makeVendor(name, mt, f.get(dk));
  }
  const def = state.shiftDefs.find(d => d.project_id === p.id && d.name === f.get('myshift')) || state.shiftDefs.find(d => d.project_id === p.id);
  const email = normEmail(f.get('email'));
  const emp = { id: uid('e_'), staff_no: '001', full_name: f.get('name').trim(), email, labelbox_user_id: null, type: 'employee', active: true, shift_id: def.id, project_id: p.id, rest: 0, skill: null, bot: false };
  state.employees.push(emp);
  const u = { id: uid('u_'), cid: null, name: emp.full_name, email, status: 'ACTIVE', roles: [{ role: 'admin', project_id: null }, { role: 'employee', project_id: null }], employee_id: emp.id, vendor_id: null, created: t };
  state.users.push(u); rebuildIndexes();
  audit(u, 'admin.CompanyCreated', 'company', '', state.company.name, sync.net.ip);
  await api('/setup', { body: { email, password: f.get('pw'), memberId: u.id, groups: snapshotGroups(), setupToken: f.get('setupToken') || undefined } });
  local.session = { userId: u.id, route: 'admin', params: { tab: 'people' } }; save();
  await start();
  toast('Company created. Next: invite your management team under People, and create more projects on the Projects page.');
}

/* ---------- invitations, sent by the server ---------- */
async function sendInvites(ids) {
  if (!ids.length) return;
  try {
    const r = await api('/invitations', { body: { memberIds: ids } });
    const names = r.invitations.map(i => esc(userById(i.member_id)?.name || i.email));
    toast(`Invitation${names.length > 1 ? 's' : ''} emailed to ${names.join(', ')}.`);
  } catch (e) { showErr(e); toast(`<code>${esc(e.code || 'ERROR')}</code> The people were added but their invitation email was not sent: ${esc(e.message)} Use “Invitation” next to their name to send it.`, true); }
}
function showInvites(ids) { return sendInvites(ids); }
async function invitationDialog(memberId) {
  const m = userById(memberId); if (!m) return;
  openDialog(`<div class="stack"><h2>Invitation for ${esc(m.name)}</h2><p class="muted">Loading…</p></div>`);
  let inv = null; try { inv = (await api('/invitations?memberIds=' + encodeURIComponent(memberId))).invitations[0] || null; } catch (e) { showErr(e); closeDialog(); return; }
  const status = !inv ? 'Not sent yet' : inv.status === 'PENDING' ? `Sent ${inv.sent_count} time${inv.sent_count > 1 ? 's' : ''}, last on ${fmtDT(Date.parse(inv.last_sent_at))}. The link expires ${fmtDT(Date.parse(inv.expires_at))}.` : inv.status === 'EXPIRED' ? 'The link has expired.' : inv.status === 'REVOKED' ? 'This invitation was cancelled.' : 'Accepted.';
  openDialog(`<div class="stack" style="--gap:12px"><div class="spread"><h2>Invitation for ${esc(m.name)}</h2><button class="btn small" data-act="dlg-close">Close</button></div>
  <p>${esc(m.email)}</p><p class="muted">${esc(status)}</p>
  <div class="row">${!inv || inv.status !== 'PENDING' ? `<button class="btn primary" data-act="inv-send" data-u="${m.id}">${inv ? 'Send a new invitation' : 'Send invitation'}</button>` : `<button class="btn primary" data-act="inv-resend" data-i="${inv.id}">Resend email</button>`}
  <button class="btn danger" data-act="inv-cancel" data-u="${m.id}" data-i="${inv && inv.status === 'PENDING' ? inv.id : ''}">Cancel invitation and remove ${esc(m.name)}</button></div></div>`);
}

/* ---------- downloads and PDF library come from this server ---------- */
function loadPdf() { if (!_pdfLib) _pdfLib = loadScript('/vendor/jspdf.umd.min.js').then(() => loadScript('/vendor/jspdf.plugin.autotable.min.js')).catch(e => { _pdfLib = null; throw e; }); return _pdfLib; }
async function deliver(name, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'application/octet-stream' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function blockedView(e) {
  return `<div class="blocked stack"><p class="code">${e.status} ${esc(e.code)}</p><h1>You're outside the company network</h1><p>${esc(e.message)}</p>
  <p class="muted">Connect to the office network or the company VPN, then reload.</p></div>`;
}
function demoBar() {
  if (!sync.testControls || !currentUser()) return `<span class="saving" aria-live="polite" style="position:fixed;right:12px;bottom:10px"></span>`;
  const tz = displayTz();
  return `<div class="demobar" role="region" aria-label="Test controls"><span class="lbl hide-m">Test clock (TEST_CONTROLS is on)</span><span class="clk" data-clock="${esc(tz)}"></span>
  ${canClock() ? `<button data-act="adv" data-ms="${15 * MIN}">+15 min</button><button data-act="adv" data-ms="${HOUR}">+1 h</button><button data-act="adv" data-ms="${6 * HOUR}" class="hide-m">+6 h</button>
  <select data-change="jump" aria-label="Jump the test clock to"><option value="">Jump to…</option>${jumpTargets().map(([l, at]) => `<option value="${at}">${esc(l)}, ${esc(fmtDT(at, tz))}</option>`).join('')}</select>` : ''}
  <span class="saving" aria-live="polite"></span></div>`;
}

/* ---------- people helpers used by the People and Projects pages ---------- */
function joinCode() { return null; }
function newPersonShell(f) {
  const name = (f.get('name') || '').trim(), email = normEmail(f.get('email'));
  if (!name) throw new ApiError(422, 'NAME_REQUIRED', 'Enter the person\'s name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(422, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (userByEmail(email)) throw new ApiError(409, 'EMAIL_TAKEN', 'Someone with that email is already a member or invited.');
  const p = { id: uid('u_'), cid: null, name, email, status: 'NEW', roles: [], employee_id: null, vendor_id: null, created: now(), code: null, invitedBy: currentUser()?.id };
  state.users.push(p); return p;
}
Object.assign(A, {
  'person-new': () => openDialog(personDialog(null)),
  'person-open': d => openDialog(personDialog(userById(d.u))),
  'person-toggle': d => act(() => { const u = currentUser(); if (!has(u, 'admin')) throw new ApiError(403, 'FORBIDDEN', 'Admins only.'); const p = userById(d.u); p.status = p.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'; const e = empOf(p); if (e) e.active = p.status === 'ACTIVE'; if (p.status === 'DISABLED' && e && openSession(e.id)) doCheckOut(e, now(), netCtx(), 'USER', u); audit(u, p.status === 'ACTIVE' ? 'admin.AccountReactivated' : 'admin.AccountDeactivated', 'user', p.id, p.email); toast(`${esc(p.name)} ${p.status === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`); }),
  'invite-show': d => invitationDialog(d.u),
  'inv-send': d => { closeDialog(); sendInvites([d.u]); },
  'inv-resend': async d => { try { await api(`/invitations/${d.i}/resend`, { body: {} }); toast('Invitation emailed again. The earlier link no longer works.'); closeDialog(); } catch (e) { showErr(e); } },
  'inv-cancel': async d => {
    try { if (d.i) await api(`/invitations/${d.i}/revoke`, { body: {} }); } catch (e) { if (e.code !== 'NOT_PENDING') { showErr(e); return; } }
    closeDialog();
    act(() => { const p = userById(d.u); if (!p || p.status !== 'INVITED') throw new ApiError(409, 'ALREADY_JOINED', 'They have already joined; deactivate them instead.');
      if (p.employee_id) { state.employees = state.employees.filter(e => e.id !== p.employee_id); state.assignments = state.assignments.filter(a => a.employee_id !== p.employee_id); }
      state.users = state.users.filter(u => u.id !== p.id); audit(currentUser(), 'people.InvitationCancelled', 'user', p.id, p.email); toast(`Invitation for ${esc(p.name)} cancelled.`); });
  },
  'pw-reset': async d => { try { await api(`/members/${encodeURIComponent(d.u)}/password-reset`, { body: {} }); toast(`A password reset link was emailed to ${esc(userById(d.u)?.email || '')}.`); } catch (e) { showErr(e); } },
  'pw-open': () => openDialog(`<form data-pw="1" class="stack" style="--gap:12px"><h2>Change password</h2><label class="f">Current password<input type="password" name="cur" required autocomplete="current-password"></label>
    <label class="f">New password (at least ${sync.minPw} characters)<input type="password" name="pw" required minlength="${sync.minPw}" autocomplete="new-password"></label><label class="f">Confirm new password<input type="password" name="pw2" required autocomplete="new-password"></label>
    <div class="row"><button class="btn primary">Save password</button><button type="button" class="btn" data-act="dlg-close">Cancel</button></div></form>`),
  logout: async () => { try { await api('/auth/logout', { body: {} }); } catch (e) { } if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; } sync.signedIn = false; sync.memberId = null; sync.autoDone = false; local.session.userId = null; render(true); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-auth]');
  if (f) { e.preventDefault(); const fd = new FormData(f); const btn = f.querySelector('button.primary'); if (btn) btn.disabled = true;
    (async () => {
      try {
        if (f.dataset.auth === 'setup') await doSetup(fd);
        else { await api('/auth/login', { body: { email: fd.get('email'), password: fd.get('pw') } }); await start(); }
      } catch (er) { showErr(er); } finally { if (btn) btn.disabled = false; }
    })(); return; }
  const pf = e.target.closest('form[data-person]');
  if (pf) { e.preventDefault(); const fd = new FormData(pf); const pid = pf.dataset.person; let invited = null;
    act(() => { invited = null; const actor = currentUser(); if (!isAdmin(actor) && !has(actor, 'project_manager')) throw new ApiError(403, 'FORBIDDEN', 'Only admins and project managers can manage people.'); let p = userById(pid); if (!p) p = newPersonShell(fd); const wasNew = p.status === 'NEW'; savePerson(p, fd, actor);
      if (wasNew) invited = p.id; if (!wasNew) toast(`${esc(p.name)} saved as ${esc(roleText(p))}.`); })
      .then(ok => { if (ok) { closeDialog(); if (invited) sendInvites([invited]); } render(true); }); return; }
  const pw = e.target.closest('form[data-pw]');
  if (pw) { e.preventDefault(); const fd = new FormData(pw);
    if (fd.get('pw') !== fd.get('pw2')) { toast('<code>PASSWORD_MISMATCH</code> The two new passwords do not match.', true); return; }
    api('/auth/password', { body: { current: fd.get('cur'), next: fd.get('pw') } }).then(() => { closeDialog(); toast('Password changed.'); }, showErr); }
});

/* ======================= startup ======================= */
let _tickN = 0;
function heartbeat() {
  tickTimers(); _tickN++;
  // keep the scheduled jobs (absence marking, shift close, meal cut-off, period close) moving while anyone has the app open
  if (_tickN % 20 === 0 && sync.signedIn && currentUser() && !sync.busy && now() - state.lastJobRun > 60000)
    sync.queue = sync.queue.then(() => commit(() => { }).then(() => true, () => false)).then(r => { render(); return r; });
}
async function start() {
  await loadSession();
  if (sync.signedIn) { await loadState(); assemble(sync.raw); connectStream(); if (currentUser()) onBecameMember(); }
  sync.loaded = true; render(true);
}
async function boot() {
  loadPrefs(); state = blankState(); rebuildIndexes(); render(true);
  try { await start(); } catch (e) { sync.err = e; sync.loaded = true; render(true); }
  setInterval(heartbeat, 1000);
}
setTimeout(() => { boot(); }, 0);
