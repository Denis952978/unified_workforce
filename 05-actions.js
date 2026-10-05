
/* ======================= actions ======================= */
const setP = (k, v) => { local.session.params = { ...params(), [k]: v }; save(); render(true); };
const A = {
  nav: d => go(d.r),
  emp: d => go('employee', { e: d.e }),
  tab: d => setP('tab', d.t),
  filter: d => setP('f', d.f),
  'meal-date': d => setP('date', d.d),
  checkin: () => act(net => { const u = currentUser(); const r = doCheckIn(empOf(u), now(), net, 'button', u); toast(r.existing ? `Already checked in since ${fmtTime(r.session.in)}.` : `Checked in at ${fmtTime(r.session.in)}.`); }),
  'checkout-confirm': () => openDialog(`<div class="stack"><h2>Check out now?</h2><p class="muted">Your presence time stops at the server's current time.</p><div class="row"><button class="btn primary" data-act="checkout">Check out</button><button class="btn" data-act="dlg-close">Keep working</button></div></div>`),
  checkout: () => { closeDialog(); act(net => { const u = currentUser(); const s = doCheckOut(empOf(u), now(), net, 'USER', u); toast(`Checked out at ${fmtTime(s.out)}. Session ${fmtDur(s.dur, true)}.`); }); },
  'dlg-close': () => closeDialog(),
  ext: d => act(net => { const u = currentUser(); const emp = empOf(u); const ex = state.ext[emp.id] || (state.ext[emp.id] = { state: 'closed', task: 'LABEL', beats: 0 });
    if (d.s === 'active') startProduction(emp, now(), net, u); ex.state = d.s; }),
  'ext-task': d => act(() => { const emp = empOf(currentUser()); const ex = state.ext[emp.id] || (state.ext[emp.id] = { state: 'closed', task: 'LABEL', beats: 0 }); ex.task = d.s; }),
  book: d => act(net => { const u = currentUser(); const emp = empById(d.e); if (emp.id !== u.employee_id) throw new ApiError(403, 'NOT_IN_SCOPE', 'You can only book your own meals.'); const b = bookMeal(emp, d.d, !!d.i, now(), net, u); toast(b.st === 'NO_MEAL' ? `No meal on ${fmtDate(d.d)}. Saved.` : `Meal booked for ${fmtDate(d.d)}. Confirmation sent to your inbox.`); }),
  'cancel-booking': d => act(net => { const u = currentUser(); const b = state.bookings.find(x => x.id === d.b); if (!b || b.e !== u.employee_id) throw new ApiError(403, 'NOT_IN_SCOPE', 'Not your booking.'); cancelBooking(b, now(), net, u); toast('Booking cancelled.'); }),
  'adj-open': d => {
    const e = empById(d.e); const ss = sessionsFor(e.id, d.d); const tz = displayTz();
    const local = ms => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
    openDialog(`<form data-form="adj" class="stack" style="--gap:12px"><h2>Request a correction</h2><p class="muted">${esc(e.full_name)}, ${fmtDate(d.d)}. Times are in ${esc(tz)}. The original record is kept.</p>
    <label class="f">Session<select name="sid">${ss.map(s => `<option value="${s.id}">${fmtTime(s.in)} – ${s.out ? fmtTime(s.out) : 'open'}${s.cr === 'AUTO_CLOSED' ? ' (auto-closed)' : ''}</option>`).join('')}</select></label>
    <label class="f">Field<select name="field"><option value="check_out_at">Check-out</option><option value="check_in_at">Check-in</option></select></label>
    <label class="f">Correct time<input type="datetime-local" name="nv" required value="${local(ss[0].out || ss[0].in)}"></label>
    <label class="f">Reason (required)<textarea name="reason" required maxlength="300" placeholder="e.g. Forgot to check out; left at 15:10 per gate log"></textarea></label>
    <div class="row"><button class="btn primary">Send for approval</button><button type="button" class="btn" data-act="dlg-close">Cancel</button></div></form>`);
  },
  'adj-approve': d => act(() => { const u = currentUser(); const a = state.adjustments.find(x => x.id === d.a); applyAdjustment(a, u, now()); notify([a.req], `Correction approved: ${empById(a.e).full_name}, ${fmtDate(a.d)}`, `Approved by ${u.name}. The day has been recalculated.`); toast('Correction approved and day recalculated.'); }),
  'adj-reject': d => act(() => { const u = currentUser(); const a = state.adjustments.find(x => x.id === d.a); a.status = 'REJECTED'; a.by = u.id; audit(u, 'attendance.AdjustmentRejected', 'adjustment', a.id, a.reason); notify([a.req], `Correction rejected: ${empById(a.e).full_name}, ${fmtDate(a.d)}`, `Rejected by ${u.name}.`); toast('Correction rejected.'); }),
  'leave-cancel': d => act(() => { const u = currentUser(); const l = state.leave.find(x => x.id === d.l); if (!canSee(u, l.e)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Outside your scope.'); cancelLeave(l, u, now()); toast('Leave cancelled. Future days return to the roster.'); }),
  'menu-toggle': d => act(() => { const u = currentUser(); if (!has(u, 'logistics') && !has(u, 'admin')) throw new ApiError(403, 'FORBIDDEN', 'Only Logistics can edit menus.'); const m = itemById(d.m); m.active = !m.active; audit(u, 'meals.MenuItemToggled', 'menu_item', m.id, m.name + (m.active ? ' added' : ' removed')); }),
  'zone-toggle': d => act(() => { const u = currentUser(); const z = state.zones.find(x => x.id === d.z); const active = netCtx().zone_id === z.id; z.active = !z.active; audit(u, 'admin.NetworkZoneChanged', 'network_zone', z.id, `${z.name} ${z.active ? 'allowed' : 'blocked'}`); if (active && !z.active) toast('You blocked the zone you are connected from. Switch device to keep working.', true); }),
  'holiday-del': d => act(() => { const u = currentUser(); state.holidays = state.holidays.filter(h => h.date !== d.d); audit(u, 'admin.HolidayRemoved', 'holiday', d.d, ''); refreshRoster(d.d); }),
  event: d => { const e = state.outbox.find(x => x.event_id === d.id); openDialog(`<div class="stack"><div class="spread"><h2>${esc(e.type)}</h2><button class="btn small" data-act="dlg-close">Close</button></div><pre class="json">${esc(JSON.stringify({ ...e, seq: undefined }, null, 2))}</pre></div>`); },
  export: d => doExport(d.k, d.per),
  adv: d => actSys(() => { if (!canClock()) throw new ApiError(403, 'FORBIDDEN', 'Only admins move the shared clock.'); const before = state.seq; state.clockOffset += +d.ms; runJobs(); const n = state.seq - before; toast(`Server clock moved ${fmtDur(+d.ms / 1000)} for everyone. ${n} event${n === 1 ? '' : 's'} recorded.`); }),
  reset: () => openDialog(`<div class="stack"><h2>Erase all data?</h2><p class="muted">This deletes every account, project, record and setting for everyone using this page. The page owner then sets the company up again. It cannot be undone.</p><div class="row"><button class="btn danger" data-act="reset-go">Erase everything</button><button class="btn" data-act="dlg-close">Keep my data</button></div></div>`),
  'reset-go': () => { closeDialog(); actSys(() => { if (!canClock()) throw new ApiError(403, 'FORBIDDEN', 'Only admins can erase data.'); state = blankState(); }); },
};
function refreshRoster(date) { for (const e of state.employees) { const day = state.days[e.id + '|' + date]; if (day && !sessionsFor(e.id, date).length && ['EXPECTED', 'REST_DAY', 'HOLIDAY', 'LEAVE'].includes(day.st)) day.st = rosterStatus(e, date); } }
const FORMS = {
  reason: (f, d) => act(() => { const u = currentUser(); const ps = state.pshifts.find(p => p.id === d.id); if (ps.e !== u.employee_id) throw new ApiError(403, 'NOT_IN_SCOPE', 'Not your shift.'); if (ps.st !== 'AWAITING_REASON') throw new ApiError(409, 'ALREADY_SUBMITTED', 'This report was already submitted.'); submitReport(ps, now(), { cat: f.get('cat'), text: f.get('text').trim() }, u); toast('Shift report submitted. A copy is in your inbox and your supervisor can see it now.'); }),
  adj: f => { closeDialog(); act(() => { const u = currentUser(); const s = state.sessions.find(x => x.id === f.get('sid')); if (!canSee(u, s.e)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Outside your scope.');
    const [dd, tt] = f.get('nv').split('T'); const nv = zoned(dd, tt, displayTz()); const field = f.get('field');
    const a = { id: uid('adj_'), sid: s.id, e: s.e, d: s.d, field, ov: field === 'check_in_at' ? s.in : s.out, nv, reason: f.get('reason').trim(), req: u.id, status: 'PENDING', at: now() };
    if (!a.reason) throw new ApiError(422, 'REASON_REQUIRED', 'A reason is required.');
    state.adjustments.push(a); audit(u, 'attendance.AdjustmentRequested', 'session', s.id, a.reason);
    const pid = assignmentOf(s.e)?.project_id; notify(state.users.filter(x => roleProjects(x, 'project_manager').includes(pid) || has(x, 'admin')).map(x => x.id), `Correction to approve: ${empById(s.e).full_name}, ${fmtDate(s.d)}`, `${u.name} requested ${field === 'check_in_at' ? 'check-in' : 'check-out'} ${fmtTime(nv, COMPANY_TZ)} (${COMPANY_TZ}).\nReason: ${a.reason}`);
    if (has(u, 'admin')) { applyAdjustment(a, u, now()); toast('Correction applied (admin).'); } else toast('Correction sent to the Project Manager for approval.'); }); },
  leave: (f, d) => act(() => { const u = currentUser(); const e = empById(d.e); if (!canSee(u, e.id)) throw new ApiError(403, 'NOT_IN_SCOPE', 'Outside your scope.'); const s = f.get('start'), en = f.get('end'); if (en < s) throw new ApiError(422, 'INVALID_RANGE', 'The end date is before the start date.'); approveLeave(e, s, en, f.get('type'), u, now()); toast('Leave recorded.'); }),
  guest: f => act(net => { const u = currentUser(); const mt = f.get('mt'); const d = f.get('d'); const v = vendorFor(mt); if (!v) throw new ApiError(409, 'NO_VENDOR', 'No vendor serves that meal.'); if (now() >= cutoffAt(v, d)) throw new ApiError(409, 'BOOKING_CUTOFF_PASSED', 'That date has passed its cut-off.');
    const per = periodFor(d); const r = priceRule('GUEST', d);
    const b = { id: uid('b_'), e: null, g: f.get('g').trim(), d, mt, item: null, v: v.id, es: 0, cs: r.cs, st: 'BOOKED', at: now(), per: per.id, col: null, by: u.id }; state.bookings.push(b);
    emit('meals.MealBooked', { booking_id: b.id, meal_date: d, guest: b.g, company_share_cents: b.cs }, { actor: u, ctx: net, entity: 'booking', entity_id: b.id }); toast('Guest meal booked, charged to the company.'); }),
  vendor: (f, d) => act(() => { const u = currentUser(); const v = vendorById(d.v); ['meal_type', 'deadline', 'slot', 'email'].forEach(k => v[k] = f.get(k)); v.lead_min = Math.max(0, +f.get('lead_min')); audit(u, 'meals.VendorUpdated', 'vendor', v.id, `${v.meal_type}, deadline ${v.deadline}, lead ${v.lead_min}m`); toast('Vendor saved.'); }),
  'menu-add': (f, d) => act(() => { const u = currentUser(); const m = { id: uid('m_'), v: d.v, name: f.get('name').trim(), active: true }; state.menu.push(m); audit(u, 'meals.MenuItemAdded', 'menu_item', m.id, m.name); toast('Menu item added.'); }),
  etims: (f, d) => act(() => { const u = currentUser(); const i = state.invoices.find(x => x.id === d.i); if (i.v !== u.vendor_id) throw new ApiError(403, 'NOT_IN_SCOPE', 'Not your invoice.'); i.etims = f.get('no').trim(); i.etimsAmt = Math.round(+f.get('amt') * 100); audit(u, 'meals.EtimsSubmitted', 'vendor_invoice', i.id, i.etims); toast(i.etimsAmt === i.gt ? 'eTIMS invoice matched to the statement.' : 'Saved, but the amount does not match the statement. Finance will see a mismatch.', i.etimsAmt !== i.gt); }),
  price: f => act(() => { const u = currentUser(); const mt = f.get('mt'), from = f.get('from'); const prev = priceRule(mt, from); if (prev && prev.from >= from) throw new ApiError(422, 'INVALID_DATE', 'A rule already starts on or after that date.'); if (prev) prev.to = addDays(from, -1); state.priceRules.push({ id: uid('pr_'), mt, es: Math.round(+f.get('es') * 100), cs: Math.round(+f.get('cs') * 100), from, to: null }); audit(u, 'admin.PriceRuleAdded', 'price_rule', mt, `from ${from}`); toast('Price rule added.'); }),
  settings: f => act(() => { const u = currentUser(); for (const k of new Set([...Object.keys(state.settings), 'meal_reminder_minutes'])) if (f.has(k)) state.settings[k] = Math.max(0, +f.get(k)); state.settings.meal_reminder_minutes = Math.min(240, state.settings.meal_reminder_minutes ?? 30); audit(u, 'admin.SettingsChanged', 'settings', '', JSON.stringify(state.settings)); toast('Rules saved.'); }),
  project: (f, d) => act(() => { const u = currentUser(); const tz = f.get('tz').trim(); if (!validTz(tz)) throw new ApiError(422, 'INVALID_TIMEZONE', `"${tz}" is not an IANA timezone. Pick one from the list.`); const p = projById(d.p); p.tz = tz; p.quality_target = +f.get('qt'); mem.win.clear(); audit(u, 'admin.ProjectChanged', 'project', p.id, `tz ${tz}`); toast('Project saved.'); }),
  shift: (f, d) => act(() => { const u = currentUser(); const s = defById(d.s); s.start = f.get('start'); s.end = f.get('end'); s.grace = +f.get('grace'); mem.win.clear(); audit(u, 'admin.ShiftChanged', 'shift_definition', s.id, `${s.start}-${s.end}`); toast('Shift saved. It applies to windows not yet started.'); }),
  targets: (f, d) => act(() => { const u = currentUser(); const from = addDays(ymd(now()), 1); for (const task of ['LABEL', 'REVIEW']) { state.targets = state.targets.filter(x => !(x.p === d.p && x.task === task && x.from === from)); state.targets.push({ p: d.p, task, uph: +f.get(task), from }); }
    const q = +f.get('q'), ql = +f.get('ql'); if (Math.abs(q + ql - 1) > 0.001) throw new ApiError(422, 'INVALID_WEIGHTS', 'Quantity and quality weights must add up to 1.'); state.weights[d.p] = { q, ql }; audit(u, 'admin.TargetsChanged', 'production_targets', d.p, `from ${from}`); toast('Targets saved from tomorrow; weights apply to shifts closing from now.'); }),
  zone: f => act(() => { const u = currentUser(); const cidr = f.get('cidr').trim(); const z = { id: uid('z_'), name: f.get('name').trim(), cidr, active: true }; state.zones.push(z); audit(u, 'admin.NetworkZoneAdded', 'network_zone', z.id, cidr); toast('Zone added.'); }),
  holiday: f => act(() => { const u = currentUser(); const date = f.get('date'); state.holidays = state.holidays.filter(h => h.date !== date); state.holidays.push({ date, name: f.get('name').trim() }); audit(u, 'admin.HolidayAdded', 'holiday', date, f.get('name')); refreshRoster(date); toast('Holiday added.'); })
};
const CHANGES = {
  nav: el => go(el.value),
  month: el => setP('month', el.value),
  proj: el => setP('p', el.value),
  shiftf: el => setP('sh', el.value),
  pdate: el => setP('date', el.value),
  per: el => setP('per', el.value),
  evtype: el => setP('type', el.value),
  device: el => { local.device.ip = el.value; save(); render(true); const c = netCtx(); toast(c.zone ? `Now connecting from ${esc(c.ip)} on ${esc(c.zone)}.` : `<code>403</code> ${esc(c.ip)} is outside the allowlist; every request will be refused.`, !c.zone); },
  jump: el => { if (!el.value) return; const target = +el.value; actSys(() => { if (!canClock()) throw new ApiError(403, 'FORBIDDEN', 'Only admins move the shared clock.'); const delta = target - now(); if (delta <= 0) return; const before = state.seq; state.clockOffset += delta; runJobs(); toast(`Server clock now ${fmtDT(now())} for everyone. ${state.seq - before} events recorded on the way.`); }); },
  tz: el => { const u = currentUser(); const v = el.value.trim(); if (!validTz(v)) { toast(`<code>INVALID_TIMEZONE</code> Pick a timezone from the list.`, true); return; } local.tz = v; save(); render(true); },
  collected: el => act(() => { const u = currentUser(); const b = state.bookings.find(x => x.id === el.dataset.b); b.col = el.checked; audit(u, 'meals.CollectionMarked', 'booking', b.id, el.checked ? 'collected' : 'no-show'); }),
  'emp-shift': el => act(() => { const u = currentUser(); const e = empById(el.dataset.e); e.shift_id = el.value; mem.win.clear(); audit(u, 'admin.ShiftAssignmentChanged', 'employee', e.staff_no, el.value); toast(`${e.full_name} moves to ${defById(el.value).name.toLowerCase()} shift from the next roster.`); }),
  'status-label': el => act(() => { const s = state.statuses.find(x => x.code === el.dataset.c); s.label = el.value.trim() || s.code; audit(currentUser(), 'admin.StatusLabelChanged', 'attendance_status', s.code, s.label); })
};
async function doExport(kind, perId) {
  const per = state.periods[perId]; let csv, name;
  if (kind === 'payroll') { csv = 'staff_no,full_name,period_start,period_end,meals,deduction_kes\n' + liveDeductions(per).map(d => { const e = empById(d.e); return [e.staff_no, `"${e.full_name}"`, per.starts, per.ends, d.n, (d.amt / 100).toFixed(2)].join(','); }).join('\n'); name = `payroll-meal-deductions-${per.id}.csv`; }
  else { csv = 'vendor,statement,meals,employee_share_kes,company_share_kes,total_kes,etims_invoice,etims_matched\n' + liveInvoices(per).map(i => [`"${vendorById(i.v).name}"`, i.no, i.n, (i.et / 100).toFixed(2), (i.ct / 100).toFixed(2), (i.gt / 100).toFixed(2), i.etims || '', i.etims && i.etimsAmt === i.gt ? 'yes' : 'no'].join(',')).join('\n'); name = `finance-report-${per.id}.csv`; }
  try { const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; if (dl) { await dl.save({ filename: name, data: csv }); return; } } catch (e) { if (e && e.code && e.code !== 'not_granted' && e.code !== 'unavailable') { toast('Download was not saved.', true); return; } }
  openDialog(`<div class="stack"><div class="spread"><h2>${esc(name)}</h2><button class="btn small" data-act="dlg-close">Close</button></div><p class="muted small">Downloads aren't available in this view. Copy the file contents below.</p><textarea style="width:100%;min-height:260px;font-size:.8rem" readonly>${esc(csv)}</textarea></div>`);
}

/* ======================= wiring ======================= */
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el) return; if (el.tagName === 'INPUT') return; e.preventDefault(); const fn = A[el.dataset.act]; if (fn) fn(el.dataset, el); });
document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); const fn = FORMS[f.dataset.form]; if (fn) { const a = document.activeElement; if (a) a.blur(); fn(new FormData(f), f.dataset); } });
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (!el) return; const fn = CHANGES[el.dataset.change]; if (fn) { if (el.tagName === 'INPUT' && el.type !== 'checkbox') el.blur(); fn(el); } });
document.addEventListener('focusout', () => setTimeout(() => { if (mem.pendingRender && !isTyping()) render(); }, 50));
$('#dlg').addEventListener('click', e => { if (e.target.id === 'dlg' && !$('#dlg form[data-pw="forced"]')) closeDialog(); });

function tickTimers() {
  const t = now();
  document.querySelectorAll('[data-since]').forEach(el => { const s = (t - +el.dataset.since) / 1000; el.textContent = fmtDur(s, el.dataset.fmt !== 'hm' || el.classList.contains('clock')); });
  document.querySelectorAll('[data-until]').forEach(el => { el.textContent = fmtDur((+el.dataset.until - t) / 1000, true); });
  document.querySelectorAll('[data-clock]').forEach(el => { const tz = el.dataset.clock; const p = parts(t, tz); el.textContent = el.dataset.short ? `${p.hour}:${p.minute}:${p.second}` : `${fmtDate(ymd(t, tz))}, ${p.hour}:${p.minute}:${p.second} ${tzLabel(tz, t)}`; });
}
