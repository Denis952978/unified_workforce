const normEmail = e => String(e || '').trim().toLowerCase();
const userByEmail = e => state.users.find(u => u.email === normEmail(e));
function nextStaffNo() { const n = state.employees.reduce((m, e) => Math.max(m, parseInt(e.staff_no, 10) || 0), 0) + 1; return String(n).padStart(3, '0'); }


const tzOptions = () => `<datalist id="tzlist">${allZones().map(z => `<option value="${z}">${z} (${tzLabel(z)})</option>`).join('')}</datalist>`;
const NEEDS_PROJECT = ['employee', 'supervisor', 'project_manager'];
const ROLE_CHOICES = [['employee', 'Employee (labelling)'], ['supervisor', 'Supervisor'], ['project_manager', 'Project Manager'], ['production_manager', 'Production Manager'], ['logistics', 'Logistics'], ['finance', 'Finance'], ['admin', 'Admin'], ['vendor', 'Vendor']];

function makeVendor(name, mt, deadline) {
  const base = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'V';
  let code = base, i = 2; while (state.vendors.some(v => v.code === code)) code = base + i++;
  const v = { id: uid('v_'), code, name, email: '', kra_pin: '', meal_type: mt, deadline: deadline || (mt === 'LUNCH' ? '07:00' : '14:00'), deadline_day: 0, lead_min: 120, slot: mt === 'LUNCH' ? '12:30' : '20:30', active: true };
  state.vendors.push(v); return v;
}
function makeProject(f, prefix = '') {
  const g = k => f.get(prefix + k);
  const tz = g('ptz').trim(); if (!validTz(tz)) throw new ApiError(422, 'INVALID_TIMEZONE', `"${tz}" is not an IANA timezone. Pick one from the list.`);
  const wq = +g('wq'); if (!(wq >= 0 && wq <= 1)) throw new ApiError(422, 'INVALID_WEIGHTS', 'The quantity weight must be between 0 and 1.');
  const p = { id: uid('p_'), name: g('pname').trim(), tz, lb: '', production: true, quality_target: +g('qt') };
  state.projects.push(p);
  state.shiftDefs.push({ id: uid('sd_'), project_id: p.id, name: 'DAY', start: g('dstart'), end: g('dend'), grace: 15 });
  if (g('night')) state.shiftDefs.push({ id: uid('sd_'), project_id: p.id, name: 'NIGHT', start: g('nstart') || '18:00', end: g('nend') || '06:00', grace: 15 });
  const from = '2000-01-01';
  state.targets.push({ p: p.id, task: 'LABEL', uph: +g('tl'), from }, { p: p.id, task: 'REVIEW', uph: +g('tr'), from });
  state.weights[p.id] = { q: wq, ql: Math.round((1 - wq) * 100) / 100 };
  return p;
}

