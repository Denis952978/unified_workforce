
/* ======================= projects, invitations, ranking, exports ======================= */
const isAdmin = u => has(u, 'admin');
const pmProjects = u => u ? roleProjects(u, 'project_manager') : [];
const canRank = u => has(u, 'project_manager') || has(u, 'supervisor');
const usersInRole = (role, pid) => state.users.filter(x => x.status !== 'PENDING' && x.roles.some(r => r.role === role && r.project_id === pid));
const teamUsers = pid => state.assignments.filter(a => !a.valid_to && a.project_id === pid).map(a => userOfEmp(a.employee_id)).filter(Boolean);
function pendingFor(u) { return (isAdmin(u) || has(u, 'project_manager')) ? state.users.filter(x => x.status === 'PENDING') : []; }
function statusChip(p) { return p.status === 'ACTIVE' ? chip('OK', 'Active') : p.status === 'INVITED' ? chip('EXPECTED', 'Invited') : p.status === 'PENDING' ? chip('EXPECTED', 'Waiting') : chip('BAD', 'Deactivated'); }
const ROLE_PLAIN = { employee: 'team member', supervisor: 'supervisor', project_manager: 'project manager', production_manager: 'production manager', logistics: 'logistics', finance: 'finance', admin: 'admin' };

/* ---------- Projects page (admin: all projects; project manager: their own) ---------- */
function vProjects(u) {
  const projs = isAdmin(u) ? state.projects : state.projects.filter(p => pmProjects(u).includes(p.id));
  const pending = pendingFor(u);
  const row = (p, roleLbl, extra = '') => `<tr><td>${roleLbl}</td><td>${empOf(p) ? esc(empOf(p).staff_no) : '—'}</td><td>${esc(p.name)}</td><td>${esc(p.email)}</td><td>${statusChip(p)}</td><td>${p.status === 'INVITED' ? `<button class="btn small" data-act="invite-show" data-u="${p.id}">Invitation</button> ` : ''}${extra}</td></tr>`;
  return `<div class="pagehead"><div><h1>Projects</h1><p class="muted">${isAdmin(u) ? 'Create projects and give each one its project managers. Project managers add supervisors and invite their teams.' : 'Add supervisors and invite your team. People join individually from the invitation sent to their email.'}</p></div></div>
  <div class="stack" style="--gap:22px">
  ${pending.length ? `<section class="panel stack" style="--gap:10px;border-color:var(--warn)"><h2>Waiting for approval</h2><p class="muted small">People who opened the page and asked to join.</p><div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Note</th><th>Asked</th><th></th></tr></thead><tbody>${pending.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.email)}</td><td class="wrap small">${esc(p.note || '')}</td><td>${fmtDT(p.created)}</td><td><button class="btn primary small" data-act="person-open" data-u="${p.id}">Approve</button> <button class="btn small danger" data-act="person-decline" data-u="${p.id}">Decline</button></td></tr>`).join('')}</tbody></table></div></section>` : ''}
  ${projs.map(p => {
    const pms = usersInRole('project_manager', p.id), sups = usersInRole('supervisor', p.id), team = teamUsers(p.id);
    const shifts = state.shiftDefs.filter(d => d.project_id === p.id).map(d => `${d.name === 'NIGHT' ? 'Night' : 'Day'} ${d.start}–${d.end}`).join(', ');
    const canMng = isAdmin(u) || pmProjects(u).includes(p.id);
    return `<section class="panel stack" style="--gap:14px"><div class="spread"><div><h2>${esc(p.name)}</h2><p class="muted small">${esc(shifts || 'No shifts yet')}. ${esc(p.tz)}. Targets ${targetFor(p.id, 'LABEL', ymd(now()))} labelled / ${targetFor(p.id, 'REVIEW', ymd(now()))} reviewed per hour, quality ${p.quality_target}%.</p></div>
      <div class="row">${isAdmin(u) ? `<button class="btn" data-act="invite" data-k="project_manager" data-p="${p.id}">Add project manager</button>` : ''}${canMng ? `<button class="btn" data-act="invite" data-k="supervisor" data-p="${p.id}">Add supervisor</button><button class="btn primary" data-act="invite" data-k="employee" data-p="${p.id}">Invite team members</button>` : ''}</div></div>
      <div class="stats"><div><span>Team members</span><b>${team.filter(x => x.status === 'ACTIVE').length}</b></div><div><span>Invited, not joined</span><b>${team.filter(x => x.status === 'INVITED').length}</b></div><div><span>Supervisors</span><b>${sups.length}</b></div><div><span>Project managers</span><b>${pms.length}</b></div></div>
      <h3>Management</h3><div class="tablewrap"><table><thead><tr><th>Role</th><th>Staff no.</th><th>Name</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>
      ${[...pms.map(x => row(x, 'Project manager', isAdmin(u) ? `<button class="btn small" data-act="person-open" data-u="${x.id}">Edit</button>` : '')), ...sups.map(x => row(x, 'Supervisor', canMng ? `<button class="btn small" data-act="person-open" data-u="${x.id}">Edit</button>` : ''))].join('') || '<tr><td colspan="6" class="empty">No managers yet.</td></tr>'}</tbody></table></div>
      <div class="spread"><h3>Team</h3><div class="row"><button class="btn small" data-act="export" data-k="project-team" data-p="${p.id}" data-f="csv">CSV</button><button class="btn small" data-act="export" data-k="project-team" data-p="${p.id}" data-f="pdf">PDF</button></div></div>
      <div class="tablewrap"><table><thead><tr><th>Staff no.</th><th>Name</th><th>Email</th><th>Shift</th><th>Supervisor</th><th>Status</th><th></th></tr></thead><tbody>
      ${team.sort((a, b) => empOf(a).staff_no.localeCompare(empOf(b).staff_no)).map(x => { const e = empOf(x); const a = assignmentOf(e.id); const d = defById(e.shift_id); return `<tr><td>${esc(e.staff_no)}</td><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${d ? (d.name === 'NIGHT' ? 'Night ' : 'Day ') + d.start : '—'}</td><td>${a && a.sup ? esc(userById(a.sup)?.name) : '<span class="muted">None</span>'}</td><td>${statusChip(x)}</td><td>${x.status === 'INVITED' ? `<button class="btn small" data-act="invite-show" data-u="${x.id}">Invitation</button> ` : ''}${canMng ? `<button class="btn small" data-act="person-open" data-u="${x.id}">Edit</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">No team yet. Use “Invite team members”.</td></tr>'}</tbody></table></div>
    </section>`; }).join('') || '<p class="empty">You don\'t manage any projects yet. An admin assigns projects to project managers.</p>'}
  ${isAdmin(u) ? addProjectForm() : ''}</div>`;
}

/* ---------- invitations ---------- */
function inviteDialog(kind, pid) {
  const actor = currentUser(); const p = pid ? projById(pid) : null;
  const titles = { employee: `Invite team members to ${p ? p.name : ''}`, supervisor: `Add a supervisor to ${p ? p.name : ''}`, project_manager: `Add a project manager to ${p ? p.name : ''}`, management: 'Invite management' };
  const shifts = p ? state.shiftDefs.filter(d => d.project_id === p.id) : state.shiftDefs;
  const existing = kind === 'supervisor' || kind === 'project_manager' ? state.users.filter(x => x.status === 'ACTIVE' && !has(x, 'vendor') && !x.roles.some(r => r.role === kind && r.project_id === pid) && (isAdmin(actor) || (kind === 'supervisor' && (() => { const e = empOf(x); const a = e ? assignmentOf(e.id) : null; return a && a.project_id === pid; })()))) : [];
  return `<form data-invite="${kind}" data-p="${pid || ''}" class="stack" style="--gap:12px"><h2>${esc(titles[kind])}</h2>
  ${kind === 'management' ? `<div class="form"><label class="f">Role<select name="role">${[['project_manager', 'Project manager'], ['supervisor', 'Supervisor'], ['production_manager', 'Production manager'], ['logistics', 'Logistics'], ['finance', 'Finance'], ['admin', 'Admin']].map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="f">Project (for project managers and supervisors)<select name="project">${state.projects.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label></div>` : ''}
  ${kind === 'employee' ? `<div class="form"><label class="f">Shift<select name="shift">${shifts.map(d => `<option value="${d.id}">${d.name === 'NIGHT' ? 'Night' : 'Day'} ${d.start}–${d.end}</option>`).join('')}</select></label><label class="f">Supervisor<select name="sup"><option value="">None yet</option>${usersInRole('supervisor', pid).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><label class="f">Rest day<select name="rest">${DOWL.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></label></div>` : ''}
  ${existing.length ? `<label class="f">Someone already in the company<select name="existing"><option value="">— Invite someone new instead —</option>${existing.map(x => `<option value="${x.id}">${esc(x.name)}${empOf(x) ? ' (' + esc(empOf(x).staff_no) + ')' : ''}</option>`).join('')}</select></label><p class="muted small">Or invite new people:</p>` : ''}
  <label class="f">${kind === 'employee' ? 'Team members' : 'People'}, one per line: full name, work email<textarea name="people" style="min-height:120px" placeholder="Mary Wanjiku, mary.wanjiku@company.co.ke&#10;Peter Otieno, peter.otieno@company.co.ke"></textarea></label>
  <p class="muted small">Each person is emailed their own invitation link. They join individually by opening it and choosing a password${kind === 'employee' ? '; they appear on your team as soon as they do' : ''}.</p>
  <div class="row"><button class="btn primary">Send invitations</button><button type="button" class="btn" data-act="dlg-close">Cancel</button></div></form>`;
}
function parsePeople(text) {
  const out = []; const seen = new Set();
  String(text || '').split('\n').map(l => l.trim()).filter(Boolean).forEach((l, i) => {
    const m = l.match(/^(.*?)[,;\t]\s*([^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+)\s*$/) || l.match(/^(.*?)\s*<([^>]+@[^>]+)>\s*$/);
    if (!m || !m[1].trim()) throw new ApiError(422, 'INVALID_LINE', `Line ${i + 1} ("${l.slice(0, 40)}") needs a name and an email, like: Mary Wanjiku, mary@company.co.ke`);
    const email = normEmail(m[2]); if (seen.has(email)) throw new ApiError(422, 'DUPLICATE_EMAIL', `${email} is listed twice.`); seen.add(email);
    if (userByEmail(email)) throw new ApiError(409, 'EMAIL_TAKEN', `${email} is already in the company or already invited.`);
    out.push({ name: m[1].trim().replace(/^["']|["']$/g, '').slice(0, 80), email });
  });
  return out;
}
function defaultShift(pid) { return state.shiftDefs.find(d => d.project_id === pid && d.name === 'DAY') || state.shiftDefs.find(d => d.project_id === pid) || state.shiftDefs[0]; }
function createInvite(o, actor) {
  const def = defById(o.shift) || defaultShift(o.pid); if (!def) throw new ApiError(422, 'NO_SHIFT', 'Create a project with a shift first.');
  const e = { id: uid('e_'), staff_no: nextStaffNo(), full_name: o.name, email: o.email, labelbox_user_id: null, type: 'employee', active: false, shift_id: def.id, project_id: def.project_id, rest: o.rest >= 0 && o.rest <= 6 ? o.rest : 0, skill: null, bot: false };
  state.employees.push(e);
  const roles = o.role === 'employee' ? [{ role: 'employee', project_id: null }] : [{ role: o.role, project_id: NEEDS_PROJECT.includes(o.role) ? o.pid : null }, { role: 'employee', project_id: null }];
  const u = { id: uid('u_'), cid: null, name: o.name, email: o.email, status: 'INVITED', roles, employee_id: e.id, vendor_id: null, created: now(), code: joinCode(), invitedBy: actor.id };
  state.users.push(u);
  if (o.role === 'employee') state.assignments.push({ employee_id: e.id, project_id: o.pid, sup: o.sup || null, valid_from: ymd(now()), valid_to: null });
  audit(actor, 'people.Invited', 'user', u.id, `${ROLE_PLAIN[o.role]} ${o.email}${o.pid ? ' to ' + projById(o.pid).name : ''}`);
  return u;
}
function assignExisting(x, role, pid, actor) {
  const e = empOf(x); const a = e ? assignmentOf(e.id) : null; const today = ymd(now());
  if (role === 'supervisor') x.roles = x.roles.filter(r => r.role !== 'supervisor');
  if (!x.roles.some(r => r.role === role && r.project_id === pid)) x.roles.unshift({ role, project_id: pid });
  if (!x.roles.some(r => r.role === 'employee')) x.roles.push({ role: 'employee', project_id: null });
  if (a) a.valid_to = today; // managers are no longer counted as labelling team members
  audit(actor, 'people.RoleAssigned', 'user', x.id, `${ROLE_PLAIN[role]} of ${projById(pid).name}`);
  notify([x.id], `You're now ${ROLE_PLAIN[role]} of ${projById(pid).name}`, `${actor.name} gave you ${ROLE_PLAIN[role]} access to ${projById(pid).name}.`);
}
function inviteText(x) {
  const r = mainRole(x); const proj = r.project_id ? ' on ' + projById(r.project_id).name : (() => { const e = empOf(x); const a = e ? assignmentOf(e.id) : null; return a ? ' on ' + projById(a.project_id).name : ''; })();
  const by = userById(x.invitedBy);
  const subject = `You're invited to ${state.company.name}`;
  const body = `Hi ${x.name},\n\n${by ? by.name : 'Your manager'} has invited you to join ${state.company.name} as ${ROLE_PLAIN[r.role] || 'a member'}${proj}.\n\n1. Open this link: ${PAGE_URL}\n2. Sign in to Claude with your work account if asked.\n3. Enter your personal join code: ${x.code}\n\nYour attendance, shift reports and meal bookings are all in one place once you've joined.\n`;
  return { subject, body };
}
function showInvites(ids) {
  const us = ids.map(userById).filter(x => x && x.status === 'INVITED'); if (!us.length) return;
  const all = us.map(x => { const t = inviteText(x); return `To: ${x.email}\nSubject: ${t.subject}\n\n${t.body}`; }).join('\n------------------------------\n\n');
  openDialog(`<div class="stack" style="--gap:12px"><div class="spread"><h2>${us.length === 1 ? 'Invitation ready' : us.length + ' invitations ready'}</h2><button class="btn small" data-act="dlg-close">Done</button></div>
  <p class="muted small">This test build can't send email itself, so send each invitation from your own mailbox: use “Email” to open it in your mail app, or copy the text. Each person also needs access to this page: the owner shares it with them (or with the whole organization) as a Contributor.</p>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Join code</th><th></th></tr></thead><tbody>${us.map(x => { const t = inviteText(x); return `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td><b>${esc(x.code)}</b></td><td><a class="btn small primary" target="_blank" rel="noopener" href="mailto:${encodeURIComponent(x.email)}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}">Email</a></td></tr>`; }).join('')}</tbody></table></div>
  <label class="f">All invitations<textarea id="invite-text" readonly style="min-height:160px;font-size:.8rem">${esc(all)}</textarea></label>
  <div class="row"><button class="btn" data-act="copy-invites">Copy all</button></div></div>`);
}

