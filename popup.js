const $ = id => document.getElementById(id);
const get = k => new Promise(r => chrome.storage.local.get(k, r));
const set = o => new Promise(r => chrome.storage.local.set(o, r));
const dur = s => { s = Math.round(s || 0); return `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m`; };

async function show() {
  const { token, site, name } = await get(['token', 'site', 'name']);
  if (!token) {
    $('login').hidden = false; $('main').hidden = true;
    const managed = await new Promise(r => { try { chrome.storage.managed.get('siteUrl', v => r((v && v.siteUrl) || '')); } catch (e) { r(''); } });
    $('site').value = site || managed || '';
    return;
  }
  $('login').hidden = true; $('main').hidden = false; $('who').textContent = `Signed in as ${name}`; $('open').href = site;
  chrome.runtime.sendMessage({ type: 'popup:flush' }, () => load());
}
async function load() {
  const { token, site, session } = await get(['token', 'site', 'session']);
  try {
    const r = await fetch(site + '/api/v1/production/me', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json(); if (!r.ok) throw j;
    $('err').hidden = true;
    const t = j.totals; const started = !!(session && session.started);
    $('status').className = 'status' + (j.counting && started ? ' on' : '');
    $('status').textContent = !j.counting ? 'Not counting' : started ? (t && t.task === 'REVIEW' ? 'Counting your reviews' : 'Counting your labels') : 'Waiting for “Start labeling”';
    $('lab').textContent = t ? t.labelled : 0; $('rev').textContent = t ? t.reviewed : 0; $('time').textContent = dur(t ? t.active_seconds : 0);
    $('pct').textContent = t && t.quantity_pct != null ? t.quantity_pct + '%' : '—';
    $('hint').textContent = !j.counting ? j.reason : started ? `Shift ${j.shift.start}–${j.shift.end}. Time counts while Labelbox is in front and you're active.` : 'Open Labelbox and click Start labeling (or Start reviewing).';
  } catch (e) {
    $('err').hidden = false; $('err').textContent = e && e.code === 'NOT_SIGNED_IN' ? 'Your sign-in has expired. Sign out and sign in again.' : (e && e.message) || 'Could not reach UnifiedWorkforce.';
  }
}
$('login').addEventListener('submit', async ev => {
  ev.preventDefault(); $('loginErr').hidden = true; $('go').disabled = true;
  try {
    const site = new URL($('site').value.trim()).origin;
    const granted = await new Promise(r => chrome.permissions.request({ origins: [site + '/*'] }, r));
    if (!granted) throw new Error('Allow the extension to reach your company address to continue.');
    const r = await fetch(site + '/api/v1/extension/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('email').value.trim(), password: $('pw').value }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'Sign-in failed.');
    await set({ site, token: j.token, name: j.name, session: null, pending: [] });
    chrome.runtime.sendMessage({ type: 'popup:config' });
    show();
  } catch (e) { $('loginErr').hidden = false; $('loginErr').textContent = e.message; }
  finally { $('go').disabled = false; }
});
$('refresh').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'popup:flush' }, () => load()));
$('out').addEventListener('click', async () => { await set({ token: null, name: null, session: null, pending: [] }); chrome.action.setBadgeText({ text: '' }); show(); });
show();
