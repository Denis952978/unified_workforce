/* Collects what content.js sees on Labelbox and reports it to UnifiedWorkforce once a minute.
   Pending reports are kept in storage, so nothing is lost if the browser suspends this worker or goes offline. */
const TICK_SECONDS = 15;

const store = {
  get: keys => new Promise(r => chrome.storage.local.get(keys, r)),
  set: obj => new Promise(r => chrome.storage.local.set(obj, r)),
};
const SIX_HOURS = 6 * 3600 * 1000;
const fresh = () => ({ started: false, task: 'LABEL', activeSeconds: 0, unsentSeconds: 0, items: 0, lastSeen: Date.now() });

async function api(path, opts = {}) {
  const { site, token } = await store.get(['site', 'token']);
  if (!site || !token) throw Object.assign(new Error('Not signed in'), { code: 'NOT_SIGNED_IN' });
  const r = await fetch(site + '/api/v1' + path, { method: opts.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || 'Request failed'), { code: j.code || 'HTTP_' + r.status, status: r.status });
  return j;
}

/* Every change to the saved state goes through this queue, one at a time, so a click that arrives
   while a report is being sent is never overwritten. */
let queue = Promise.resolve();
const serial = fn => { const run = queue.then(fn, fn); queue = run.then(() => undefined, () => undefined); return run; };

/** Messages from Labelbox tabs. */
const onEvent = (msg, tabId) => serial(() => applyEvent(msg, tabId));
async function applyEvent(msg, tabId) {
  const s = await store.get(['token', 'session', 'pending', 'activeTabs']);
  if (!s.token) return;
  // a "session" lasts until the system says no shift is running, or after 6 hours without Labelbox activity (so night shifts keep counting past midnight)
  let session = s.session && Date.now() - (s.session.lastSeen || 0) < SIX_HOURS ? s.session : fresh();
  if (msg.type !== 'tick' || msg.active) session.lastSeen = Date.now();
  const pending = s.pending || []; const activeTabs = s.activeTabs || {};
  if (msg.type === 'start') { session.started = true; session.task = msg.task; pending.push({ type: 'start', task: msg.task, url: msg.url }); }
  if (msg.type === 'item') {
    if (!session.started) { session.started = true; pending.push({ type: 'start', task: msg.task, url: msg.url }); } // opened the editor directly
    session.task = msg.task; session.items++; pending.push({ type: 'item', task: msg.task, count: 1 });
  }
  if (msg.type === 'tick') {
    activeTabs[tabId] = msg.active ? Date.now() : 0; // tabId here is "tab:frame", so an idle embedded frame can't hide an active page
    // credit the 15 s once, however many Labelbox tabs or frames are open
    const anyActive = Object.values(activeTabs).some(t => t && Date.now() - t < (TICK_SECONDS + 5) * 1000);
    const lastCredit = session.lastCredit || 0;
    if (session.started && anyActive && Date.now() - lastCredit >= (TICK_SECONDS - 2) * 1000) { session.activeSeconds += TICK_SECONDS; session.unsentSeconds = (session.unsentSeconds || 0) + TICK_SECONDS; session.lastCredit = Date.now(); }
  }
  await store.set({ session, pending: pending.slice(-200), activeTabs });
  if (msg.type !== 'tick') updateBadge(session);
  if (msg.type === 'start') setTimeout(() => flush().catch(() => undefined), 0);
}

/** Sends everything waiting, plus a heartbeat with the active time since the last one. */
async function flush() {
  // 1. take a snapshot of what to send
  const batch = await serial(async () => {
    const s = await store.get(['token', 'session', 'pending']); if (!s.token) return null;
    const session = s.session || null; const stored = (s.pending || []).slice(0, 49); const events = [...stored];
    const beatSeconds = session && session.started ? Math.min(90, session.unsentSeconds || 0) : 0;
    // a zero-second heartbeat means "idle"; only send it when there is nothing else to report
    if (session && session.started && (beatSeconds > 0 || !events.length)) events.push({ type: 'beat', task: session.task, seconds: beatSeconds });
    return events.length ? { events, sentStored: stored.length, beatSeconds } : null;
  });
  if (!batch) return null;
  // 2. send it (clicks keep being recorded meanwhile)
  let r;
  try { r = await api('/production/activity', { body: { events: batch.events } }); }
  catch (e) {
    await serial(() => store.set({ lastError: { at: Date.now(), code: e.code, message: e.message } }));
    if (e.code === 'NOT_SIGNED_IN' || e.status === 401) chrome.action.setBadgeText({ text: '!' });
    return null;
  }
  // 3. remove exactly what was sent; anything recorded during step 2 stays queued
  await serial(async () => {
    const after = await store.get(['session', 'pending']); const ses = after.session;
    if (ses) { ses.unsentSeconds = Math.max(0, (ses.unsentSeconds || 0) - batch.beatSeconds); if (r && r.counting === false) ses.started = false; }
    await store.set({ pending: (after.pending || []).slice(batch.sentStored), session: ses || null, lastReport: { at: Date.now(), result: r }, lastError: null });
    updateBadge(ses, r);
  });
  return r;
}

async function refreshConfig() {
  try { const c = await api('/extension/config'); await store.set({ detection: c.detection }); } catch (e) { }
}

function updateBadge(session, report) {
  const n = report && report.totals ? report.totals.labelled + report.totals.reviewed : session ? session.items : 0;
  const counting = report ? report.counting : session && session.started;
  chrome.action.setBadgeBackgroundColor({ color: counting ? '#0D5747' : '#8E6200' });
  chrome.action.setBadgeText({ text: session && session.started ? String(n > 999 ? '999+' : n) : '' });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'popup:flush') { flush().then(r => reply({ ok: true, report: r })); return true; }
  if (msg && msg.type === 'popup:config') { refreshConfig().then(() => reply({ ok: true })); return true; }
  if (msg && ['start', 'item', 'tick'].includes(msg.type)) { onEvent(msg, (sender && sender.tab ? sender.tab.id : 0) + ':' + (sender && sender.frameId || 0)); reply({ ok: true }); }
  return false;
});
chrome.alarms.create('uws-flush', { periodInMinutes: 1 });
chrome.alarms.create('uws-config', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'uws-flush') flush(); if (a.name === 'uws-config') refreshConfig(); });
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(refreshConfig);
self.__uws = { onEvent, flush, refreshConfig, api };