/* ---------- admin: people ---------- */
function peopleView(u) {
  const pending = state.users.filter(x => x.status === 'PENDING');
  const people = state.users.filter(x => x.status !== 'PENDING').sort((a, b) => (empOf(a)?.staff_no || 'zzz').localeCompare(empOf(b)?.staff_no || 'zzz'));
  return `<div class="stack" style="--gap:20px">
  <div class="spread"><p class="muted">Invite your management team (project managers, supervisors, finance, logistics) by email. Each person gets their own link and joins by choosing a password. Project managers then add supervisors and invite their own teams from the Projects page.</p><div class="row"><button class="btn primary" data-act="invite" data-k="management">Invite management</button><button class="btn" data-act="person-new">Add a person</button></div></div>
  <section class="stack" style="--gap:10px"><h2>Waiting for approval</h2>
  ${pending.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Registered</th><th></th></tr></thead><tbody>${pending.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.email)}</td><td>${fmtDT(p.created)}</td><td><button class="btn primary small" data-act="person-open" data-u="${p.id}">Approve</button> <button class="btn small danger" data-act="person-decline" data-u="${p.id}">Decline</button></td></tr>`).join('')}</tbody></table></div>`
  : `<p class="muted">Nobody is waiting. Colleagues who open this page and request access appear here.</p>`}</section>
  <section class="stack" style="--gap:10px"><h2>People</h2><div class="tablewrap"><table><thead><tr><th>Staff no.</th><th>Name</th><th>Email</th><th>Role</th><th>Project</th><th>Shift</th><th>Supervisor</th><th>Rest day</th><th>Status</th><th></th></tr></thead><tbody>
  ${people.map(p => { const e = empOf(p); const a = e ? assignmentOf(e.id) : null; const def = e ? defById(e.shift_id) : null; return `<tr><td>${e ? esc(e.staff_no) : '—'}</td><td>${esc(p.name)}</td><td>${esc(p.email)}</td><td>${esc(roleText(p))}</td><td>${a ? esc(projById(a.project_id).name) : e ? esc(projById(e.project_id).name) : p.vendor_id ? esc(vendorById(p.vendor_id)?.name) : '—'}</td><td>${def ? (def.name === 'NIGHT' ? 'Night ' : 'Day ') + def.start : '—'}</td><td>${a && a.sup ? esc(userById(a.sup)?.name) : '—'}</td><td>${e ? DOWL[e.rest] : '—'}</td><td>${p.status === 'ACTIVE' ? chip('OK', 'Active') : p.status === 'INVITED' ? chip('EXPECTED', 'Invited') : chip('BAD', 'Deactivated')}</td><td><button class="btn small" data-act="person-open" data-u="${p.id}">Edit</button>${p.status === 'INVITED' ? ` <button class="btn small" data-act="invite-show" data-u="${p.id}">Invitation</button>` : ''}${p.id !== u.id && p.status === 'ACTIVE' ? ` <button class="btn small" data-act="pw-reset" data-u="${p.id}">Password reset</button>` : ''}${p.id !== u.id && p.status !== 'INVITED' ? ` <button class="btn small" data-act="person-toggle" data-u="${p.id}">${p.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</button>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div></section></div>`;
}
function personDialog(p) {
  const isNew = !p; if (isNew) p = { id: 'new', name: '', email: '', status: 'NEW', roles: [{ role: 'employee', project_id: null }], employee_id: null, vendor_id: null };
  const e = empOf(p); const a = e ? assignmentOf(e.id) : null; const role = ['PENDING', 'NEW'].includes(p.status) || !p.roles.length ? 'employee' : mainRole(p).role;
  const actor = currentUser(); const admin = isAdmin(actor); const myP = admin ? state.projects : state.projects.filter(x => pmProjects(actor).includes(x.id));
  const choices = admin ? ROLE_CHOICES : ROLE_CHOICES.filter(([k]) => k === 'employee' || k === 'supervisor');
  const sup0 = roleProjects(p, 'supervisor')[0];
  const proj = sup0 || (a ? a.project_id : e ? e.project_id : myP[0]?.id); const sups = state.users.filter(x => x.status !== 'PENDING' && x.status !== 'DISABLED' && x.roles.some(r => r.role === 'supervisor' && myP.some(q => q.id === r.project_id)));
  const pmOf = roleProjects(p, 'project_manager');
  const show = (r, list) => list.includes(r) ? '' : 'hidden';
  return `<form data-person="${p.id}" class="stack" style="--gap:12px"><h2>${isNew ? 'Add a person' : p.status === 'PENDING' ? 'Approve ' + esc(p.name) : 'Edit ' + esc(p.name)}</h2>
  ${isNew ? `${sync.canSearch ? `<div class="stack" style="--gap:6px"><div class="form"><label class="f" style="flex:1 1 220px">Find a colleague<input id="find-q" placeholder="Name" autocomplete="off"></label><button type="button" class="btn" data-act="find">Search</button></div><div id="find-results" class="row"></div></div>` : ''}
  <input type="hidden" name="cid" value="">
  <div class="form"><label class="f" style="flex:1 1 200px">Full name (as on payroll)<input name="name" required maxlength="80"></label><label class="f" style="flex:1 1 200px">Work email<input type="email" name="email" required></label></div>
  <p class="muted small" id="link-note">${sync.canSearch ? 'Pick them from the search to link their Claude account now. If you can\'t find them, enter their details and you\'ll get a join code to give them.' : 'You\'ll get a join code to give them. They enter it the first time they open this page.'}</p>` : `<p class="muted small">${esc(p.email)}${p.status === 'INVITED' ? ', invitation sent, not joined yet' : ''}</p>`}
  <label class="f">Role<select name="role" data-change="role-sel">${choices.map(([k, l]) => `<option value="${k}" ${k === role ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <div data-for="project_manager" ${show(role, ['project_manager'])}><fieldset style="border:1px solid var(--line);border-radius:6px"><legend class="small muted">Projects they manage</legend><div class="row">${state.projects.map(x => `<label class="row small" style="gap:4px"><input type="checkbox" name="pms" value="${x.id}" ${pmOf.includes(x.id) || (!pmOf.length && x.id === proj) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div></fieldset></div>
  <div data-for="employee supervisor" ${show(role, ['employee', 'supervisor'])}><label class="f">Project<select name="project">${myP.map(x => `<option value="${x.id}" ${x.id === proj ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
  <div class="form" data-for="employee supervisor project_manager production_manager logistics finance admin" ${role === 'vendor' ? 'hidden' : ''}>
    <label class="f">Staff no.<input name="staff_no" value="${esc(e ? e.staff_no : nextStaffNo())}" required pattern="[0-9A-Za-z-]{1,12}" style="width:100px"></label>
    <label class="f">Shift<select name="shift">${state.shiftDefs.map(d => `<option value="${d.id}" ${e && e.shift_id === d.id ? 'selected' : ''}>${esc(projById(d.project_id).name)}, ${d.name === 'NIGHT' ? 'night' : 'day'} ${d.start}–${d.end}</option>`).join('')}</select></label>
    <label class="f">Rest day<select name="rest">${DOWL.map((d, i) => `<option value="${i}" ${(e ? e.rest : 0) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label class="f">Type<select name="type"><option value="employee">Employee</option><option value="consultant" ${e && e.type === 'consultant' ? 'selected' : ''}>Consultant</option></select></label></div>
  <div class="form" data-for="employee" ${show(role, ['employee'])}>
    <label class="f">Supervisor<select name="sup"><option value="">None yet</option>${sups.map(s => `<option value="${s.id}" ${a && a.sup === s.id ? 'selected' : ''}>${esc(s.name)} (${esc(roleProjects(s, 'supervisor').map(id => projById(id)?.name).join(', '))})</option>`).join('')}</select></label>
    <label class="f">Labelbox user ID<input name="lb" value="${esc(e && e.labelbox_user_id || '')}" placeholder="optional"></label></div>
  <div class="form" data-for="vendor" ${show(role, ['vendor'])}><label class="f">Vendor<select name="vendor">${state.vendors.map(v => `<option value="${v.id}" ${p.vendor_id === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}<option value="new">New vendor…</option></select></label><label class="f">New vendor name<input name="vname" placeholder="If creating a new vendor"></label><label class="f">Serves<select name="vmt"><option>LUNCH</option><option>DINNER</option></select></label></div>
  <div class="row"><button class="btn primary">${isNew ? 'Add person' : p.status === 'PENDING' ? 'Approve and activate' : 'Save changes'}</button><button type="button" class="btn" data-act="dlg-close">Cancel</button></div></form>`;
}

function savePerson(p, f, actor) {
  const role = f.get('role'); const today = ymd(now()); const prevStatus = p.status;
  if (p.id === actor.id && role !== 'admin') throw new ApiError(409, 'LAST_ADMIN', 'You cannot remove your own admin role.');
  if (!isAdmin(actor)) {
    const mine = pmProjects(actor); if (!mine.length) throw new ApiError(403, 'FORBIDDEN', 'Only admins and project managers can manage people.');
    if (!['employee', 'supervisor'].includes(role)) throw new ApiError(403, 'FORBIDDEN', 'Project managers can add team members and supervisors only.');
    if (!mine.includes(f.get('project'))) throw new ApiError(403, 'NOT_IN_SCOPE', 'You can only add people to projects you manage.');
    if (p.id === actor.id) throw new ApiError(403, 'FORBIDDEN', 'Ask an admin to change your own role.');
    if (!['NEW', 'PENDING'].includes(p.status)) { const e0 = empOf(p); const a0 = e0 ? assignmentOf(e0.id) : null; const inScope = (a0 && mine.includes(a0.project_id)) || roleProjects(p, 'supervisor').some(x => mine.includes(x)); if (!inScope || p.roles.some(r => !['employee', 'supervisor'].includes(r.role))) throw new ApiError(403, 'NOT_IN_SCOPE', 'That person is outside your projects.'); }
  }
  const pms = role === 'project_manager' ? f.getAll('pms') : []; if (role === 'project_manager' && !pms.length) throw new ApiError(422, 'PROJECT_REQUIRED', 'Tick at least one project for this project manager.');
  let e = empOf(p); const cur = e ? assignmentOf(e.id) : null;
  if (role === 'vendor') {
    let vid = f.get('vendor'); if (vid === 'new' || !vid) { const name = (f.get('vname') || '').trim() || p.name; vid = makeVendor(name, f.get('vmt')).id; }
    p.roles = [{ role: 'vendor', project_id: null }]; p.vendor_id = vid;
    if (e) { e.active = false; if (cur) cur.valid_to = today; p.employee_id = null; }
  } else {
    const def = defById(f.get('shift')); if (!def) throw new ApiError(422, 'NO_SHIFT', 'Create a project and shift first.');
    const pid = role === 'project_manager' ? pms[0] : NEEDS_PROJECT.includes(role) ? f.get('project') : def.project_id;
    if (role === 'employee' && def.project_id !== pid) throw new ApiError(422, 'SHIFT_PROJECT_MISMATCH', `Pick a shift that belongs to ${projById(pid).name}.`);
    const no = f.get('staff_no').trim(); if (state.employees.some(x => x.staff_no === no && (!e || x.id !== e.id))) throw new ApiError(409, 'STAFF_NO_TAKEN', `Staff number ${no} is already used.`);
    if (!e) { e = { id: uid('e_'), active: true, skill: null, bot: false }; state.employees.push(e); p.employee_id = e.id; }
    Object.assign(e, { staff_no: no, full_name: p.name, email: p.email, shift_id: def.id, project_id: def.project_id, rest: +f.get('rest'), type: f.get('type'), labelbox_user_id: role === 'employee' ? ((f.get('lb') || '').trim() || null) : null, active: true });
    p.roles = role === 'employee' ? [{ role: 'employee', project_id: null }] : role === 'project_manager' ? [...pms.map(x => ({ role: 'project_manager', project_id: x })), { role: 'employee', project_id: null }] : [{ role, project_id: NEEDS_PROJECT.includes(role) ? pid : null }, { role: 'employee', project_id: null }];
    p.vendor_id = null;
    const sup = role === 'employee' ? (f.get('sup') || null) : null;
    if (role === 'employee') {
      if (!cur || cur.project_id !== pid || cur.sup !== sup) { if (cur) cur.valid_to = today; state.assignments.push({ employee_id: e.id, project_id: pid, sup, valid_from: today, valid_to: null }); }
    } else if (cur) cur.valid_to = today;
    // today's and tomorrow's roster rows follow the new shift if nothing has been recorded yet
    for (const d of [today, addDays(today, 1)]) { const k = e.id + '|' + d; const day = state.days[k]; if (day && !sessionsFor(e.id, d).length && !day.fin) delete state.days[k]; ensureDay(e, d); }
  }
  p.status = prevStatus === 'NEW' ? (p.cid ? 'ACTIVE' : 'INVITED') : prevStatus === 'INVITED' ? 'INVITED' : prevStatus === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
  if (p.status === 'INVITED' && !p.code) p.code = joinCode(); if (empOf(p)) empOf(p).active = p.status === 'ACTIVE'; mem.win.clear(); rebuildIndexes();
  audit(actor, prevStatus === 'NEW' ? 'admin.AccountCreated' : prevStatus === 'PENDING' ? 'admin.AccountApproved' : 'admin.AccountChanged', 'user', p.id, roleText(p));
  if (prevStatus === 'PENDING' || prevStatus === 'NEW') notify([p.id], prevStatus === 'NEW' ? 'Welcome' : 'Your account is approved', `You can now sign in as ${roleText(p)}.${e && role !== 'vendor' ? ` Staff number ${e.staff_no}, ${defById(e.shift_id).name.toLowerCase()} shift ${defById(e.shift_id).start}–${defById(e.shift_id).end}.` : ''}`);
}

Object.assign(CHANGES, {
  'role-sel': el => { const r = el.value; el.closest('form').querySelectorAll('[data-for]').forEach(x => x.hidden = !x.dataset.for.split(' ').includes(r)); }
});


/* ---------- admin: add project / shift / vendor ---------- */
function addProjectForm() {
  const s = (n, l, v, extra = '') => `<label class="f">${l}<input name="${n}" value="${esc(v)}" ${extra}></label>`;
  return `<details class="panel"><summary><b>Add a project</b></summary><form data-form="project-add" class="stack" style="--gap:12px;margin-top:12px">
  <div class="form">${s('pname', 'Project name', '', 'required')}${s('ptz', 'Timezone', COMPANY_TZ, 'list="tzlist" required style="min-width:220px"')}</div>
  <div class="form"><b style="width:70px">Day shift</b>${s('dstart', 'Start', '08:00', 'type="time" required')}${s('dend', 'End', '17:00', 'type="time" required')}<label class="row small"><input type="checkbox" name="night"> Night shift</label>${s('nstart', 'Start', '18:00', 'type="time"')}${s('nend', 'End', '06:00', 'type="time"')}</div>
  <div class="form">${s('tl', 'Labelling target / hr', '900', 'type="number" min="1" required')}${s('tr', 'Review target / hr', '1400', 'type="number" min="1" required')}${s('wq', 'Quantity weight', '0.4', 'type="number" step="0.05" min="0" max="1" style="width:110px"')}${s('qt', 'Quality target %', '98', 'type="number" min="0" max="100" step="0.5" style="width:110px"')}</div>
  <div><button class="btn primary">Add project</button></div></form></details>`;
}
function addShiftForm(p) {
  const has = n => state.shiftDefs.some(d => d.project_id === p.id && d.name === n); const missing = ['DAY', 'NIGHT'].filter(n => !has(n)); if (!missing.length) return '';
  return `<form data-form="shift-add" data-p="${p.id}" class="form"><b>Add ${missing[0] === 'NIGHT' ? 'night' : 'day'} shift</b><input type="hidden" name="name" value="${missing[0]}"><label class="f">Start<input type="time" name="start" value="${missing[0] === 'NIGHT' ? '18:00' : '06:00'}" required></label><label class="f">End<input type="time" name="end" value="${missing[0] === 'NIGHT' ? '06:00' : '15:00'}" required></label><button class="btn small">Add shift</button></form>`;
}
function addVendorForm() {
  return `<section class="panel stack" style="--gap:12px"><h2>Add a vendor</h2><form data-form="vendor-add" class="form"><label class="f">Name<input name="name" required maxlength="60"></label><label class="f">Serves<select name="mt"><option>LUNCH</option><option>DINNER</option></select></label><label class="f">Order deadline<input type="time" name="deadline" value="07:00" required></label><label class="f">Email<input type="email" name="email"></label><button class="btn">Add vendor</button></form>
  <p class="muted small">To give the vendor a portal login, add them as a person with the Vendor role. The weekly menu is agreed with them outside the system.</p></section>`;
}
function sandboxForm(ps) {
  return `<form data-form="sandbox" data-id="${ps.id}" class="stack" style="--gap:8px;border-top:1px dashed var(--line);padding-top:10px">
  <span class="small"><b>Labelbox sandbox.</b> <span class="muted">Enter what Labelbox would report for this shift; in production these numbers come from the Labelbox API.</span></span>
  <div class="form"><label class="f">+ labelled<input type="number" name="l" min="0" value="0" style="width:90px"></label><label class="f">+ reviewed<input type="number" name="r" min="0" value="0" style="width:90px"></label><label class="f">Quality %<input type="number" name="q" min="0" max="100" step="0.1" value="${ps.sbQ == null ? 100 : ps.sbQ}" style="width:80px"></label></div>
  <button class="btn small">Sync counts</button></form>`;
}
Object.assign(FORMS, {
  'project-add': f => act(() => { const u = currentUser(); if (!has(u, 'admin')) throw new ApiError(403, 'FORBIDDEN', 'Admins only.'); const p = makeProject(f); audit(u, 'admin.ProjectAdded', 'project', p.id, p.name); toast(`${p.name} added. Approve or edit people to put them on it.`); }),
  'shift-add': (f, d) => act(() => { const u = currentUser(); const def = { id: uid('sd_'), project_id: d.p, name: f.get('name'), start: f.get('start'), end: f.get('end'), grace: 15 }; state.shiftDefs.push(def); audit(u, 'admin.ShiftAdded', 'shift_definition', def.id, `${def.start}-${def.end}`); toast('Shift added.'); }),
  'vendor-add': f => act(() => { const u = currentUser(); const v = makeVendor(f.get('name').trim(), f.get('mt'), f.get('deadline')); v.email = f.get('email') || ''; audit(u, 'meals.VendorAdded', 'vendor', v.id, v.name); toast(`${v.name} added.`); }),
  sandbox: (f, d) => act(() => { const u = currentUser(); const ps = state.pshifts.find(x => x.id === d.id); if (!ps || ps.e !== u.employee_id) throw new ApiError(403, 'NOT_IN_SCOPE', 'Not your shift.'); if (ps.st !== 'OPEN') throw new ApiError(409, 'SHIFT_CLOSED', 'This shift is already closed.');
    ps.sbL = (ps.sbL || 0) + Math.max(0, Math.floor(+f.get('l') || 0)); ps.sbR = (ps.sbR || 0) + Math.max(0, Math.floor(+f.get('r') || 0)); ps.sbQ = Math.min(100, Math.max(0, +f.get('q'))); labelboxPull(ps, now()); toast(`Synced: ${ps.ul.toLocaleString()} labelled, ${ps.ur.toLocaleString()} reviewed.`); })
});
