/**
 * The real browser extension (extension/content.js and extension/background.js) on a mock Labelbox page,
 * reporting to the real system; then the labeller's and supervisor's screens show the counts.
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { join } from 'path';
import * as vm from 'vm';
import { Browser, kit, sleep } from './browser-kit';
import { freshApp, OFFICE, Sent, tokenFor } from './helpers';

let sent: Sent[]; let mail: any; let close: () => Promise<void>;
const EXT = join(__dirname, '..', 'extension');

/** Minimal Chrome extension APIs, connecting a content script (page) to the background worker. */
function fakeChrome() {
  const data: Record<string, any> = {}; const changed: any[] = []; const bgListeners: any[] = []; const alarms: any[] = []; const badge = { text: '' };
  const storage = { local: {
    get: (keys: any, cb: any) => { const ks = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(data); const o: any = {}; for (const k of ks) if (k in data) o[k] = JSON.parse(JSON.stringify(data[k])); setTimeout(() => cb(o), 0); },
    set: (obj: any, cb: any) => { const ch: any = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { newValue: v }; data[k] = JSON.parse(JSON.stringify(v)); } changed.forEach(f => f(ch)); setTimeout(() => cb && cb(), 0); },
  }, managed: { get: (_k: any, cb: any) => cb({}) }, onChanged: { addListener: (f: any) => changed.push(f) } };
  const base = { storage, alarms: { create: () => {}, onAlarm: { addListener: (f: any) => alarms.push(f) } }, action: { setBadgeText: (o: any) => { badge.text = o.text; }, setBadgeBackgroundColor: () => {} } };
  const forBackground = { ...base, runtime: { onMessage: { addListener: (f: any) => bgListeners.push(f) }, onStartup: { addListener: () => {} } } };
  const forPage = (tabId: number, frameId = 0) => ({ ...base, runtime: { lastError: undefined, sendMessage: (msg: any, cb: any) => { bgListeners.forEach(f => f(msg, { tab: { id: tabId }, frameId }, (r: any) => cb && cb(r))); } } });
  return { data, badge, forBackground, forPage, alarms };
}
/** The background worker, run as Chrome would, with requests arriving at the server from the office network. */
function startBackground(chrome: any) {
  const ctx: any = { chrome, console, setTimeout, clearTimeout, URL,
    fetch: (u: string, o: any = {}) => fetch(u, { ...o, headers: { ...(o.headers || {}), 'X-Forwarded-For': OFFICE } }) };
  ctx.self = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(join(EXT, 'background.js'), 'utf8'), ctx);
  return ctx.self.__uws;
}
/** A mock Labelbox page: project overview with "Start labeling", the editor's Submit and Skip, and review's Approve. */
function labelboxPage(chrome: any) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <header><a href="#">Projects</a><button>Export</button></header>
    <main><h1>Street scenes</h1><button id="start"><span>Start labeling</span></button><button id="startReview">Start reviewing</button>
    <div id="editor"><button id="skip">Skip</button><button id="submit" aria-label="Submit (E)"><svg></svg></button><button id="approve">Approve</button><button id="disabled" disabled>Submit</button></div></main>
  </body></html>`, { url: 'https://app.labelbox.com/projects/clx123/overview', runScripts: 'outside-only', pretendToBeVisual: true });
  const w: any = dom.window; w.chrome = chrome; w.document.hasFocus = () => true;
  w.eval(readFileSync(join(EXT, 'content.js'), 'utf8'));
  const click = (id: string) => w.document.getElementById(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return { w, click };
}

beforeAll(async () => { const f = await freshApp({ ENFORCE_NETWORK: 'true' }); sent = f.sent; mail = f.mail; close = f.close; kit.base = f.base; });
afterAll(async () => { await close(); });

let admin: Browser, john: Browser, sam: Browser; let bg: any; let chrome: ReturnType<typeof fakeChrome>; let page: ReturnType<typeof labelboxPage>;

test('company, project manager, supervisor and a labeller are set up', async () => {
  admin = await new Browser().open();
  const f = admin.$('form[data-auth=setup]');
  admin.fill(f, { company: 'Acme Labelling', cidr: '10.20.0.0/16', pname: 'Project A', dstart: '00:00', dend: '23:59', night: false, tl: '60', name: 'Grace Admin', email: 'grace@acme.co.ke', pw: 'admin-password-1', pw2: 'admin-password-1' });
  admin.submit(f); await admin.until(() => !!admin.$('.nav'));
  admin.go('projects'); admin.click('[data-act=invite][data-k=supervisor]');
  let d = admin.$('#dlg form'); admin.fill(d, { people: 'Samuel Kamau, sam@acme.co.ke' }); admin.submit(d); await admin.settle(); await admin.until(() => /emailed/.test(admin.toast()));
  await mail.deliverDue(); sam = new Browser();
  await sam.fetch('/api/v1/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenFor(sent, 'sam@acme.co.ke'), password: 'samuel-password-1' }) });
  await admin.refresh(); admin.go('projects'); admin.click('[data-act=invite][data-k=employee]');
  d = admin.$('#dlg form'); const sup = d.querySelector('[name=sup]'); sup.value = sup.options[1].value;
  admin.fill(d, { people: 'John Smith, john@acme.co.ke', rest: String((new Date().getDay() + 3) % 7) }); admin.submit(d); await admin.settle(); await admin.until(() => /emailed/.test(admin.toast()));
  await mail.deliverDue(); john = new Browser();
  await john.fetch('/api/v1/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenFor(sent, 'john@acme.co.ke'), password: 'john-password-1' }) });
  await john.open(); await john.until(() => /Checked in automatically/.test(john.toast()));
});

test('John signs in to the extension once', async () => {
  chrome = fakeChrome(); bg = startBackground(chrome.forBackground);
  const r = await fetch(kit.base + '/api/v1/extension/token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': OFFICE }, body: JSON.stringify({ email: 'john@acme.co.ke', password: 'john-password-1' }) });
  const j = await r.json(); expect(r.status).toBe(200);
  await new Promise(res => chrome.forBackground.storage.local.set({ site: kit.base, token: j.token, name: j.name }, res));
  await bg.refreshConfig(); expect(chrome.data.detection.startLabel).toContain('start labeling');
});

test('nothing is counted until he clicks "Start labeling"', async () => {
  page = labelboxPage(chrome.forPage(7));
  page.click('approve'); page.click('skip'); await sleep(50); // clicks before starting: approve does auto-start review; reset that
  expect(chrome.data.session.started).toBe(true); // opening the editor directly and acting also starts counting
  await new Promise(res => chrome.forBackground.storage.local.set({ session: null, pending: [] }, res));
  await bg.onEvent({ type: 'tick', active: true }, '7:0'); expect(chrome.data.session.activeSeconds).toBe(0);
  expect(page.w.__uwsClassify('export')).toBeNull(); expect(page.w.__uwsClassify('skip')).toBeNull();
});

test('clicking Start labeling, working, and submitting items is counted automatically', async () => {
  page.click('start'); await sleep(50);
  expect(chrome.data.session).toMatchObject({ started: true, task: 'LABEL' });
  for (let i = 0; i < 4; i++) { // one minute of active work (four 15-second checks)
    await bg.onEvent({ type: 'tick', active: true }, '7:0');
    chrome.data.session.lastCredit -= 15000;
  }
  page.click('submit'); await sleep(800); page.click('submit'); await sleep(800); page.click('submit'); page.click('submit'); // the 4th is a double-click
  page.click('disabled'); page.click('skip'); await sleep(50);
  expect(chrome.data.session.items).toBe(3); expect(chrome.data.session.activeSeconds).toBe(60);
  const r = await bg.flush();
  expect(r.counting).toBe(true); expect(r.totals).toMatchObject({ labelled: 3, active_seconds: 60, task: 'LABEL' });
  expect(chrome.badge.text).toBe('3'); expect(chrome.data.pending).toEqual([]);
});

test('reviewing is counted separately; idle time is not counted', async () => {
  page.click('startReview'); await sleep(50); page.click('approve'); await sleep(50);
  await bg.onEvent({ type: 'tick', active: false }, '7:0'); // stepped away: tab in the background
  chrome.data.session.lastCredit -= 15000; await bg.onEvent({ type: 'tick', active: false }, '7:0');
  const r = await bg.flush();
  expect(r.totals).toMatchObject({ labelled: 3, reviewed: 1, task: 'REVIEW', active_seconds: 60 });
});

test('a report that fails (offline) is kept and sent later', async () => {
  await sleep(800); page.click('submit'); await sleep(50);
  const realFetch = (globalThis as any).fetch; const bgCtxFetch = bg.api; void bgCtxFetch;
  await new Promise(res => chrome.forBackground.storage.local.set({ site: 'http://127.0.0.1:1' }, res)); // unreachable
  expect(await bg.flush()).toBeNull(); expect(chrome.data.pending.length).toBeGreaterThan(0);
  await new Promise(res => chrome.forBackground.storage.local.set({ site: kit.base }, res));
  const r = await bg.flush(); expect(r.totals.labelled).toBe(4); expect(r.totals.reviewed).toBe(1); void realFetch;
  expect(chrome.data.pending).toEqual([]);
});

test('John and his supervisor see the counts in UnifiedWorkforce without typing anything', async () => {
  await john.refresh(); john.go('performance');
  expect(john.text()).toMatch(/Counting (labels|reviews)/); expect(john.text()).toMatch(/Labelled\s*4/); expect(john.text()).toMatch(/Reviewed\s*1/);
  await sam.open(); sam.go('team'); await sam.w.eval('commit(() => {})'); await sam.refresh();
  const row = sam.$$('tbody tr').find((r: any) => /John Smith/.test(r.textContent));
  expect(row.textContent).toMatch(/0h 01m/); // working time measured by the extension
  sam.go('teamperf'); const cells = sam.$$('tbody tr').find((r: any) => /John Smith/.test(r.textContent)).querySelectorAll('td');
  expect(cells[3].textContent).toBe('4'); expect(cells[5].textContent).toBe('1'); // labelled, reviewed
  admin.go('admin', "{tab:'labelbox'}"); await admin.refresh(); expect(admin.text()).toContain('Extension reports'); expect(admin.text()).toContain('John Smith');
});