/* ---------- performance history (kept after daily records are trimmed) ---------- */
function histAdd(e, p, ym, k, v) { const key = `${e}|${p}|${ym}`; const h = state.perfHistory[key] || (state.perfHistory[key] = { e, p, ym, shifts: 0, rating: 0, qty: 0, qual: 0, qualN: 0, below: 0, noReason: 0, prod: 0, sched: 0, present: 0, leave: 0 }); h[k] += v; }
function foldShift(ps) { if (!ps.m) return; const ym = ps.d.slice(0, 7); histAdd(ps.e, ps.p, ym, 'shifts', 1); histAdd(ps.e, ps.p, ym, 'rating', ps.m.rating); histAdd(ps.e, ps.p, ym, 'qty', ps.m.qty); if (ps.m.qual != null) { histAdd(ps.e, ps.p, ym, 'qual', ps.m.qual); histAdd(ps.e, ps.p, ym, 'qualN', 1); } if (ps.m.below) histAdd(ps.e, ps.p, ym, 'below', 1); if (ps.r && ps.r.auto) histAdd(ps.e, ps.p, ym, 'noReason', 1); histAdd(ps.e, ps.p, ym, 'prod', ps.prod || 0); }
function foldDay(d) { const ym = d.d.slice(0, 7); if (SCHEDULED.has(d.st)) histAdd(d.e, d.p, ym, 'sched', 1); if (d.st === 'PRESENT' || d.st === 'COMPLETED') histAdd(d.e, d.p, ym, 'present', 1); if (d.st === 'LEAVE') histAdd(d.e, d.p, ym, 'leave', 1); }
const _prune = prune;
prune = function () {
  if (!state.perfHistory) state.perfHistory = {};
  const cut = addDays(ymd(now()), -50);
  for (const k of Object.keys(state.days)) if (state.days[k].d < cut) foldDay(state.days[k]);
  for (const p of state.pshifts) if (!(p.d >= addDays(cut, 8) || p.st !== 'SUBMITTED')) foldShift(p);
  _prune();
};

