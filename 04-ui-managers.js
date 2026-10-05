
/* ---------- managers: live team attendance ---------- */
function projectPicker(u, sel, act = 'proj') {
  const ps = teamProjects(u); if (ps.length < 2) return '';
  return `<label class="f">Project<select data-change="${act}"><option value="">All my projects</option>${ps.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
}
function liveRow(e, t) {
  const d = attendanceDateFor(e, t); const day = getDay(e.id, d) || { st: rosterStatus(e, d), ps: 0 }; const open = openSession(e.id);
  const st = open && open.d === d ? 'PRESENT' : day.st; const ps = pshiftFor(e.id, d); const w = windowFor(e, d);
  return { e, d, day, st, open, ps, w };
}
function vTeam(u) {
  const t = now(); const pid = params().p || ''; const f = params().f || ''; const sh = params().sh || '';
  const team = teamFor(u, pid); const rows = team.map(e => liveRow(e, t)).filter(r => !sh || r.w && r.w.def.name === sh);
  const counts = {}; rows.forEach(r => counts[r.st] = (counts[r.st] || 0) + 1);
  const shown = rows.filter(r => !f || r.st === f);
  const order = { PRESENT: 0, EXPECTED: 1, ABSENT: 2, COMPLETED: 3, LEAVE: 4, REST_DAY: 5, HOLIDAY: 6 };
  shown.sort((a, b) => order[a.st] - order[b.st] || a.e.staff_no.localeCompare(b.e.staff_no));
  const flash = mem.flash && Date.now() - mem.flash.at < 2500 ? mem.flash.e : null;
  const counter = (code, label) => `<button class="counter" data-act="filter" data-f="${code}" aria-pressed="${f === code}"><b>${counts[code] || 0}</b><span>${label}</span></button>`;
  return `<div class="pagehead"><div><h1>Today's attendance</h1><p class="muted">${fmtDate(ymd(t, displayTz()), true)} <span class="live" style="margin-left:10px">Live</span></p></div>
  <div class="row">${exportBtns('team-month')}${projectPicker(u, pid)}<label class="f">Shift<select data-change="shiftf"><option value="">All shifts</option><option value="DAY" ${sh === 'DAY' ? 'selected' : ''}>Day</option><option value="NIGHT" ${sh === 'NIGHT' ? 'selected' : ''}>Night</option></select></label></div></div>
  <div class="counters">${counter('PRESENT', 'Present')}${counter('EXPECTED', 'Not checked in')}${counter('ABSENT', 'Absent')}${counter('LEAVE', 'Leave')}${counter('COMPLETED', 'Checked out')}${counter('REST_DAY', 'Rest day')}${f ? '<button class="btn ghost" data-act="filter" data-f="">Clear filter</button>' : ''}</div>
  <div class="tablewrap"><table><thead><tr><th>Employee</th><th>Shift</th><th>Status</th><th>Check-in</th><th>Check-out</th><th class="num">Presence</th><th class="num">Production</th><th>% target</th><th>Quality</th></tr></thead><tbody>
  ${shown.map(r => { const m = r.ps ? liveMetrics(r.ps) : null; const presence = r.st === 'PRESENT' ? `<span data-since="${r.open.in - (r.day.ps || 0) * 1000}" data-fmt="hm"></span>` : r.day.ps ? fmtDur(r.day.ps) : '—';
    return `<tr class="click ${flash === r.e.id ? 'flash' : ''}" data-act="emp" data-e="${r.e.id}"><td><span class="muted">${esc(r.e.staff_no)}</span> ${esc(r.e.full_name)}</td><td>${r.w ? (r.w.def.name === 'NIGHT' ? 'Night' : 'Day') + ' ' + r.w.def.start : '—'}</td><td>${chip(r.st)}${r.day.late ? ' <span class="chip s-WARN nodot">Late</span>' : ''}</td><td>${fmtTime(r.day.fi)}</td><td>${r.st === 'COMPLETED' ? fmtTime(r.day.lo) : '—'}</td><td class="num">${presence}</td><td class="num">${r.ps ? (r.ps.st === 'OPEN' && workingNow(r.e.id, r.ps) ? '▲ ' : '') + fmtDur(prodSeconds(r.ps)) : '—'}</td><td>${m ? pctCell(m.qty) : '—'}</td><td>${m && m.qual != null ? (m.qual < projById(r.ps.p).quality_target ? `<span class="chip s-WARN nodot">${m.qual}%</span>` : m.qual + '%') : '—'}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">Nobody matches this filter.</td></tr>'}
  </tbody></table></div>
  <p class="muted small" style="margin-top:10px">Rows update as check-ins, check-outs and production syncs happen. ▲ marks someone working in Labelbox right now. Attendance and production are separate records shown side by side.</p>`;
}

/* ---------- employee detail (manager view) ---------- */
function vEmployee(u) {
  const e = empById(params().e); if (!e || !canSee(u, e.id)) throw new ApiError(403, 'NOT_IN_SCOPE', 'This employee is outside your assigned scope.');
  const ym = params().month || ymd(now()).slice(0, 7); const s = monthSummary(e.id, ym); const ds = monthDays(e.id, ym).reverse();
  const a = assignmentOf(e.id); const recent = state.pshifts.filter(p => p.e === e.id && p.st !== 'OPEN').sort((x, y) => y.d.localeCompare(x.d)).slice(0, 10);
  const leaves = state.leave.filter(l => l.e === e.id).sort((x, y) => y.start.localeCompare(x.start));
  const canLeave = has(u, 'supervisor') || has(u, 'project_manager') || has(u, 'admin');
  return `<div class="pagehead"><div><button class="btn ghost small" data-act="nav" data-r="team">Back to team</button><h1 style="margin-top:6px">${esc(e.full_name)}</h1><p class="muted">Staff ${esc(e.staff_no)}, ${e.type}, ${a ? esc(projById(a.project_id).name) + (a.sup ? ', supervised by ' + esc(userById(a.sup)?.name) : ', no supervisor assigned') : 'not on a labelling team'}. ${esc(shiftDefFor(e, ymd(now())).name.toLowerCase())} shift.</p></div>
  <div class="row">${exportBtns('employee-month')}<label class="f">Month<select data-change="month">${monthOptions(ym)}</select></label></div></div>
  <div class="stack" style="--gap:20px">${summaryStats(s)}<section class="panel">${calendar(e.id, ym)}</section>
  <section class="stack" style="--gap:10px"><h2>Daily records</h2>${dayTable(e, ds, has(u, 'supervisor') || has(u, 'admin'))}</section>
  ${a ? `<section class="stack" style="--gap:10px"><h2>Shift performance and reasons</h2>${perfTable(recent, false)}</section>` : ''}
  <section class="panel stack" style="--gap:10px"><h2>Leave</h2>
  ${leaves.length ? `<div class="tablewrap"><table><thead><tr><th>From</th><th>To</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>${leaves.map(l => `<tr><td>${fmtDate(l.start)}</td><td>${fmtDate(l.end)}</td><td>${esc(l.type)}</td><td>${chip(l.status === 'APPROVED' ? 'LEAVE' : 'REST_DAY', l.status === 'APPROVED' ? 'Approved' : 'Cancelled')}</td><td>${canLeave && l.status === 'APPROVED' && l.end >= ymd(now()) ? `<button class="btn small" data-act="leave-cancel" data-l="${l.id}">Cancel leave</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No leave recorded.</p>'}
  ${canLeave ? `<form data-form="leave" data-e="${e.id}" class="form"><label class="f">From<input type="date" name="start" required value="${addDays(ymd(now()), 1)}"></label><label class="f">To<input type="date" name="end" required value="${addDays(ymd(now()), 1)}"></label><label class="f">Type<select name="type"><option>ANNUAL</option><option>SICK</option><option>COMPASSIONATE</option><option>UNPAID</option></select></label><button class="btn">Record approved leave</button></form><p class="muted small">Approved leave sets those days to Leave and cancels any open meal bookings in the range.</p>` : ''}
  </section></div>`;
}

/* ---------- managers: team performance ---------- */
function sparkline(vals) {
  if (vals.length < 2) return ''; const w = 90, h = 24, mx = Math.max(110, ...vals), mn = Math.min(60, ...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - (v - mn) / (mx - mn) * h).toFixed(1)}`).join(' ');
  const y100 = (h - (100 - mn) / (mx - mn) * h).toFixed(1);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${y100}" y2="${y100}" stroke="var(--line)" stroke-dasharray="2 2"/><polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="1.6"/></svg>`;
}
function vTeamPerf(u) {
  const pid = params().p || ''; const date = params().date || ymd(now());
  const team = teamFor(u, pid); const list = team.map(e => pshiftFor(e.id, date)).filter(Boolean);
  const missing = team.filter(e => !pshiftFor(e.id, date) && rosterStatus(e, date) === 'EXPECTED');
  const trend = e => state.pshifts.filter(p => p.e === e.id && p.m).sort((a, b) => a.d.localeCompare(b.d)).slice(-14).map(p => p.m.rating);
  return `<div class="pagehead"><div><h1>Team performance</h1><p class="muted">Per shift, from Labelbox counts and extension time. Rates are per productive hour.</p></div>
  <div class="row">${projectPicker(u, pid)}<label class="f">Shift date<input type="date" data-change="pdate" value="${date}" max="${ymd(now())}"></label></div></div>
  <div class="row" style="margin:-8px 0 14px"><span class="muted small">Export:</span> <b class="small">this date</b> ${exportBtns('team-perf', 'data-days="1"')} <b class="small">last 30 days</b> ${exportBtns('team-perf', 'data-days="30"')}</div>
  <div class="stack" style="--gap:20px">${perfTable(list, true)}
  ${missing.length ? `<p class="muted small">No production recorded for: ${missing.map(e => esc(e.full_name)).join(', ')}.</p>` : ''}
  <section class="stack" style="--gap:10px"><h2>Rating trend, last 14 shifts</h2><div class="tablewrap"><table><thead><tr><th>Employee</th><th>Trend</th><th class="num">Average rating</th><th class="num">Below target</th><th class="num">No reason given</th></tr></thead><tbody>
  ${team.map(e => { const ps = state.pshifts.filter(p => p.e === e.id && p.m).slice(-14); const tr = trend(e); return `<tr class="click" data-act="emp" data-e="${e.id}"><td>${esc(e.staff_no)} ${esc(e.full_name)}</td><td>${sparkline(tr)}</td><td class="num">${tr.length ? r1(tr.reduce((a, b) => a + b, 0) / tr.length) + '%' : '—'}</td><td class="num">${ps.filter(p => p.m.below).length}</td><td class="num">${ps.filter(p => p.r && p.r.auto).length}</td></tr>`; }).join('')}
  </tbody></table></div></section></div>`;
}

/* ---------- corrections ---------- */
function vApprovals(u) {
  const list = state.adjustments.filter(a => canSee(u, a.e)).sort((a, b) => b.at - a.at).slice(0, 40); const canApprove = has(u, 'project_manager') || has(u, 'admin');
  return `<div class="pagehead"><div><h1>Attendance corrections</h1><p class="muted">Supervisors request a correction with a reason; a Project Manager or Admin approves it. The original value is kept and the day is recalculated.</p></div></div>
  <div class="tablewrap"><table><thead><tr><th>Requested</th><th>Employee</th><th>Day</th><th>Change</th><th>Reason</th><th>By</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(a => { const e = empById(a.e); return `<tr><td>${fmtDT(a.at)}</td><td>${esc(e.staff_no)} ${esc(e.full_name)}</td><td>${fmtDate(a.d)}</td><td>${a.field === 'check_in_at' ? 'Check-in' : 'Check-out'}: ${a.ov ? fmtTime(a.ov) : 'none'} → <b>${fmtTime(a.nv)}</b></td><td class="wrap">${esc(a.reason)}</td><td>${esc(userById(a.req)?.name)}</td><td>${chip(a.status === 'PENDING' ? 'EXPECTED' : a.status === 'APPROVED' ? 'PRESENT' : 'ABSENT', a.status[0] + a.status.slice(1).toLowerCase())}</td><td>${a.status === 'PENDING' && canApprove ? `<button class="btn primary small" data-act="adj-approve" data-a="${a.id}">Approve</button> <button class="btn small" data-act="adj-reject" data-a="${a.id}">Reject</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">No corrections yet. Supervisors start one from an employee\'s daily records.</td></tr>'}
  </tbody></table></div>`;
}

/* ---------- daily reports & production overview ---------- */
function rollup(pid, date, sid) {
  const pss = state.pshifts.filter(p => p.p === pid && p.d === date && (!sid || p.sid === sid)); const closed = pss.filter(p => p.m);
  const avg = k => closed.length ? r1(closed.reduce((a, p) => a + (p.m[k] || 0), 0) / closed.length) : null;
  return { n: pss.length, open: pss.length - closed.length, prod: pss.reduce((a, p) => a + p.prod, 0), ul: pss.reduce((a, p) => a + p.ul, 0), ur: pss.reduce((a, p) => a + p.ur, 0), qty: avg('qty'), qual: avg('qual'), rating: avg('rating'), below: closed.filter(p => p.m.below).length, pss };
}
function vReports(u) {
  const date = params().date || addDays(ymd(now()), -1);
  const projs = has(u, 'admin') || has(u, 'production_manager') ? state.projects : state.projects.filter(p => roleProjects(u, 'project_manager').includes(p.id));
  return `<div class="pagehead"><div><h1>Daily project reports</h1><p class="muted">Built automatically 30 minutes after each shift closes and emailed to the Project Manager and Production Manager.</p></div>
  <label class="f">Date<input type="date" data-change="pdate" value="${date}" max="${ymd(now())}"></label></div>
  <div class="stack" style="--gap:22px">${projs.map(p => `<section class="stack" style="--gap:10px"><h2>${esc(p.name)}</h2>
  ${state.shiftDefs.filter(d => d.project_id === p.id).map(def => { const r = rollup(p.id, date, def.id); return `<div class="panel stack" style="--gap:10px"><div class="spread"><h3>${def.name === 'NIGHT' ? 'Night' : 'Day'} shift ${def.start}–${def.end}</h3>${r.open ? '<span class="live">In progress</span>' : ''}</div>
    <div class="stats"><div><span>Staff</span><b>${r.n}</b></div><div><span>Production hours</span><b>${fmtDur(r.prod)}</b></div><div><span>Labelled</span><b>${r.ul.toLocaleString()}</b></div><div><span>Reviewed</span><b>${r.ur.toLocaleString()}</b></div><div><span>Avg quantity</span><b>${r.qty ?? '—'}${r.qty != null ? '%' : ''}</b></div><div><span>Avg quality</span><b>${r.qual ?? '—'}${r.qual != null ? '%' : ''}</b></div><div><span>Below target</span><b>${r.below}</b></div></div>
    ${r.pss.filter(x => x.m && x.m.below).length ? `<details><summary>Shortfall reasons</summary><ul>${r.pss.filter(x => x.m && x.m.below).map(x => `<li>${esc(empById(x.e).full_name)}, ${x.m.qty}%: ${x.st === 'AWAITING_REASON' ? 'awaiting reason' : esc(REASONS[x.r.cat]) + (x.r.text ? ', ' + esc(x.r.text) : '')}</li>`).join('')}</ul></details>` : ''}</div>`; }).join('')}</section>`).join('')}</div>`;
}
function vOverview(u) {
  const today = ymd(now()); const days = [...Array(7)].map((_, i) => addDays(today, -i));
  return `<div class="pagehead"><div><h1>Production overview</h1><p class="muted">All production projects, last seven days.</p></div></div>
  <div class="stack" style="--gap:22px">${state.projects.filter(p => p.production).map(p => `<section class="stack" style="--gap:10px"><h2>${esc(p.name)}</h2><div class="tablewrap"><table><thead><tr><th>Date</th><th class="num">Staff</th><th class="num">Production hours</th><th class="num">Labelled</th><th class="num">Reviewed</th><th>Avg quantity</th><th class="num">Avg quality</th><th class="num">Avg rating</th><th class="num">Below target</th></tr></thead><tbody>
  ${days.map(d => { const r = rollup(p.id, d); return `<tr><td>${fmtDate(d)}${d === today ? ' <span class="live">Today</span>' : ''}</td><td class="num">${r.n}</td><td class="num">${fmtDur(r.prod)}</td><td class="num">${r.ul.toLocaleString()}</td><td class="num">${r.ur.toLocaleString()}</td><td>${r.qty == null ? '—' : pctCell(r.qty)}</td><td class="num">${r.qual ?? '—'}${r.qual != null ? '%' : ''}</td><td class="num">${r.rating ?? '—'}${r.rating != null ? '%' : ''}</td><td class="num">${r.below}</td></tr>`; }).join('')}
  </tbody></table></div></section>`).join('')}</div>`;
}

/* ---------- logistics ---------- */
function vLogistics(u) {
  const t = now(); const today = ymd(t); const date = params().date || today; const tab = params().tab || 'daily';
  const tabs = `<div class="tabs" role="tablist">${[['daily', 'Daily orders'], ['monthly', 'Monthly report'], ['vendors', 'Vendors']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-act="tab" data-t="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'daily') {
    body = `<div class="row" style="margin-bottom:14px"><label class="f">Meal date<input type="date" data-change="pdate" value="${date}"></label></div><div class="stack">${state.vendors.map(v => {
      const o = state.orders.find(x => x.v === v.id && x.d === date); const bs = state.bookings.filter(b => b.v === v.id && b.d === date && (b.st === 'BOOKED' || b.st === 'LOCKED'));
      const byShift = {}; bs.forEach(b => { const k = b.g ? 'Guest' : (shiftDefFor(empById(b.e), date).name === 'NIGHT' ? 'Night' : 'Day'); byShift[k] = (byShift[k] || 0) + 1; });
      const noShow = bs.filter(b => b.col === false).length;
      return `<section class="panel stack" style="--gap:12px"><div class="spread"><h2>${esc(v.name)}, ${v.meal_type.toLowerCase()} at ${v.slot}</h2>${o ? chip('COMPLETED', 'Dispatched ' + fmtDT(o.at)) : chip('EXPECTED', 'Open until ' + fmtDT(cutoffAt(v, date)))}</div>
      <div class="stats"><div><span>Meals</span><b>${bs.length}</b></div>${Object.entries(byShift).map(([k, n]) => `<div><span>HQ, ${k} shift</span><b>${n}</b></div>`).join('')}<div><span>Cost to vendor</span><b>${kes(bs.reduce((a, b) => a + b.es + b.cs, 0))}</b></div>${date < today ? `<div><span>No-shows</span><b>${noShow}</b></div>` : ''}</div>
      ${bs.length ? `
      ${o && date <= today ? `<details><summary>Collection list (staff numbers)</summary><div class="row" style="margin-top:8px">${bs.map(b => `<label class="row small" style="gap:4px"><input type="checkbox" data-change="collected" data-b="${b.id}" ${b.col !== false ? 'checked' : ''}> ${b.g ? 'Guest: ' + esc(b.g) : esc(empById(b.e).staff_no)}</label>`).join('')}</div><p class="muted small">Untick anyone who did not collect. Uncollected meals are still paid and deducted.</p></details>` : ''}` : '<p class="muted">No bookings for this date.</p>'}</section>`; }).join('')}</div>`;
  } else if (tab === 'monthly') {
    const per = state.periods[params().per] || periodFor(today); const pers = Object.values(state.periods).sort((a, b) => b.ends.localeCompare(a.ends));
    const bs = state.bookings.filter(b => b.per === per.id && (b.st === 'LOCKED' || b.st === 'BOOKED'));
    const dates = [...new Set(bs.map(b => b.d))].sort();
    body = `<div class="row" style="margin-bottom:14px"><label class="f">Meal period<select data-change="per">${pers.map(p => `<option value="${p.id}" ${p.id === per.id ? 'selected' : ''}>${fmtDate(p.starts)} – ${fmtDate(p.ends)} (${p.status === 'CLOSED' ? 'closed' : 'open'})</option>`).join('')}</select></label></div>
    <div class="stats" style="margin-bottom:14px"><div><span>Meals</span><b>${bs.length}</b></div><div><span>Cost to vendors</span><b>${kes(bs.reduce((a, b) => a + b.es + b.cs, 0))}</b></div><div><span>No-shows</span><b>${bs.filter(b => b.col === false).length}</b></div></div>
    <div class="tablewrap"><table><thead><tr><th>Date</th>${state.vendors.map(v => `<th class="num">${esc(v.name)}</th>`).join('')}<th class="num">Headcount</th><th class="num">Cost</th><th class="num">No-shows</th></tr></thead><tbody>
    ${dates.map(d => { const db = bs.filter(b => b.d === d); return `<tr><td>${fmtDate(d)}</td>${state.vendors.map(v => `<td class="num">${db.filter(b => b.v === v.id).length}</td>`).join('')}<td class="num">${db.length}</td><td class="num">${kes(db.reduce((a, b) => a + b.es + b.cs, 0))}</td><td class="num">${db.filter(b => b.col === false).length}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No meals in this period yet.</td></tr>'}</tbody></table></div>`;
  } else {
    body = `<div class="stack">${state.vendors.map(v => `<section class="panel stack" style="--gap:12px"><h2>${esc(v.name)}</h2>
    <form data-form="vendor" data-v="${v.id}" class="form"><label class="f">Serves<select name="meal_type"><option ${v.meal_type === 'LUNCH' ? 'selected' : ''}>LUNCH</option><option ${v.meal_type === 'DINNER' ? 'selected' : ''}>DINNER</option></select></label><label class="f">Order deadline<input type="time" name="deadline" value="${v.deadline}"></label><label class="f">Cut-off lead (min)<input type="number" name="lead_min" value="${v.lead_min}" min="0" max="1440" style="width:110px"></label><label class="f">Delivery<input type="time" name="slot" value="${v.slot}"></label><label class="f">Email<input name="email" value="${esc(v.email)}"></label><button class="btn">Save vendor</button></form>
    <p class="muted small">Booking closes ${v.lead_min} minutes before the vendor's ${v.deadline} order deadline on the meal day.</p>
    <p class="muted small">The weekly menu is agreed with the vendor outside the system; staff book a meal, not a dish.</p></section>`).join('')}${addVendorForm()}</div>`;
  }
  return `<div class="pagehead"><div><h1>Orders and headcount</h1><p class="muted">Orders lock at each vendor's cut-off and go to the vendor and Logistics automatically.</p></div></div>${tabs}${body}`;
}

/* ---------- finance ---------- */
function liveInvoices(per) {
  if (per.status === 'CLOSED') return state.invoices.filter(i => i.per === per.id);
  return state.vendors.map(v => { const vb = state.bookings.filter(b => b.per === per.id && b.v === v.id && (b.st === 'BOOKED' || b.st === 'LOCKED')); const et = vb.reduce((a, b) => a + b.es, 0), ct = vb.reduce((a, b) => a + b.cs, 0); return { v: v.id, per: per.id, no: 'Draft', et, ct, gt: et + ct, n: vb.length, draft: true, lines: vb.map(b => [b.d, b.g ? 'GUEST' : empById(b.e).staff_no, b.es, b.cs]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])) }; }).filter(i => i.n);
}
function liveDeductions(per) {
  if (per.status === 'CLOSED') return state.deductions.filter(d => d.per === per.id);
  const by = {}; state.bookings.filter(b => b.per === per.id && b.e && (b.st === 'BOOKED' || b.st === 'LOCKED')).forEach(b => { by[b.e] = by[b.e] || { e: b.e, per: per.id, n: 0, amt: 0 }; by[b.e].n++; by[b.e].amt += b.es; });
  return Object.values(by);
}
function vFinance(u) {
  const today = ymd(now()); const pers = Object.values(state.periods).sort((a, b) => b.ends.localeCompare(a.ends));
  const per = state.periods[params().per] || pers.find(p => p.status === 'CLOSED') || periodFor(today); const tab = params().tab || 'report';
  const invs = liveInvoices(per); const deds = liveDeductions(per).sort((a, b) => empById(a.e).staff_no.localeCompare(empById(b.e).staff_no));
  const unmatched = invs.filter(i => !i.draft && !(i.etims && i.etimsAmt === i.gt));
  const tabs = `<div class="tabs" role="tablist">${[['report', 'Period report'], ['prices', 'Price rules']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-act="tab" data-t="${k}">${l}</button>`).join('')}</div>`;
  let body;
  if (tab === 'prices') {
    body = `<div class="tablewrap"><table><thead><tr><th>Meal type</th><th class="num">Employee share</th><th class="num">Company subsidy</th><th class="num">Vendor price</th><th>Effective from</th><th>To</th></tr></thead><tbody>${state.priceRules.map(r => `<tr><td>${r.mt}</td><td class="num">${kes(r.es)}</td><td class="num">${kes(r.cs)}</td><td class="num">${kes(r.es + r.cs)}</td><td>${r.from}</td><td>${r.to || 'open'}</td></tr>`).join('')}</tbody></table></div>
    <form data-form="price" class="form panel" style="margin-top:14px"><label class="f">Meal type<select name="mt"><option>LUNCH</option><option>DINNER</option><option>GUEST</option></select></label><label class="f">Employee share (KES)<input type="number" name="es" min="0" value="100" style="width:120px"></label><label class="f">Company subsidy (KES)<input type="number" name="cs" min="0" value="150" style="width:120px"></label><label class="f">Effective from<input type="date" name="from" value="${addDays(today, 1)}" min="${addDays(today, 1)}"></label><button class="btn">Add price rule</button></form>
    <p class="muted small" style="margin-top:8px">A new rule ends the previous one the day before. Bookings keep the price they were made at.</p>`;
  } else {
    body = `<div class="row" style="margin-bottom:14px"><label class="f">Meal period<select data-change="per">${pers.map(p => `<option value="${p.id}" ${p.id === per.id ? 'selected' : ''}>${fmtDate(p.starts)} – ${fmtDate(p.ends)} (${p.status === 'CLOSED' ? 'closed' : 'open, draft'})</option>`).join('')}</select></label>
    ${per.status === 'CLOSED' ? `<button class="btn primary" data-act="export" data-k="payroll" data-per="${per.id}">Download payroll deduction file (CSV)</button><button class="btn" data-act="export" data-k="finance" data-per="${per.id}">Download finance report (CSV)</button>` : ''}</div>
    ${per.status !== 'CLOSED' ? `<div class="note" style="margin-bottom:14px">This period is still open. Figures are a live draft; they lock at 23:59 on ${fmtDate(per.ends)}.</div>` : unmatched.length ? `<div class="note bad" style="margin-bottom:14px">${unmatched.length} vendor${unmatched.length > 1 ? 's have' : ' has'} no matching KRA eTIMS invoice: ${unmatched.map(i => esc(vendorById(i.v).name)).join(', ')}. Hold payment until it is entered and matches.</div>` : `<div class="note" style="margin-bottom:14px">Every vendor invoice is matched to a KRA eTIMS invoice.</div>`}
    <div class="stats" style="margin-bottom:16px"><div><span>Total payable to vendors</span><b>${kes(invs.reduce((a, i) => a + i.gt, 0))}</b></div><div><span>Employee deductions</span><b>${kes(invs.reduce((a, i) => a + i.et, 0))}</b></div><div><span>Company subsidy</span><b>${kes(invs.reduce((a, i) => a + i.ct, 0))}</b></div><div><span>Meals</span><b>${invs.reduce((a, i) => a + i.n, 0)}</b></div></div>
    <section class="stack" style="--gap:10px"><h2>Vendors</h2><div class="tablewrap"><table><thead><tr><th>Vendor</th><th>Statement</th><th class="num">Meals</th><th class="num">Employee share</th><th class="num">Company share</th><th class="num">Total payable</th><th>eTIMS invoice</th></tr></thead><tbody>
    ${invs.map(i => `<tr><td>${esc(vendorById(i.v).name)}</td><td>${esc(i.no)}</td><td class="num">${i.n}</td><td class="num">${kes(i.et)}</td><td class="num">${kes(i.ct)}</td><td class="num"><b>${kes(i.gt)}</b></td><td>${i.draft ? '<span class="muted">After close</span>' : i.etims ? (i.etimsAmt === i.gt ? chip('OK', esc(i.etims)) : chip('BAD', `${esc(i.etims)}: ${kes(i.etimsAmt)} differs`)) : chip('BAD', 'Missing')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No meals in this period.</td></tr>'}</tbody></table></div></section>
    <section class="stack" style="--gap:10px;margin-top:20px"><h2>Deductions per employee</h2><div class="tablewrap"><table><thead><tr><th>Staff no.</th><th>Name</th><th class="num">Meals</th><th class="num">Deduction</th></tr></thead><tbody>
    ${deds.map(d => { const e = empById(d.e); return `<tr><td>${esc(e.staff_no)}</td><td>${esc(e.full_name)}</td><td class="num">${d.n}</td><td class="num">${kes(d.amt)}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">No deductions.</td></tr>'}</tbody></table></div></section>`;
  }
  return `<div class="pagehead"><div><h1>Finance</h1><p class="muted">Meal periods run from the 25th to the 24th. Totals are computed from daily bookings and locked at period close.</p></div></div>${tabs}${body}`;
}

/* ---------- vendor portal ---------- */
function vVendor(u) {
  const v = vendorById(u.vendor_id); const today = ymd(now());
  const orders = state.orders.filter(o => o.v === v.id && o.d >= addDays(today, -7)).sort((a, b) => b.d.localeCompare(a.d));
  const open = []; for (let i = 0; i <= 2; i++) { const d = addDays(today, i); if (!state.orders.some(o => o.v === v.id && o.d === d)) open.push(d); }
  const invs = state.invoices.filter(i => i.v === v.id).sort((a, b) => b.per.localeCompare(a.per));
  const cur = liveInvoices(periodFor(today)).find(i => i.v === v.id);
  return `<div class="pagehead"><div><h1>${esc(v.name)}</h1><p class="muted">Orders and statements for ${esc(v.name)} only. Staff appear by staff number.</p></div></div>
  <div class="stack" style="--gap:22px">
  <section class="stack" style="--gap:10px"><h2>Upcoming</h2><div class="tablewrap"><table><thead><tr><th>Meal date</th><th>Status</th><th class="num">Booked so far</th></tr></thead><tbody>${open.map(d => `<tr><td>${fmtDate(d)}</td><td>${chip('EXPECTED', 'Order arrives ' + fmtDT(cutoffAt(v, d)))}</td><td class="num">${state.bookings.filter(b => b.v === v.id && b.d === d && b.st === 'BOOKED').length}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="stack" style="--gap:10px"><h2>Orders received</h2><div class="tablewrap"><table><thead><tr><th>Meal date</th><th>Delivery</th><th>By shift</th><th class="num">Meals</th><th class="num">Value</th><th>Staff numbers</th></tr></thead><tbody>
  ${orders.map(o => `<tr><td>${fmtDate(o.d)}</td><td>HQ ${o.slot}</td><td class="wrap small">${Object.entries(o.shifts || {}).map(([k, n]) => `${k === 'GUEST' ? 'Guests' : k === 'NIGHT' ? 'Night' : 'Day'}: ${n}`).join('<br>') || '—'}</td><td class="num">${o.staff.length}</td><td class="num">${kes(o.total)}</td><td class="wrap small">${o.staff.join(', ') || '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No orders in the last 7 days.</td></tr>'}</tbody></table></div></section>
  <section class="stack" style="--gap:10px"><h2>Statements</h2>
  ${cur ? `<p class="muted">Current period draft: ${cur.n} meals, ${kes(cur.gt)} so far. Final statement is issued on the 24th.</p>` : ''}
  <div class="tablewrap"><table><thead><tr><th>Statement</th><th>Period</th><th class="num">Meals</th><th class="num">Total</th><th>KRA eTIMS invoice</th></tr></thead><tbody>
  ${invs.map(i => { const p = state.periods[i.per]; return `<tr><td>${esc(i.no)}</td><td>${p ? fmtDate(p.starts) + ' – ' + fmtDate(p.ends) : i.per}</td><td class="num">${i.n}</td><td class="num">${kes(i.gt)}</td><td>${i.etims ? (i.etimsAmt === i.gt ? chip('OK', esc(i.etims)) : chip('BAD', esc(i.etims) + ': amount differs')) : `<form data-form="etims" data-i="${i.id}" class="form"><input name="no" placeholder="eTIMS invoice no." required maxlength="30" aria-label="eTIMS invoice number"><input name="amt" type="number" step="0.01" placeholder="Amount KES" required aria-label="eTIMS amount in KES" style="width:120px"><button class="btn small">Submit</button></form>`}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No final statements yet.</td></tr>'}</tbody></table></div></section></div>`;
}

/* ---------- admin ---------- */
function vAdmin(u) {
  const tab = params().tab || 'people'; const T = [['people', 'People'], ['labelbox', 'Labelbox detection'], ['shifts', 'Projects and shifts'], ['targets', 'Targets'], ['zones', 'Network zones'], ['settings', 'Rules'], ['calendar', 'Statuses and holidays'], ['audit', 'Audit log'], ['jobs', 'Jobs']];
  let b = '';
  if (tab === 'settings') { const s = state.settings; b = `<form data-form="settings" class="panel stack" style="--gap:14px;max-width:640px">${[['finalisation_hours', 'Mark absent after shift start + (hours)'], ['autoclose_grace_hours', 'Auto-close sessions after shift end + (hours)'], ['checkin_lead_hours', 'Allow check-in before shift start (hours)'], ['reason_timeout_hours', 'Submit "No reason given" after (hours)'], ['rating_cap', 'Rating cap (%)'], ['idle_minutes', 'Extension idle threshold (minutes)'], ['meal_reminder_minutes', 'Email a “book your meal” reminder this many minutes before shift end (0 = off)']].map(([k, l]) => `<label class="f">${l}<input type="number" name="${k}" value="${s[k] ?? (k === 'meal_reminder_minutes' ? 30 : '')}" min="0" step="1"></label>`).join('')}<div><button class="btn primary">Save rules</button></div></form>`; }
  if (tab === 'shifts') b = `<div class="stack">${state.projects.map(p => `<section class="panel stack" style="--gap:12px"><h2>${esc(p.name)}</h2>
    <form data-form="project" data-p="${p.id}" class="form"><label class="f" style="min-width:280px">Project timezone<input list="tzlist" name="tz" value="${esc(p.tz)}" required></label><label class="f">Quality target (%)<input type="number" name="qt" value="${p.quality_target}" min="0" max="100" step="0.5"></label><span class="muted small">${esc(tzLabel(p.tz))}</span><button class="btn">Save project</button></form>
    ${state.shiftDefs.filter(d => d.project_id === p.id).map(d => `<form data-form="shift" data-s="${d.id}" class="form"><b style="width:60px">${d.name === 'NIGHT' ? 'Night' : 'Day'}</b><label class="f">Start<input type="time" name="start" value="${d.start}"></label><label class="f">End<input type="time" name="end" value="${d.end}"></label><label class="f">Late after (min)<input type="number" name="grace" value="${d.grace}" min="0" style="width:90px"></label><span class="muted small">${d.end <= d.start ? 'Crosses midnight; belongs to the start date' : 'Same day'}</span><button class="btn small">Save shift</button></form>`).join('')}${addShiftForm(p)}</section>`).join('')}<p class="muted small">Create new projects on the Projects page.</p></div>`;
  if (tab === 'targets') b = `<div class="stack">${state.projects.map(p => { const w = weightsFor(p.id); const d = ymd(now()); return `<form data-form="targets" data-p="${p.id}" class="panel form"><h2 style="width:100%">${esc(p.name)}</h2><label class="f">Labelling target (annotations / productive hr)<input type="number" name="LABEL" value="${targetFor(p.id, 'LABEL', d)}" min="1"></label><label class="f">Review target<input type="number" name="REVIEW" value="${targetFor(p.id, 'REVIEW', d)}" min="1"></label><label class="f">Quantity weight<input type="number" name="q" value="${w.q}" step="0.05" min="0" max="1" style="width:100px"></label><label class="f">Quality weight<input type="number" name="ql" value="${w.ql}" step="0.05" min="0" max="1" style="width:100px"></label><button class="btn">Save from tomorrow</button></form>`; }).join('')}<p class="muted small">Target changes take effect from tomorrow so closed shifts keep the target they were measured against.</p></div>`;
  if (tab === 'zones') b = `<div class="tablewrap"><table><thead><tr><th>Zone</th><th>CIDR</th><th>Status</th><th></th></tr></thead><tbody>${state.zones.map(z => `<tr><td>${esc(z.name)}</td><td>${esc(z.cidr)}</td><td>${z.active ? chip('OK', 'Allowed') : chip('BAD', 'Blocked')}</td><td><button class="btn small" data-act="zone-toggle" data-z="${z.id}">${z.active ? 'Block' : 'Allow'}</button></td></tr>`).join('')}</tbody></table></div>
    <form data-form="zone" class="form panel" style="margin-top:14px"><label class="f">Name<input name="name" required></label><label class="f">CIDR<input name="cidr" required placeholder="10.40.0.0/16" pattern="\\d+\\.\\d+\\.\\d+\\.\\d+/\\d+"></label><button class="btn">Add zone</button></form>`;
  if (tab === 'people') b = peopleView(u);
  if (tab === 'calendar') b = `<div class="grid2"><section class="panel stack" style="--gap:10px"><h2>Status model</h2><div class="tablewrap"><table><thead><tr><th>Code</th><th>Label</th><th>Counts as present</th></tr></thead><tbody>${state.statuses.map(s => `<tr><td>${chip(s.code, s.code)}</td><td><input aria-label="Label for ${s.code}" value="${esc(s.label)}" data-change="status-label" data-c="${s.code}"></td><td>${s.present ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel stack" style="--gap:10px"><h2>Public holidays</h2><div class="tablewrap"><table><tbody>${state.holidays.slice().sort((a, b) => a.date.localeCompare(b.date)).map(h => `<tr><td>${fmtDate(h.date)} ${h.date.slice(0, 4)}</td><td>${esc(h.name)}</td><td><button class="btn small" data-act="holiday-del" data-d="${h.date}">Remove</button></td></tr>`).join('')}</tbody></table></div>
    <form data-form="holiday" class="form"><label class="f">Date<input type="date" name="date" required></label><label class="f">Name<input name="name" required></label><button class="btn">Add holiday</button></form></section></div>`;
  if (tab === 'labelbox') b = labelboxDetectionView();
  if (tab === 'audit') b = `<div class="tablewrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th><th>Source IP</th></tr></thead><tbody>${state.audit.slice().reverse().slice(0, 150).map(a => `<tr><td>${fmtDT(a.at)}</td><td>${esc(a.actor === 'system' ? 'System' : userById(a.actor)?.name || a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.entity)} ${esc(a.entity_id)}</td><td class="wrap small">${esc(a.detail)}</td><td>${esc(a.ip || '—')}</td></tr>`).join('')}</tbody></table></div>`;
  if (tab === 'jobs') { const L = state.jobs.last; b = `<div class="tablewrap"><table><thead><tr><th>Job</th><th>Runs (company time)</th><th>Output</th><th>Last did work</th></tr></thead><tbody>${[
    ['Daily roster', '00:00', 'attendance_days rows', L.roster], ['Absence finalisation', 'Every 15 min', 'AttendanceDayFinalized', L.finalise], ['Auto-close sessions', 'Every 15 min', 'AttendanceSessionAutoClosed', L.autoclose], ['Labelbox sync', 'Every 5 min during shifts', 'production metrics', L.sync], ['Shift close', 'Each shift end', 'ProductionShiftClosed', L.close], ['Daily production summary', 'Shift close + 30 min', 'Email + dashboard', L.summary], ['Meal cut-off', 'Per vendor cut-off', 'VendorOrderDispatched', L.cutoff], ['Meal period close', '24th, 23:59', 'MealPeriodClosed', L.period]
  ].map(([n, r, o, l]) => `<tr><td>${n}</td><td>${r}</td><td>${o}</td><td>${l ? fmtDT(l) : '—'}</td></tr>`).join('')}</tbody></table></div><p class="muted small" style="margin-top:8px">Jobs run continuously as the server clock moves and are idempotent: re-running a date never creates duplicates. Scheduler checked up to ${fmtDT(state.lastJobRun)}.</p>`; }
  return `<div class="pagehead"><div><h1>Admin</h1><p class="muted">Configuration is per project or per company; nothing is hard-coded.</p></div></div>
  <div class="tabs" role="tablist">${T.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-act="tab" data-t="${k}">${l}</button>`).join('')}</div>${b}`;
}
function vEvents(u) {
  const type = params().type || ''; const types = [...new Set(state.outbox.map(e => e.type))].sort();
  const list = state.outbox.filter(e => !type || e.type === type).slice().reverse().slice(0, 150);
  return `<div class="pagehead"><div><h1>Event log</h1><p class="muted">Every state change is written to the outbox with its data, then delivered to the dashboard, reports, email and audit consumers.</p></div>
  <label class="f">Type<select data-change="evtype"><option value="">All events</option>${types.map(t => `<option ${t === type ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
  <div class="tablewrap"><table><thead><tr><th class="num">Seq</th><th>Occurred</th><th>Type</th><th>Subject</th><th>Actor</th><th>Source</th></tr></thead><tbody>
  ${list.map(e => `<tr class="click" data-act="event" data-id="${e.event_id}"><td class="num">${e.seq}</td><td>${fmtDT(Date.parse(e.occurred_at))}</td><td>${esc(e.type)}</td><td>${e.subject.staff_no ? esc(e.subject.staff_no + ' ' + empById(e.subject.employee_id).full_name) : esc(JSON.stringify(e.subject).slice(0, 40))}</td><td>${esc(e.actor.kind)}</td><td>${esc(e.context.network_zone || '—')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No events yet.</td></tr>'}</tbody></table></div>`;
}
function vInbox(u) {
  const list = state.notifications.filter(n => n.u === u.id).slice().reverse();
  const html = `<div class="pagehead"><div><h1>Inbox</h1><p class="muted">Emails the system sent to ${esc(u.name)}. Each goes through the notifications table with retry.</p></div></div>
  <div class="stack" style="--gap:8px">${list.map(n => `<details class="panel" style="padding:12px 16px" ${n.at > ((local.readAt || {})[u.id] || 0) ? 'open' : ''}><summary class="spread" style="display:flex"><b>${esc(n.subject)}</b><span class="muted small">${fmtDT(n.at)}</span></summary><p style="white-space:pre-line;margin-top:8px">${esc(n.body)}</p></details>`).join('') || '<p class="empty">Nothing yet. Emails arrive here as shifts close, meals are booked and periods close.</p>'}</div>`;
  setTimeout(() => { if (route() === 'inbox') { local.readAt = local.readAt || {}; local.readAt[u.id] = now(); save(); } }, 1500);
  return html;
}
const VIEWS = { home: vHome, history: vHistory, performance: vPerformance, meals: vMeals, team: vTeam, teamperf: vTeamPerf, approvals: vApprovals, reports: vReports, overview: vOverview, logistics: vLogistics, finance: vFinance, vendor: vVendor, admin: vAdmin, events: vEvents, inbox: vInbox, employee: vEmployee };
