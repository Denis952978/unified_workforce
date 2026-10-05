import { Server } from 'http';
import { agent, baseCore, CoreT, freshApp, HOME, invited, OFFICE, Sent, tokenFor } from './helpers';

let app: Server; let sent: Sent[]; let mail: any; let ctl: { fail: number }; let close: () => Promise<void>; let db: any;
let admin: ReturnType<typeof agent>;
const revsOf = async (a: ReturnType<typeof agent>) => (await a.get('/api/v1/state')).body.revs;
async function getCore(a: ReturnType<typeof agent>): Promise<CoreT> { return JSON.parse((await a.get('/api/v1/state?groups=core')).body.groups.core.json); }
async function saveCore(a: ReturnType<typeof agent>, core: CoreT) { const base = await revsOf(a); return a.post('/api/v1/state/commit').send({ base, groups: { core: JSON.stringify(core) } }); }
async function addInvited(a: ReturnType<typeof agent>, ...people: ReturnType<typeof invited>[]) {
  const core = await getCore(a); for (const p of people) { core.users.push(p.user); core.employees.push(p.employee); if (p.assignment) core.assignments.push(p.assignment); }
  return saveCore(a, core);
}
async function accept(email: string, password = 'a-good-password', ip = HOME) { await mail.deliverDue(); return agent(app, ip).post('/api/v1/invitations/accept').send({ token: tokenFor(sent, email), password }); }
async function login(email: string, password = 'a-good-password', ip = OFFICE) { const a = agent(app, ip); const r = await a.post('/api/v1/auth/login').send({ email, password }); return { a, r }; }

beforeAll(async () => { const f = await freshApp({ ENFORCE_NETWORK: 'true' }); app = f.server; sent = f.sent; mail = f.mail; ctl = f.ctl; close = f.close; db = f.s.db; });
afterAll(async () => { await close(); });

describe('first run', () => {
  test('the app page is served and the API reports setup is needed', async () => {
    const page = await agent(app).get('/'); expect(page.status).toBe(200); expect(page.text).toContain('<script src="/app.js">');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await agent(app).get('/healthz')).body).toEqual({ ok: true });
    expect((await agent(app).get('/app.js')).status).toBe(200);
    expect((await agent(app).get('/vendor/jspdf.umd.min.js')).status).toBe(200);
    const s = (await agent(app).get('/api/v1/session')).body; expect(s).toMatchObject({ setup_required: true, signed_in: false, client_ip: OFFICE });
  });
  test('setup stores the records, creates the admin account and signs in', async () => {
    admin = agent(app);
    const bad = await admin.post('/api/v1/setup').send({ email: 'grace@acme.co.ke', password: 'admin-password-1', memberId: 'someone-else', groups: { core: JSON.stringify(baseCore()) } });
    expect(bad.body.code).toBe('INVALID_SETUP');
    const r = await admin.post('/api/v1/setup').send({ email: 'grace@acme.co.ke', password: 'admin-password-1', memberId: 'u_admin', groups: { core: JSON.stringify(baseCore()), days: '{"days":{}}' } });
    expect(r.status).toBe(200);
    expect((await admin.get('/api/v1/session')).body).toMatchObject({ setup_required: false, signed_in: true, member_id: 'u_admin', network_zone: 'Office LAN' });
    expect((await agent(app).post('/api/v1/setup').send({ email: 'x@y.co', password: 'admin-password-1', memberId: 'u_admin', groups: { core: JSON.stringify(baseCore()) } })).body.code).toBe('ALREADY_SET_UP');
  });
});

describe('shared records', () => {
  test('a save based on an old version is refused with STALE, so nobody overwrites anyone', async () => {
    const base = await revsOf(admin); const core = await getCore(admin);
    core.company.name = 'Acme Labelling Ltd';
    expect((await admin.post('/api/v1/state/commit').send({ base, groups: { core: JSON.stringify(core) } })).status).toBe(200);
    core.company.name = 'Overwritten';
    const r = await admin.post('/api/v1/state/commit').send({ base, groups: { core: JSON.stringify(core) } });
    expect(r.status).toBe(409); expect(r.body.code).toBe('STALE');
    expect((await getCore(admin)).company.name).toBe('Acme Labelling Ltd');
  });
  test('records need a session, and the office network', async () => {
    expect((await agent(app).get('/api/v1/state')).status).toBe(401);
    const home = await login('grace@acme.co.ke', 'admin-password-1', HOME); expect(home.r.body.code).toBe('NETWORK_NOT_AUTHORIZED');
  });
});

