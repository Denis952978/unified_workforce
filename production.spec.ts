import { Server } from 'http';
import { agent, baseCore, freshApp, HOME, invited, Sent, tokenFor } from './helpers';

let app: Server; let sent: Sent[]; let mail: any; let close: () => Promise<void>; let db: any;
let admin: ReturnType<typeof agent>; let extKey = '';
const bearer = (path: string, key = extKey) => agent(app).post(path).set('Authorization', 'Bearer ' + key);
const activity = (events: any[], key = extKey) => bearer('/api/v1/production/activity', key).send({ events });
async function activityRow() { return JSON.parse((await db.one(`SELECT json FROM app_state WHERE name = 'activity'`)).json).activity; }

beforeAll(async () => {
  const f = await freshApp({ ENFORCE_NETWORK: 'true' }); app = f.server; sent = f.sent; mail = f.mail; close = f.close; db = f.s.db;
  const core = baseCore(); core.shiftDefs[0].start = '00:00'; core.shiftDefs[0].end = '23:59'; // a shift that is always running
  core.shiftDefs.push({ id: 'sLater', project_id: 'pA', name: 'NIGHT', start: '23:59', end: '00:00' });
  admin = agent(app); await admin.post('/api/v1/setup').send({ email: 'grace@acme.co.ke', password: 'admin-password-1', memberId: 'u_admin', groups: { core: JSON.stringify(core) } });
  const st = (await admin.get('/api/v1/state?groups=core')).body; const c = JSON.parse(st.groups.core.json);
  for (const p of [invited('u_john', 'John Smith', 'john@acme.co.ke', [{ role: 'employee', project_id: null }], { pid: 'pA', shift: 'sA' }), invited('u_fin', 'Moses', 'moses@acme.co.ke', [{ role: 'finance', project_id: null }, { role: 'employee', project_id: null }])]) { c.users.push(p.user); c.employees.push(p.employee); if (p.assignment) c.assignments.push(p.assignment); }
  c.targets = [{ p: 'pA', task: 'LABEL', uph: 60, from: '2000-01-01' }];
  const base = (await admin.get('/api/v1/state')).body.revs; await admin.post('/api/v1/state/commit').send({ base, groups: { core: JSON.stringify(c) } });
  await admin.post('/api/v1/invitations').send({ memberIds: ['u_john', 'u_fin'] }); await mail.deliverDue();
  for (const e of ['john@acme.co.ke', 'moses@acme.co.ke']) await agent(app, HOME).post('/api/v1/invitations/accept').send({ token: tokenFor(sent, e), password: 'a-good-password' });
});
afterAll(async () => { await close(); });

test('the extension signs in with email and password and gets a limited key', async () => {
  const r = await agent(app).post('/api/v1/extension/token').send({ email: 'john@acme.co.ke', password: 'a-good-password' });
  expect(r.status).toBe(200); expect(r.body).toMatchObject({ name: 'John Smith', member_id: 'u_john', expires_in_days: 30 }); extKey = r.body.token;
  expect((await agent(app).post('/api/v1/extension/token').send({ email: 'john@acme.co.ke', password: 'wrong-password' })).status).toBe(401);
  // the key reads its own totals and settings, but nothing else
  expect((await agent(app).get('/api/v1/extension/config').set('Authorization', 'Bearer ' + extKey)).body.detection.submitLabel).toEqual(['submit']);
  const s = await agent(app).get('/api/v1/state').set('Authorization', 'Bearer ' + extKey); expect(s.status).toBe(403); expect(s.body.code).toBe('EXTENSION_KEY_LIMITED');
});

test('"Start labeling", heartbeats and submitted items are recorded for the running shift', async () => {
  let r = await activity([{ type: 'start', task: 'LABEL', url: 'https://app.labelbox.com/projects/x/label' }]);
  expect(r.status).toBe(200); expect(r.body.counting).toBe(true); expect(r.body.totals).toMatchObject({ task: 'LABEL', state: 'active', labelled: 0 });
  r = await activity([{ type: 'item', task: 'LABEL' }, { type: 'item', task: 'LABEL' }, { type: 'item', task: 'LABEL' }, { type: 'beat', task: 'LABEL', seconds: 60 }]);
  expect(r.body.totals).toMatchObject({ labelled: 3, active_seconds: 60, label_target: 60 });
  expect(r.body.totals.label_pct).toBe(300); // 3 items in 1 minute against 60/hour
  r = await activity([{ type: 'item', task: 'REVIEW' }, { type: 'beat', task: 'REVIEW', seconds: 30 }]);
  expect(r.body.totals).toMatchObject({ reviewed: 1, task: 'REVIEW' });
  const me = await agent(app).get('/api/v1/production/me').set('Authorization', 'Bearer ' + extKey);
  expect(me.body).toMatchObject({ counting: true, name: 'John Smith' }); expect(me.body.totals.labelled).toBe(3);
});