/* ---------- ranking (project managers and supervisors only) ---------- */
function rankingPool(u, pid) {
  const ids = new Set(); const mine = pmProjects(u);
  for (const a of state.assignments) { if (pid && a.project_id !== pid) continue; if (mine.includes(a.project_id) || a.sup === u.id) ids.add(a.employee_id); }
  return [...ids].map(empById).filter(e => e && (userOfEmp(e.id) || {}).status !== 'INVITED');
}
function rankProjects(u) { const ids = new Set([...pmProjects(u), ...state.assignments.filter(a => a.sup === u.id).map(a => a.project_id)]); return state.projects.filter(p => ids.has(p.id)); }
function rankStats(e, u, pid, from) {
  const today = ymd(now()); const allowed = new Set(pid ? [pid] : rankProjects(u).map(p => p.id));
  const agg = { shifts: 0, rating: 0, qty: 0, qual: 0, qualN: 0, below: 0, noReason: 0, prod: 0, sched: 0, present: 0, leave: 0 };
  for (const p of state.pshifts) if (p.e === e.id && p.m && p.st === 'SUBMITTED' && allowed.has(p.p) && p.d >= from) { agg.shifts++; agg.rating += p.m.rating; agg.qty += p.m.qty; if (p.m.qual != null) { agg.qual += p.m.qual; agg.qualN++; } if (p.m.below) agg.below++; if (p.r && p.r.auto) agg.noReason++; agg.prod += p.prod || 0; }
  for (const d of Object.values(state.days)) if (d.e === e.id && allowed.has(d.p) && d.d >= from && d.d < today) { if (SCHEDULED.has(d.st)) agg.sched++; if (d.st === 'PRESENT' || d.st === 'COMPLETED') agg.present++; if (d.st === 'LEAVE') agg.leave++; }
  for (const h of Object.values(state.perfHistory || {})) if (h.e === e.id && allowed.has(h.p) && h.ym >= from.slice(0, 7)) for (const k of Object.keys(agg)) agg[k] += h[k];
  const n = agg.shifts; const workDays = agg.sched - agg.leave;
  const att = workDays > 0 ? Math.min(100, agg.present / workDays * 100) : null;
  const rating = n ? agg.rating / n : null;
  const score = n ? Math.max(0, 0.7 * rating + 0.3 * (att == null ? 100 : att) - 2 * agg.noReason) : null;
  return { e, n, rating: rating == null ? null : r1(rating), qty: n ? r1(agg.qty / n) : null, qual: agg.qualN ? r1(agg.qual / agg.qualN) : null, att: att == null ? null : r1(att), below: agg.below, noReason: agg.noReason, prod: agg.prod, score: score == null ? null : r1(score) };
}
const MIN_SHIFTS = 3;
function rankingRows(u, pid, days) {
  const from = days ? addDays(ymd(now()), -days) : '2000-01-01';
  const rows = rankingPool(u, pid).map(e => rankStats(e, u, pid, from));
  rows.sort((a, b) => ((b.n >= MIN_SHIFTS) - (a.n >= MIN_SHIFTS)) || ((b.score ?? -1) - (a.score ?? -1)));
  const ranked = rows.filter(r => r.n >= MIN_SHIFTS);
  rows.forEach(r => { const i = ranked.indexOf(r); r.rank = i >= 0 ? i + 1 : null; r.tier = i < 0 ? 'Not enough data' : r.score >= 95 && i < Math.max(1, Math.ceil(ranked.length * 0.25)) ? 'Top performer' : r.score >= 85 ? 'Solid' : 'Needs support'; });
  return rows;
}
const PERIODS = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'], ['0', 'All time']];
function vRanking(u) {
  if (!canRank(u)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Team ranking is visible to project managers and supervisors only.');
  const pid = params().p || ''; const per = params().per2 || '90'; const rows = rankingRows(u, pid, +per);
  const projs = rankProjects(u); const canRec = has(u, 'project_manager');
  const tierChip = t => t === 'Top performer' ? chip('OK', t) : t === 'Solid' ? chip('COMPLETED', t) : t === 'Needs support' ? chip('WARN', t) : chip('REST_DAY', t);
  return `<div class="pagehead"><div><h1>Team ranking</h1><p class="muted">Who is working well, from recorded shifts and attendance. Visible only to project managers and supervisors.</p></div>
  <div class="row">${projs.length > 1 ? `<label class="f">Project<select data-change="rank-p"><option value="">All my projects</option>${projs.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
  <label class="f">Period<select data-change="rank-per">${PERIODS.map(([k, l]) => `<option value="${k}" ${k === per ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <button class="btn" data-act="export" data-k="ranking" data-f="csv">CSV</button><button class="btn" data-act="export" data-k="ranking" data-f="pdf">PDF</button></div></div>
  <div class="tablewrap"><table><thead><tr><th class="num">Rank</th><th>Staff no.</th><th>Name</th><th class="num">Shifts</th><th>Avg quantity</th><th class="num">Avg quality</th><th class="num">Avg rating</th><th class="num">Attendance</th><th class="num">Below target</th><th class="num">No reason</th><th class="num">Score</th><th>Standing</th><th>Recommended</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="click" data-act="emp" data-e="${r.e.id}"><td class="num"><b>${r.rank ?? '—'}</b></td><td>${esc(r.e.staff_no)}</td><td>${esc(r.e.full_name)}</td><td class="num">${r.n}</td><td>${r.qty == null ? '—' : pctCell(r.qty)}</td><td class="num">${r.qual == null ? '—' : r.qual + '%'}</td><td class="num">${r.rating == null ? '—' : r.rating + '%'}</td><td class="num">${r.att == null ? '—' : r.att + '%'}</td><td class="num">${r.below}</td><td class="num">${r.noReason}</td><td class="num"><b>${r.score ?? '—'}</b></td><td>${tierChip(r.tier)}</td>
    <td class="wrap small">${r.e.rec ? `★ ${esc(r.e.rec.note || 'Recommended')} <span class="muted">(${esc(userById(r.e.rec.by)?.name || '')})</span>` : ''}${canRec ? ` <button class="btn small" data-act="rec-open" data-e="${r.e.id}">${r.e.rec ? 'Change' : 'Recommend'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="13" class="empty">No team members yet.</td></tr>'}
  </tbody></table></div>
  <p class="muted small" style="margin-top:10px">Score = 70% average shift rating + 30% attendance rate, minus 2 points for each shortfall submitted with no reason. Shift rating already combines quantity against target and quality. People with fewer than ${MIN_SHIFTS} shifts in the period are listed but not ranked. Top performer = top quarter with a score of 95 or more. History is kept month by month, so former team members stay on the list for future projects.</p>`;
}

/* ---------- exports (CSV and PDF) ---------- */
let _pdfLib = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF library.')); document.head.appendChild(s); }); }
function loadPdf() { if (!_pdfLib) _pdfLib = loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js').then(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')).catch(e => { _pdfLib = null; throw e; }); return _pdfLib; }
const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const pdfSafe = v => String(v ?? '').replace(/[—–]/g, '-').replace(/×/g, 'x').replace(/…/g, '...').replace(/★/g, '*').replace(/[^\x00-\xFF]/g, '?');
async function deliver(name, data) {
  try { const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; if (dl) { await dl.save({ filename: name, data }); return; } }
  catch (e) { if (e && e.code === 'declined') return; if (e && !['not_granted', 'unavailable', 'capability_disabled', 'capability_removed'].includes(e.code)) { toast(`<code>${esc(e.code || 'ERROR')}</code> The file was not saved.`, true); return; } }
  if (typeof data === 'string') openDialog(`<div class="stack"><div class="spread"><h2>${esc(name)}</h2><button class="btn small" data-act="dlg-close">Close</button></div><p class="muted small">Downloads aren't available in this view. Copy the contents below.</p><textarea style="width:100%;min-height:260px;font-size:.8rem" readonly>${esc(data)}</textarea></div>`);
  else toast('Downloads are not available in this view. Try CSV instead.', true);
}
async function exportTable(fmt, title, head, rows, base) {
  const stamp = ymd(now()); const name = `${String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${stamp}.${fmt}`;
  if (fmt === 'csv') return deliver(name, '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
  toast('Preparing PDF…');
  await loadPdf(); const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: head.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(15); doc.text(pdfSafe(title), 40, 42);
  doc.setFontSize(9); doc.setTextColor(90); doc.text(pdfSafe(`${state.company.name}. Generated ${fmtDT(now())} (${displayTz()}) by ${currentUser().name}.`), 40, 58);
  doc.autoTable({ head: [head.map(pdfSafe)], body: rows.map(r => r.map(pdfSafe)), startY: 70, styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: [13, 87, 71] }, alternateRowStyles: { fillColor: [244, 247, 243] }, margin: { left: 40, right: 40 },
    didDrawPage: () => { const n = doc.internal.getNumberOfPages(); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Page ${n}`, doc.internal.pageSize.getWidth() - 70, doc.internal.pageSize.getHeight() - 20); } });
  return deliver(name, doc.output('arraybuffer'));
}
function exportSpec(k, d, u) {
  const pct = v => v == null ? '' : v + '%';
  if (k === 'project-team') {
    const p = projById(d.p); if (!isAdmin(u) && !pmProjects(u).includes(p.id)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Outside your projects.');
    const rows = teamUsers(p.id).map(x => { const e = empOf(x); const a = assignmentOf(e.id); const def = defById(e.shift_id); return [e.staff_no, x.name, x.email, def ? `${def.name === 'NIGHT' ? 'Night' : 'Day'} ${def.start}-${def.end}` : '', a && a.sup ? userById(a.sup)?.name : '', x.status === 'INVITED' ? 'Invited' : x.status === 'ACTIVE' ? 'Active' : 'Deactivated', DOWL[e.rest]]; });
    return [`${p.name}: team list`, ['Staff no.', 'Name', 'Email', 'Shift', 'Supervisor', 'Status', 'Rest day'], rows, `${p.name}-team`];
  }
  if (k === 'team-month') {
    const ym = params().month || ymd(now()).slice(0, 7); const pid = params().p || '';
    const rows = teamFor(u, pid).map(e => { const s = monthSummary(e.id, ym); const pss = state.pshifts.filter(p => p.e === e.id && p.m && p.d.startsWith(ym)); const a = assignmentOf(e.id);
      return [e.staff_no, e.full_name, projById(a.project_id).name, s.scheduled, s.present, s.absent, s.leave, s.late, fmtDur(s.total), fmtDur(s.avg), fmtDur(pss.reduce((x, p) => x + p.prod, 0)), pss.length, pss.length ? r1(pss.reduce((x, p) => x + p.m.rating, 0) / pss.length) + '%' : '']; });
    const [y, m] = ym.split('-').map(Number);
    return [`Team report, ${MONL[m - 1]} ${y}`, ['Staff no.', 'Name', 'Project', 'Scheduled', 'Present', 'Absent', 'Leave', 'Late', 'Total hours', 'Avg / day', 'Production hours', 'Shifts', 'Avg rating'], rows, `team-report-${ym}-generated`];
  }
  if (k === 'team-perf') {
    const pid = params().p || ''; const days = +d.days || 0; const to = params().date || ymd(now()); const from = days ? addDays(to, -days + 1) : to;
    const team = new Set(teamFor(u, pid).map(e => e.id));
    const rows = state.pshifts.filter(p => team.has(p.e) && p.d >= from && p.d <= to).sort((a, b) => a.d.localeCompare(b.d) || empById(a.e).staff_no.localeCompare(empById(b.e).staff_no)).map(p => { const m = liveMetrics(p); const L = m.rows.find(r => r.task === 'LABEL'), R = m.rows.find(r => r.task === 'REVIEW'); const e = empById(p.e);
      return [p.d, e.staff_no, e.full_name, fmtDur(p.prod), p.ul, L ? Math.round(L.rate) : '', p.ur, R ? Math.round(R.rate) : '', pct(m.qty), pct(m.qual), pct(m.rating), p.st === 'OPEN' ? 'In progress' : p.st === 'AWAITING_REASON' ? 'Awaiting reason' : p.r && p.r.cat ? REASONS[p.r.cat] + (p.r.text ? ': ' + p.r.text : '') : 'On target']; });
    return [`Team performance, ${fmtDate(from)}${from !== to ? ' to ' + fmtDate(to) : ''}`, ['Date', 'Staff no.', 'Name', 'Production time', 'Labelled', 'Label / hr', 'Reviewed', 'Review / hr', 'Quantity', 'Quality', 'Rating', 'Reason'], rows, `team-performance-${from}`];
  }
  if (k === 'ranking') {
    if (!canRank(u)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Ranking is for project managers and supervisors only.');
    const per = params().per2 || '90'; const rows = rankingRows(u, params().p || '', +per).map(r => [r.rank ?? '', r.e.staff_no, r.e.full_name, r.n, pct(r.qty), pct(r.qual), pct(r.rating), pct(r.att), r.below, r.noReason, r.score ?? '', r.tier, r.e.rec ? 'Yes' + (r.e.rec.note ? ': ' + r.e.rec.note : '') : '']);
    return [`Team ranking, ${PERIODS.find(x => x[0] === per)[1].toLowerCase()}`, ['Rank', 'Staff no.', 'Name', 'Shifts', 'Avg quantity', 'Avg quality', 'Avg rating', 'Attendance', 'Below target', 'No reason', 'Score', 'Standing', 'Recommended'], rows, 'team-ranking'];
  }
  if (k === 'employee-month') {
    const e = empById(params().e); if (!canSee(u, e.id)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Outside your scope.'); const ym = params().month || ymd(now()).slice(0, 7);
    const rows = monthDays(e.id, ym).map(dd => { const ps = pshiftFor(e.id, dd.d); return [dd.d, STATUS_LABEL(dd.st), dd.late ? 'Yes' : '', fmtTime(dd.fi), fmtTime(dd.lo), dd.ps ? fmtDur(dd.ps) : '', ps ? fmtDur(ps.prod) : '', ps && ps.m ? ps.m.rating + '%' : '', ps && ps.r && ps.r.cat ? REASONS[ps.r.cat] : '']; });
    return [`${e.full_name} (${e.staff_no}), ${ym}`, ['Date', 'Status', 'Late', 'Check-in', 'Check-out', 'Presence', 'Production', 'Rating', 'Shortfall reason'], rows, `${e.staff_no}-${ym}`];
  }
}
const exportBtns = (k, extra = '') => `<span class="row" style="gap:6px"><button class="btn small" data-act="export" data-k="${k}" data-f="csv" ${extra}>CSV</button><button class="btn small" data-act="export" data-k="${k}" data-f="pdf" ${extra}>PDF</button></span>`;

/* ---------- wiring ---------- */
Object.assign(A, {
  invite: d => openDialog(inviteDialog(d.k, d.p)),
  'invite-show': d => showInvites([d.u]),
  'copy-invites': async () => { const t = $('#invite-text'); try { await navigator.clipboard.writeText(t.value); toast('Invitations copied.'); } catch (e) { t.focus(); t.select(); toast('Selected. Press Ctrl+C (or Cmd+C) to copy.'); } },
  export: async d => { try { const u = currentUser(); const spec = exportSpec(d.k, d, u); if (!spec[2].length) { toast('Nothing to export for this selection.', true); return; } await exportTable(d.f, ...spec); } catch (e) { showErr(e); } },
  'rec-open': d => { const e = empById(d.e); openDialog(`<form data-rec="${e.id}" class="stack" style="--gap:12px"><h2>Recommend ${esc(e.full_name)}</h2><p class="muted small">A note for project managers planning future projects. Visible only to project managers and supervisors.</p><label class="f">Note<input name="note" maxlength="140" value="${esc(e.rec ? e.rec.note : '')}" placeholder="e.g. Fast, accurate polygons; good reviewer"></label><div class="row"><button class="btn primary">Save recommendation</button>${e.rec ? '<button type="button" class="btn danger" data-act="rec-clear" data-e="' + e.id + '">Remove</button>' : ''}<button type="button" class="btn" data-act="dlg-close">Cancel</button></div></form>`); },
  'rec-clear': d => { closeDialog(); act(() => { const u = currentUser(); if (!has(u, 'project_manager') || !rankingPool(u).some(x => x.id === d.e)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Only the project manager can change recommendations.'); delete empById(d.e).rec; audit(u, 'people.RecommendationRemoved', 'employee', empById(d.e).staff_no, ''); }); }
});
Object.assign(CHANGES, { 'rank-p': el => setP('p', el.value), 'rank-per': el => setP('per2', el.value) });
VIEWS.projects = vProjects; VIEWS.ranking = vRanking;
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-invite]');
  if (f) { e.preventDefault(); const fd = new FormData(f); const kind = f.dataset.invite; const pid0 = f.dataset.p; const made = [];
    act(() => {
      made.length = 0; // the change is re-applied if someone else saved first
      const actor = currentUser(); const role = kind === 'management' ? fd.get('role') : kind; const pid = kind === 'management' ? (NEEDS_PROJECT.includes(role) ? fd.get('project') : null) : pid0;
      if (kind === 'management' || role === 'project_manager') { if (!isAdmin(actor)) throw new ApiError(403, 'FORBIDDEN', 'Only admins invite management.'); }
      else if (!isAdmin(actor) && !pmProjects(actor).includes(pid)) throw new ApiError(403, 'NOT_IN_SCOPE', 'You can only add people to projects you manage.');
      const ex = fd.get('existing'); const people = parsePeople(fd.get('people'));
      if (!ex && !people.length) throw new ApiError(422, 'NOBODY', 'Pick someone already in the company or list at least one new person.');
      if (ex) { const x = userById(ex); assignExisting(x, role, pid, actor); }
      for (const p of people) made.push(createInvite({ ...p, role, pid, shift: fd.get('shift') || (pid ? defaultShift(pid)?.id : state.shiftDefs[0]?.id), sup: fd.get('sup') || null, rest: fd.get('rest') == null ? 0 : +fd.get('rest') }, actor).id);
      toast(made.length ? `${made.length} invitation${made.length > 1 ? 's' : ''} created.` : 'Access updated.');
    }).then(ok => { if (ok) { closeDialog(); if (made.length) showInvites(made); } render(true); });
    return; }
  const rf = e.target.closest('form[data-rec]');
  if (rf) { e.preventDefault(); const note = String(new FormData(rf).get('note') || '').trim(); const eid = rf.dataset.rec; closeDialog();
    act(() => { const u = currentUser(); if (!has(u, 'project_manager') || !rankingPool(u).some(x => x.id === eid)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Only the project manager can recommend their team members.'); empById(eid).rec = { by: u.id, at: now(), note }; audit(u, 'people.Recommended', 'employee', empById(eid).staff_no, note); toast('Recommendation saved.'); }); }
});