describe('invitations are emailed by the server and accepting adds the person', () => {
  test('admin invites a project manager; the email arrives; accepting activates them', async () => {
    expect((await addInvited(admin, invited('u_alice', 'Alice Nduta', 'Alice.Nduta@acme.co.ke', [{ role: 'project_manager', project_id: 'pA' }, { role: 'employee', project_id: null }]))).status).toBe(200);
    const r = await admin.post('/api/v1/invitations').send({ memberIds: ['u_alice'] }); expect(r.status).toBe(201);
    await mail.deliverDue();
    const m = sent.find(s => s.to === 'alice.nduta@acme.co.ke')!;
    expect(m.subject).toBe('Grace Admin invited you to join Acme Labelling Ltd'); expect(m.text).toContain('project manager on Project A');
    expect(m.text).toContain('https://acme-workforce.netlify.app/invite/accept?token=');
    const pv = await agent(app, HOME).post('/api/v1/invitations/preview').send({ token: tokenFor(sent, 'alice.nduta@acme.co.ke') });
    expect(pv.body.invitation).toMatchObject({ kind: 'INVITE', role: 'project_manager', project: 'Project A', invited_by: 'Grace Admin', company: 'Acme Labelling Ltd' });
    const before = (await revsOf(admin)).core;
    const acc = await accept('alice.nduta@acme.co.ke');
    expect(acc.status).toBe(200); expect(acc.headers['set-cookie'][0]).toMatch(/uws_session=.*HttpOnly/);
    const core = await getCore(admin);
    expect(core.users.find((u: any) => u.id === 'u_alice').status).toBe('ACTIVE');
    expect(core.employees.find((e: any) => e.id === 'e_u_alice')!.active).toBe(true);
    expect((await revsOf(admin)).core).toBe(before + 1);
    await mail.deliverDue(); expect(sent.some(s => s.to === 'grace@acme.co.ke' && s.subject === 'Alice Nduta accepted your invitation')).toBe(true);
    expect((await accept('alice.nduta@acme.co.ke')).status).toBe(410);
  });
  test('the project manager invites a supervisor and a team; each joins individually', async () => {
    const { a: pm, r } = await login('alice.nduta@acme.co.ke'); expect(r.status).toBe(200);
    expect((await addInvited(pm, invited('u_sam', 'Samuel Kamau', 'sam@acme.co.ke', [{ role: 'supervisor', project_id: 'pA' }, { role: 'employee', project_id: null }]))).status).toBe(200);
    expect((await pm.post('/api/v1/invitations').send({ memberIds: ['u_sam'] })).status).toBe(201);
    expect((await accept('sam@acme.co.ke')).status).toBe(200);
    const team = ['john', 'mary', 'peter'].map(n => invited('u_' + n, n[0].toUpperCase() + n.slice(1), `${n}@acme.co.ke`, [{ role: 'employee', project_id: null }], { pid: 'pA', shift: 'sA', sup: 'u_sam' }, 'u_alice'));
    expect((await addInvited(pm, ...team)).status).toBe(200);
    expect((await pm.post('/api/v1/invitations').send({ memberIds: ['u_john', 'u_mary', 'u_peter'] })).body.invitations).toHaveLength(3);
    expect((await accept('john@acme.co.ke')).status).toBe(200);
    expect((await accept('mary@acme.co.ke')).status).toBe(200);
    const core = await getCore(pm);
    expect(core.users.filter((u: any) => u.status === 'ACTIVE').map((u: any) => u.id).sort()).toEqual(['u_admin', 'u_alice', 'u_john', 'u_mary', 'u_sam']);
    const john = await login('john@acme.co.ke'); expect((await john.a.get('/api/v1/session')).body.member_id).toBe('u_john');
  });
  test('resend replaces the link; revoke kills it; the listing shows status', async () => {
    const { a: pm } = await login('alice.nduta@acme.co.ke');
    const inv = (await pm.get('/api/v1/invitations?memberIds=u_peter')).body.invitations[0]; expect(inv.status).toBe('PENDING');
    await mail.deliverDue(); const old = tokenFor(sent, 'peter@acme.co.ke');
    expect((await pm.post(`/api/v1/invitations/${inv.id}/resend`)).body.code).toBe('TOO_SOON');
    await db.query(`UPDATE invitations SET last_sent_at = now() - interval '2 minutes'`);
    expect((await pm.post(`/api/v1/invitations/${inv.id}/resend`)).body.invitation.sent_count).toBe(2);
    await mail.deliverDue(); const fresh = tokenFor(sent, 'peter@acme.co.ke'); expect(fresh).not.toBe(old);
    expect((await agent(app).post('/api/v1/invitations/preview').send({ token: old })).status).toBe(410);
    expect((await pm.post(`/api/v1/invitations/${inv.id}/revoke`)).body.invitation.status).toBe('REVOKED');
    expect((await agent(app).post('/api/v1/invitations/accept').send({ token: fresh, password: 'a-good-password' })).status).toBe(410);
  });
});

