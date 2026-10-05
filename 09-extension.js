
/* ======================= browser extension: status in the app, and detection settings ======================= */
/* The extension (in the /extension folder) watches the Labelbox tab: "Start labeling" opens the
   production shift, Submit / Approve / Reject add to the counts, and working time is credited while the
   tab is in front and the person is active. The server stores this as the "activity" records. */
function extPopup(emp) {
  const t = now(); const date = attendanceDateFor(emp, t); const w = windowFor(emp, date); const ps = pshiftFor(emp.id, date); const a = activityFor(emp.id, date);
  const inShift = w && t >= w.start && t < w.end && rosterStatus(emp, date) === 'EXPECTED';
  const m = ps ? liveMetrics(ps) : null; const fresh = a && a.last && t - a.last < 3 * MIN;
  const status = !a ? ['EXPECTED', 'Waiting for “Start labeling”'] : a.state === 'active' && fresh ? ['PRESENT', a.task === 'REVIEW' ? 'Counting reviews' : 'Counting labels'] : a.state === 'stopped' ? ['COMPLETED', 'Stopped'] : ['WARN', 'Idle (no activity for 5+ min)'];
  return `<div class="ext" aria-label="Browser extension">
  <div class="ext-bar"><span class="brand-mark" style="width:18px;height:18px;font-size:.55rem;border-radius:4px">UW</span>Labelbox tracking, ${esc(emp.full_name)}</div>
  <div class="ext-body">
    ${inShift ? `<div><span class="muted small">Shift ends in</span><div class="timer" data-until="${w.end}"></div></div>` : `<p class="muted">No shift running. ${w && t < w.start ? 'Next shift starts ' + fmtDT(w.start) + '.' : ''}</p>`}
    <div class="spread">${chip(status[0], status[1])}${a && a.last ? `<span class="muted small">Last report ${fmtTime(a.last)}</span>` : ''}</div>
    ${a ? `<div class="stats" style="grid-template-columns:1fr 1fr"><div><span>Labelled</span><b>${(a.ul + (ps && ps.sbL || 0)).toLocaleString()}</b></div><div><span>Reviewed</span><b>${(a.ur + (ps && ps.sbR || 0)).toLocaleString()}</b></div><div><span>Working time</span><b>${fmtDur(a.ls + a.rs)}</b></div><div><span>Quality</span><b>${ps && ps.qual != null ? ps.qual + '%' : '—'}</b></div></div>
    ${m ? `<div><div class="spread small"><span>Quantity vs target</span><b>${m.qty}%</b></div><div class="meter ${m.qty < 100 ? 'low' : ''}"><i style="width:${Math.min(100, m.qty)}%"></i></div></div>` : ''}`
    : `<p class="small">Open Labelbox in Chrome or Edge with the UnifiedWorkforce extension signed in, then click <b>Start labeling</b>. Counting starts by itself.</p>`}
    ${ps && ps.st === 'OPEN' ? `<details><summary class="small muted">Correct the counts by hand</summary>${sandboxForm(ps)}</details>` : ''}
  </div></div>`;
}
function sandboxForm(ps) {
  return `<form data-form="sandbox" data-id="${ps.id}" class="stack" style="--gap:8px;padding-top:8px">
  <span class="small muted">Use only if the extension missed something (for example, work done on another computer). These are added to what the extension counted.</span>
  <div class="form"><label class="f">+ labelled<input type="number" name="l" min="0" value="0" style="width:90px"></label><label class="f">+ reviewed<input type="number" name="r" min="0" value="0" style="width:90px"></label><label class="f">Quality %<input type="number" name="q" min="0" max="100" step="0.1" value="${ps.sbQ == null ? 100 : ps.sbQ}" style="width:80px"></label></div>
  <button class="btn small">Add</button></form>`;
}
function labelboxDetectionView() {
  const d = { hosts: ['labelbox.com'], startLabel: ['start labeling', 'start labelling', 'label data', 'start annotating'], startReview: ['start reviewing', 'start review', 'review data'], submitLabel: ['submit'], submitReview: ['approve', 'reject', 'submit review'], idleMinutes: 5, ...(state.labelboxDetection || {}) };
  const ta = (name, label, help) => `<label class="f">${label}<textarea name="${name}" style="min-height:70px">${esc((d[name] || []).join('\n'))}</textarea><span class="small muted">${help}</span></label>`;
  const today = ymd(now()); const acts = Object.values(state.activity || {}).filter(a => a.d >= addDays(today, -1)).sort((a, b) => (b.last || 0) - (a.last || 0));
  return `<div class="grid2"><form data-form="lb-detect" class="panel stack" style="--gap:12px"><h2>What the extension watches for</h2>
  <p class="muted small">Button names are matched without regard to capitals, one per line. Change them if your Labelbox shows different wording; every extension picks up changes within a few minutes.</p>
  ${ta('startLabel', '“Start labelling” buttons', 'Clicking one starts counting labelling time.')}${ta('startReview', '“Start reviewing” buttons', 'Clicking one starts counting review time.')}
  ${ta('submitLabel', 'Buttons that finish one labelled item', 'Each click adds 1 to “labelled”.')}${ta('submitReview', 'Buttons that finish one reviewed item', 'Each click adds 1 to “reviewed”.')}
  ${ta('hosts', 'Labelbox web addresses', 'The extension only runs on these sites and their subdomains.')}
  <label class="f">Idle after (minutes without keyboard or mouse)<input type="number" name="idleMinutes" min="1" max="30" value="${d.idleMinutes}" style="width:100px"></label>
  <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-act="lb-reset">Restore defaults</button></div></form>
  <section class="panel stack" style="--gap:10px"><h2>Extension reports, today and yesterday</h2>${acts.length ? `<div class="tablewrap"><table><thead><tr><th>Person</th><th>Date</th><th>Status</th><th class="num">Time</th><th class="num">Labelled</th><th class="num">Reviewed</th><th>Last report</th></tr></thead><tbody>${acts.map(a => { const e = empById(a.e); return `<tr><td>${esc(e ? e.full_name : a.e)}</td><td>${fmtDate(a.d)}</td><td>${esc(a.state)}</td><td class="num">${fmtDur(a.ls + a.rs)}</td><td class="num">${a.ul}</td><td class="num">${a.ur}</td><td>${a.last ? fmtDT(a.last) : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">No reports yet. They appear here as soon as someone clicks Start labeling with the extension installed.</p>'}
  <p class="small muted">Install: load the <code>extension</code> folder in Chrome or Edge (or push it to company computers by policy), then each labeller signs in once with their work email and password.</p></section></div>`;
}
Object.assign(FORMS, {
  'lb-detect': f => act(() => {
    if (!has(currentUser(), 'admin')) throw new ApiError(403, 'FORBIDDEN', 'Admins only.');
    const list = k => String(f.get(k) || '').split('\n').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 20);
    const v = { startLabel: list('startLabel'), startReview: list('startReview'), submitLabel: list('submitLabel'), submitReview: list('submitReview'), hosts: list('hosts').map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')), idleMinutes: Math.min(30, Math.max(1, +f.get('idleMinutes') || 5)) };
    if (!v.startLabel.length || !v.submitLabel.length || !v.hosts.length) throw new ApiError(422, 'REQUIRED', 'Keep at least one start button, one submit button and one address.');
    state.labelboxDetection = v; audit(currentUser(), 'admin.LabelboxDetectionChanged', 'settings', 'labelbox', JSON.stringify(v)); toast('Saved. Extensions pick this up within a few minutes.');
  })
});
A['lb-reset'] = () => act(() => { if (!has(currentUser(), 'admin')) throw new ApiError(403, 'FORBIDDEN', 'Admins only.'); delete state.labelboxDetection; toast('Defaults restored.'); });

/** Labelled ('ul') or reviewed ('ur') so far: live from the extension while the shift is open. */
function liveCount(ps, k) { const a = ps.st === 'OPEN' ? activityFor(ps.e, ps.d) : null; return a ? a[k] + (k === 'ul' ? ps.sbL || 0 : ps.sbR || 0) : ps[k]; }