test('the server never credits more time than really passed, or impossible numbers of items', async () => {
  const before = Object.values(await activityRow())[0] as any;
  const r = await activity([{ type: 'beat', task: 'LABEL', seconds: 3600 }, { type: 'item', task: 'LABEL', count: 5000 }]);
  const a = Object.values(await activityRow())[0] as any;
  expect(a.ls - before.ls).toBeLessThanOrEqual(90); // a heartbeat moments after the last one earns only the seconds since
  expect(a.ul - before.ul).toBe(20);
  expect(r.status).toBe(200);
  expect((await activity([{ type: 'hack' }])).status).toBe(400);
  expect((await activity(new Array(60).fill({ type: 'item' }))).status).toBe(400);
});

test('people outside a labelling team, and the app itself, cannot write activity', async () => {
  const fin = await agent(app).post('/api/v1/extension/token').send({ email: 'moses@acme.co.ke', password: 'a-good-password' });
  expect((await activity([{ type: 'start', task: 'LABEL' }], fin.body.token)).body.code).toBe('NOT_A_LABELLER');
  const john = agent(app); await john.post('/api/v1/auth/login').send({ email: 'john@acme.co.ke', password: 'a-good-password' });
  const base = (await john.get('/api/v1/state')).body.revs;
  const r = await john.post('/api/v1/state/commit').send({ base, groups: { activity: JSON.stringify({ activity: {} }) } });
  expect(r.body.code).toBe('UNKNOWN_GROUP');
  const all = (await john.get('/api/v1/state')).body; expect(Object.keys(all.groups)).toContain('activity'); // the app reads it
});

test('only administrators change what the extension watches for', async () => {
  const john = agent(app); await john.post('/api/v1/auth/login').send({ email: 'john@acme.co.ke', password: 'a-good-password' });
  let st = (await john.get('/api/v1/state?groups=core')).body; let c = JSON.parse(st.groups.core.json); c.labelboxDetection = { submitLabel: ['anything'] };
  let base = (await john.get('/api/v1/state')).body.revs; expect((await john.post('/api/v1/state/commit').send({ base, groups: { core: JSON.stringify(c) } })).status).toBe(403);
  st = (await admin.get('/api/v1/state?groups=core')).body; c = JSON.parse(st.groups.core.json); c.labelboxDetection = { submitLabel: ['submit', 'save and next'] };
  base = (await admin.get('/api/v1/state')).body.revs; expect((await admin.post('/api/v1/state/commit').send({ base, groups: { core: JSON.stringify(c) } })).status).toBe(200);
  expect((await agent(app).get('/api/v1/extension/config').set('Authorization', 'Bearer ' + extKey)).body.detection.submitLabel).toEqual(['submit', 'save and next']);
});

test('no shift running: nothing is counted; a deactivated person\'s extension stops working', async () => {
  let st = (await admin.get('/api/v1/state?groups=core')).body; let c = JSON.parse(st.groups.core.json);
  c.employees.find((e: any) => e.id === 'e_u_john').shift_id = 'sLater'; // 23:59 to 00:00: one minute a day
  let base = (await admin.get('/api/v1/state')).body.revs; await admin.post('/api/v1/state/commit').send({ base, groups: { core: JSON.stringify(c) } });
  const r = await activity([{ type: 'item', task: 'LABEL' }]);
  expect(r.body.counting).toBe(false);
  st = (await admin.get('/api/v1/state?groups=core')).body; c = JSON.parse(st.groups.core.json); c.users.find((u: any) => u.id === 'u_john').status = 'DISABLED';
  base = (await admin.get('/api/v1/state')).body.revs; await admin.post('/api/v1/state/commit').send({ base, groups: { core: JSON.stringify(c) } });
  expect((await activity([{ type: 'item', task: 'LABEL' }])).status).toBe(401);
});