describe('the server refuses changes beyond a person\'s role', () => {
  test('a team member cannot make themselves admin, activate people, or change settings', async () => {
    const { a: john } = await login('john@acme.co.ke');
    let core = await getCore(john); core.users.find((u: any) => u.id === 'u_john').roles.push({ role: 'admin', project_id: null });
    expect((await saveCore(john, core)).body.code).toBe('FORBIDDEN');
    core = await getCore(john); core.users.find((u: any) => u.id === 'u_peter').status = 'ACTIVE';
    expect((await saveCore(john, core)).body.code).toBe('FORBIDDEN');
    core = await getCore(john); core.zones[0].cidr = '0.0.0.0/0';
    expect((await saveCore(john, core)).body.code).toBe('FORBIDDEN');
    core = await getCore(john); core.users.push(invited('u_x', 'X', 'x@acme.co.ke', [{ role: 'employee', project_id: null }], { pid: 'pA', shift: 'sA' }).user);
    expect((await saveCore(john, core)).body.code).toBe('FORBIDDEN');
    expect((await john.post('/api/v1/invitations').send({ memberIds: ['u_peter'] })).status).toBe(403);
  });
  test('a project manager cannot grant management roles or add people to other projects', async () => {
    const { a: pm } = await login('alice.nduta@acme.co.ke');
    expect((await addInvited(pm, invited('u_f', 'Fin', 'fin@acme.co.ke', [{ role: 'finance', project_id: null }, { role: 'employee', project_id: null }]))).body.code).toBe('FORBIDDEN');
    expect((await addInvited(pm, invited('u_b', 'Bee', 'bee@acme.co.ke', [{ role: 'employee', project_id: null }], { pid: 'pB', shift: 'sB' }))).body.code).toBe('FORBIDDEN');
    const core = await getCore(pm); core.users.find((u: any) => u.id === 'u_sam').roles = [{ role: 'admin', project_id: null }];
    expect((await saveCore(pm, core)).body.code).toBe('FORBIDDEN');
  });
  test('ordinary work (a check-in) is accepted from anyone signed in', async () => {
    const { a: john } = await login('john@acme.co.ke');
    const base = await revsOf(john);
    const r = await john.post('/api/v1/state/commit').send({ base, groups: { sessions: JSON.stringify({ sessions: [{ id: 's1', e: 'e_u_john', d: '2026-10-05', in: Date.now() }], adjustments: [], leave: [] }) } });
    expect(r.status).toBe(200);
  });
  test('the last administrator cannot be removed; deactivated people cannot sign in', async () => {
    let core = await getCore(admin); core.users.find((u: any) => u.id === 'u_admin').roles = [{ role: 'employee', project_id: null }];
    expect((await saveCore(admin, core)).body.message).toContain('at least one active administrator');
    core = await getCore(admin); core.users.find((u: any) => u.id === 'u_mary').status = 'DISABLED';
    expect((await saveCore(admin, core)).status).toBe(200);
    const mary = await login('mary@acme.co.ke'); expect(mary.r.body.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('password reset and email delivery', () => {
  test('admin sends a reset link; the new password works and the old one does not', async () => {
    expect((await admin.post('/api/v1/members/u_john/password-reset')).status).toBe(200);
    await mail.deliverDue(); const m = [...sent].reverse().find(s => s.to === 'john@acme.co.ke')!; expect(m.subject).toContain('Choose a new password');
    expect((await agent(app, HOME).post('/api/v1/invitations/preview').send({ token: tokenFor(sent, 'john@acme.co.ke') })).body.invitation.kind).toBe('RESET');
    expect((await accept('john@acme.co.ke', 'brand-new-password')).status).toBe(200);
    expect((await login('john@acme.co.ke')).r.status).toBe(401);
    expect((await login('john@acme.co.ke', 'brand-new-password')).r.status).toBe(200);
  });
  test('a mail outage delays an invitation but never loses it', async () => {
    await mail.deliverDue(); ctl.fail = 1;
    await addInvited(admin, invited('u_rita', 'Rita', 'rita@acme.co.ke', [{ role: 'logistics', project_id: null }, { role: 'employee', project_id: null }]));
    await admin.post('/api/v1/invitations').send({ memberIds: ['u_rita'] }); // on Netlify the API tries to send straight away; this first try hits the outage
        expect((await db.one(`SELECT status, attempts FROM email_outbox WHERE to_email = 'rita@acme.co.ke'`))).toMatchObject({ status: 'PENDING', attempts: 1 });
    await db.query(`UPDATE email_outbox SET next_attempt_at = now()`); expect((await mail.deliverDue()).sent).toBe(1);
  });
});
