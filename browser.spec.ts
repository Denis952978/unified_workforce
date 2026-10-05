/**
 * The real web app (public/app.js) in simulated browsers, against the real server and database.
 * Each "browser" has its own cookies and appears to come from the office network through the proxy.
 */
import { JSDOM } from 'jsdom';
import { freshApp, OFFICE, Sent, tokenFor } from './helpers';

let sent: Sent[]; let mail: any; let base = ''; let close: () => Promise<void>;
const downloads: { name: string; size: number; type: string }[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class Browser {
  dom!: JSDOM; cookies = new Map<string, string>();
  constructor(public ip = OFFICE) {}
  async fetch(url: string, opts: any = {}) {
    const headers = { ...(opts.headers || {}), 'X-Forwarded-For': this.ip, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    const r = await fetch(new URL(url, base), { ...opts, headers });
    for (const c of (r.headers as any).getSetCookie?.() || []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); const val = v.join('='); if (/Expires=Thu, 01 Jan 1970/i.test(c) || val === '') this.cookies.delete(k); else this.cookies.set(k, val); }
    return r;
  }
  async open() {
    const html = await (await this.fetch('/')).text(); const js = await (await this.fetch('/app.js')).text();
    const self = this;
    this.dom = new JSDOM(html.replace('<script src="/app.js"></script>', '<script>' + js.replace(/<\/script/g, '<\\/script') + '</script>'), { url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w: any) {
        w.fetch = (u: string, o: any) => self.fetch(u, o); w.scrollTo = () => {};
        w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; };
        w.URL.createObjectURL = (b: any) => { downloads.push({ name: '', size: b.size, type: b.type }); return 'blob:x'; }; w.URL.revokeObjectURL = () => {};
        w.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads[downloads.length - 1].name = this.download; };
        w.addEventListener('error', (e: any) => console.log('PAGE ERROR', e.message));
      } });
    await this.until(() => !/Loading…|Preparing the workforce/.test(this.text()));
    return this;
  }
  get w(): any { return this.dom.window; }
  $(s: string) { return this.w.document.querySelector(s); }
  $$(s: string) { return [...this.w.document.querySelectorAll(s)]; }
  text() { return (this.$('#main') || this.$('#root')).textContent.replace(/\s+/g, ' '); }
  toast() { return this.$('#toast').textContent.trim(); }
  dialog() { return this.$('#dlg').textContent.replace(/\s+/g, ' '); }
  fill(form: any, vals: Record<string, any>) { for (const [k, v] of Object.entries(vals)) { const el = form.querySelector(`[name="${k}"]`); if (!el) throw new Error('no field ' + k); if (el.type === 'checkbox') el.checked = v; else el.value = v; } }
  submit(form: any) { form.dispatchEvent(new this.w.Event('submit', { bubbles: true, cancelable: true })); }
  click(sel: any) { const el = typeof sel === 'string' ? this.$(sel) : sel; if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new this.w.MouseEvent('click', { bubbles: true })); }
  go(route: string, params = '{}') { this.w.eval(`go('${route}', ${params})`); }
  async settle() { await this.w.eval('sync.queue'); await sleep(30); }
  async refresh() { await this.w.eval('loadState().then(() => { assemble(sync.raw); render(true); })'); }
  async until(fn: () => boolean, ms = 6000) { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out; page says: ' + this.text().slice(0, 300) + ' | toast: ' + this.toast()); await sleep(25); } }
  async signIn(email: string, password: string) { await this.open(); const f = this.$('form[data-auth=signin]'); this.fill(f, { email, pw: password }); this.submit(f); await this.until(() => !!this.$('.nav')); }
}
async function acceptInvite(b: Browser, email: string, password: string) {
  await mail.deliverDue(); const token = tokenFor(sent, email);
  const page = await b.fetch('/invite/accept?token=' + token); expect(page.status).toBe(200);
  const r = await b.fetch('/api/v1/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
  expect(r.status).toBe(200);
}

beforeAll(async () => { const f = await freshApp({ ENFORCE_NETWORK: 'true' }); sent = f.sent; mail = f.mail; base = f.base; close = f.close; });
afterAll(async () => { await close(); });

let admin: Browser, alice: Browser, sam: Browser, john: Browser, mary: Browser;

test('the administrator sets up the company in the app', async () => {
  admin = await new Browser().open();
  expect(admin.text()).toContain('Set up your company');
  const f = admin.$('form[data-auth=setup]');
  // a shift that covers the whole day, so people are checked in on sign-in whenever this test runs
  admin.fill(f, { company: 'Acme Labelling', cidr: '10.20.0.0/16', pname: 'Project A', dstart: '00:00', dend: '23:59', night: false, lv: 'Kilele Kitchen', name: 'Grace Admin', email: 'grace@acme.co.ke', pw: 'admin-password-1', pw2: 'admin-password-1' });
  admin.submit(f);
  await admin.until(() => !!admin.$('.nav'));
  expect(admin.text()).toContain('Invite management');
  expect(admin.$$('.nav button').map((b: any) => b.textContent)).toEqual(expect.arrayContaining(['Projects', 'Admin', 'Team attendance']));
});

test('the admin creates a second project and invites a project manager by email', async () => {
  admin.go('projects'); const pf = admin.$('form[data-form=project-add]'); admin.fill(pf, { pname: 'Project B', dstart: '00:00', dend: '23:59' }); admin.submit(pf); await admin.settle();
  expect(admin.text()).toContain('Project B');
  admin.go('admin', "{tab:'people'}"); admin.click('[data-act=invite][data-k=management]');
  const f = admin.$('#dlg form'); f.querySelector('[name=role]').value = 'project_manager';
  admin.fill(f, { people: 'Alice Nduta, alice@acme.co.ke' }); admin.submit(f); await admin.settle(); await admin.until(() => /emailed/.test(admin.toast()));
  expect(admin.toast()).toBe('Invitation emailed to Alice Nduta.');
  await mail.deliverDue(); const m = sent.find(s => s.to === 'alice@acme.co.ke')!;
  expect(m.subject).toBe('Grace Admin invited you to join Acme Labelling'); expect(m.text).toContain('project manager on Project A');
});

test('the project manager accepts, then adds a supervisor and invites her team from the Projects page', async () => {
  alice = new Browser(); await acceptInvite(alice, 'alice@acme.co.ke', 'alice-password-1'); await alice.open();
  expect(alice.$$('.nav button').map((b: any) => b.textContent)).toEqual(expect.arrayContaining(['Projects', 'Team ranking']));
  alice.go('projects'); expect(alice.text()).toContain('Project A'); expect(alice.text()).not.toContain('Project B');
  alice.click('[data-act=invite][data-k=supervisor]'); let f = alice.$('#dlg form'); alice.fill(f, { people: 'Samuel Kamau, sam@acme.co.ke' }); alice.submit(f);
  await alice.settle(); await alice.until(() => /emailed/.test(alice.toast()));
  sam = new Browser(); await acceptInvite(sam, 'sam@acme.co.ke', 'samuel-password-1');
  await alice.refresh(); alice.go('projects');
  alice.click('[data-act=invite][data-k=employee]'); f = alice.$('#dlg form'); const sup = f.querySelector('[name=sup]'); sup.value = sup.options[1].value;
  alice.fill(f, { people: 'John Smith, john@acme.co.ke\nMary Wanjiku <mary@acme.co.ke>\nPeter Otieno; peter@acme.co.ke', rest: String((new Date().getDay() + 3) % 7) }); alice.submit(f);
  await alice.settle(); await alice.until(() => /emailed/.test(alice.toast()));
  expect(alice.toast()).toBe('Invitations emailed to John Smith, Mary Wanjiku, Peter Otieno.');
  expect(alice.text()).toMatch(/Invited, not joined\s*3/);
});

test('team members join from their email and are checked in on their first sign-in of the shift', async () => {
  john = new Browser(); await acceptInvite(john, 'john@acme.co.ke', 'john-password-1'); await john.open();
  await john.until(() => /Checked in automatically/.test(john.toast()));
  await john.settle(); expect(john.text()).toContain('Present');
  await acceptInvite(new Browser(), 'mary@acme.co.ke', 'mary-password-1'); // accepted on her phone
  mary = new Browser(); await mary.signIn('mary@acme.co.ke', 'mary-password-1'); await mary.settle();
  expect(mary.text()).toContain('Present');
});

test('two people saving at the same moment both succeed (the second change is re-applied, not lost)', async () => {
  john.go('meals'); mary.go('meals');
  const jb = john.$('[data-act=book][data-i="1"]'), mb = mary.$('[data-act=book][data-i="1"]');
  john.click(jb); mary.click(mb); await Promise.all([john.settle(), mary.settle()]);
  await admin.refresh();
  expect(admin.w.eval('state.bookings.filter(b => b.st === "BOOKED").length')).toBe(2);
});

test('the supervisor sees the team live, and can rank and export it', async () => {
  await sam.open(); sam.go('team');
  expect(sam.text()).toContain('John Smith'); expect(sam.text()).toContain('Mary Wanjiku'); expect(sam.text()).toMatch(/2\s*Present/);
  sam.go('ranking'); expect(sam.text()).toContain('Visible only to project managers and supervisors');
  sam.click('[data-act=export][data-k=ranking][data-f=csv]'); await sleep(100);
  sam.go('team'); sam.click('[data-act=export][data-k=team-month][data-f=csv]'); await sleep(100);
  expect(downloads.map(d => d.name)).toEqual(expect.arrayContaining([expect.stringMatching(/^team-ranking-.*\.csv$/), expect.stringMatching(/^team-report-.*\.csv$/)]));
  expect(downloads.every(d => d.size > 50)).toBe(true);
});

test('the server stops a team member from giving themselves more access, even with a hand-made request', async () => {
  const core = JSON.parse(john.w.eval('sync.raw.core')); core.users.find((u: any) => u.email === 'john@acme.co.ke').roles.push({ role: 'admin', project_id: null });
  const r = await john.fetch('/api/v1/state/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: john.w.eval('({...sync.revs})'), groups: { core: JSON.stringify(core) } }) });
  expect(r.status).toBe(403);
  const outside = await new Browser('197.248.10.5').fetch('/api/v1/state'); expect(outside.status).toBe(403);
});

test('cancelling an invitation removes the person; the admin can deactivate a member', async () => {
  await alice.refresh(); alice.go('projects');
  const peter = alice.w.eval('state.users.find(u => u.email === "peter@acme.co.ke").id');
  alice.w.eval(`A['inv-cancel']({ u: '${peter}', i: '' })`);
  // revoke needs the invitation id; the dialog provides it. Use the dialog path:
  await alice.settle(); await alice.refresh();
  expect(alice.w.eval('state.users.some(u => u.email === "peter@acme.co.ke")')).toBe(false);
  await admin.refresh(); admin.go('admin', "{tab:'people'}");
  const maryId = admin.w.eval('state.users.find(u => u.email === "mary@acme.co.ke").id');
  admin.click(`[data-act=person-toggle][data-u="${maryId}"]`); await admin.settle();
  const r = await new Browser().fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'mary@acme.co.ke', password: 'mary-password-1' }) });
  expect((await r.json()).code).toBe('ACCOUNT_DISABLED');
});
