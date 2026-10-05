import { randomBytes } from 'crypto';
import { acceptPage } from './accept-page';
import { audit } from './audit';
import { Auth, SESSION_COOKIE } from './auth';
import { Config, loadConfig } from './config';
import { Db } from './db';
import { ApiError } from './errors';
import { Invitations } from './invitations';
import { Mailer } from './mail';
import { Production } from './production';
import { zoneFor } from './network';
import { SessionUser } from './roles';
import { GROUPS, normalise, StateStore } from './state';

/** Everything one function instance needs, created once and reused while the instance is warm. */
export interface Services { cfg: Config; db: Db; state: StateStore; auth: Auth; mail: Mailer; inv: Invitations; prod: Production }
let shared: Services | null = null;
export function services(env?: Record<string, string | undefined>): Services {
  if (shared && !env) return shared;
  const cfg = loadConfig(env); const db = new Db(cfg.databaseUrl); const state = new StateStore(db, cfg);
  const auth = new Auth(cfg, db, state); const mail = new Mailer(cfg, db); const inv = new Invitations(cfg, db, mail, auth, state);
  const s = { cfg, db, state, auth, mail, inv, prod: new Production(db, state) }; if (!env) shared = s; return s;
}

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers } });
const err = (e: ApiError) => json({ code: e.code, message: e.message, details: e.details }, e.status);

// ---- small input checks (the API is the trust boundary) ----
const isEmail = (v: unknown) => typeof v === 'string' && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
function str(body: any, k: string, max = 200, optional = false): string {
  const v = body?.[k];
  if (v === undefined || v === null || v === '') { if (optional) return ''; throw new ApiError(400, 'VALIDATION_FAILED', `${k} is required.`); }
  if (typeof v !== 'string' || v.length > max) throw new ApiError(400, 'VALIDATION_FAILED', `${k} must be text of at most ${max} characters.`);
  return v;
}
function cookie(req: Request, name: string) { const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : null; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { req: Request; url: URL; ip: string; zone: string | null; user: SessionUser | null; body: any; s: Services; params: Record<string, string> };
type Handler = (c: Ctx) => Promise<Response>;
interface Route { method: string; path: RegExp; handler: Handler; public?: boolean; offNetwork?: boolean; ext?: boolean }
const routes: Route[] = [];
const route = (method: string, path: string, handler: Handler, opts: { public?: boolean; offNetwork?: boolean; ext?: boolean } = {}) =>
  routes.push({ method, path: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

// ---- routes ----
route('GET', '/healthz', async ({ s }) => { await s.db.query('SELECT 1'); return json({ ok: true }); }, { public: true, offNetwork: true });

route('GET', '/api/v1/session', async ({ s, user, ip, zone }) => {
  const setUp = !!(await s.db.one('SELECT 1 FROM accounts LIMIT 1'));
  return json({ setup_required: !setUp, setup_token_required: !setUp && !!s.cfg.setupToken, signed_in: !!user, member_id: user?.memberId ?? null, email: user?.email ?? null,
    server_time: Date.now(), client_ip: ip, network_zone: zone, enforce_network: s.cfg.enforceNetwork, test_controls: s.cfg.testControls, min_password_length: s.cfg.minPasswordLength, live: 'poll', poll_seconds: s.cfg.pollSeconds });
}, { public: true });

route('POST', '/api/v1/setup', async ({ s, body, ip }) => {
  const email = str(body, 'email', 254); const password = str(body, 'password'); const memberId = str(body, 'memberId', 60); const token = str(body, 'setupToken', 200, true);
  if (!isEmail(email)) throw new ApiError(400, 'VALIDATION_FAILED', 'email must be an email address.');
  if (!body.groups || typeof body.groups !== 'object') throw new ApiError(400, 'VALIDATION_FAILED', 'groups is required.');
  if (s.cfg.setupToken && token !== s.cfg.setupToken) throw new ApiError(403, 'SETUP_TOKEN_INVALID', 'The setup code is not right. It is the SETUP_TOKEN value set in Netlify.');
  s.auth.checkPasswordStrength(password);
  const accountId = await s.db.tx(async c => {
    const rows = await s.state.lockAll(c);
    if (rows.core.json || (await s.db.one('SELECT 1 FROM accounts LIMIT 1', [], c))) throw new ApiError(409, 'ALREADY_SET_UP', 'This system is already set up. Sign in instead.');
    let core; try { core = normalise(JSON.parse(body.groups.core)); } catch { throw new ApiError(422, 'INVALID_SETUP', 'Company records are not valid.'); }
    const m = core.users.find(u => u.id === memberId);
    if (core.users.length !== 1 || !m || m.status !== 'ACTIVE' || !m.roles.some(r => r.role === 'admin') || m.email.toLowerCase() !== email.toLowerCase())
      throw new ApiError(422, 'INVALID_SETUP', 'Setup must contain exactly one active administrator with your email.');
    if (core.clockOffset && !s.cfg.testControls) core.clockOffset = 0;
    const a = await s.db.one('INSERT INTO accounts (email, password_hash, member_id, last_login_at) VALUES (lower($1), $2, $3, now()) RETURNING id', [email, await s.auth.hashPassword(password), memberId], c);
    for (const n of GROUPS) { const j = n === 'core' ? JSON.stringify(core) : body.groups[n]; if (typeof j === 'string') { JSON.parse(j); await s.state.write(c, n, j, a!.id); } }
    await audit(s.db, c, a!.id, 'company.SetUp', 'company', null, { name: core.company?.name }, ip);
    return a!.id as string;
  });
  return json({ ok: true }, 200, { 'Set-Cookie': s.auth.sessionCookie(s.auth.issueToken(accountId)) });
}, { public: true });

route('POST', '/api/v1/auth/login', async ({ s, body, ip }) => {
  const email = str(body, 'email', 254); const password = str(body, 'password');
  const u = await s.auth.login(email, password);
  await audit(s.db, null, u.accountId, 'auth.Login', 'account', u.accountId, {}, ip);
  return json({ member_id: u.memberId }, 200, { 'Set-Cookie': s.auth.sessionCookie(s.auth.issueToken(u.accountId)) });
}, { public: true });
route('POST', '/api/v1/auth/logout', async ({ s }) => json({ ok: true }, 200, { 'Set-Cookie': s.auth.clearCookie() }), { public: true });
route('POST', '/api/v1/auth/password', async ({ s, body, user, ip }) => {
  await s.auth.changePassword(user!, str(body, 'current'), str(body, 'next'));
  await audit(s.db, null, user!.accountId, 'auth.PasswordChanged', 'account', user!.accountId, {}, ip); return json({ ok: true });
});

route('GET', '/api/v1/state', async ({ s, url }) => { const g = url.searchParams.get('groups'); return json(await s.state.read(g ? g.split(',') : undefined)); });
route('GET', '/api/v1/state/revs', async ({ s }) => json({ revs: await s.state.revs() }));
route('POST', '/api/v1/state/commit', async ({ s, body, user }) => json(await s.state.commit(user!, body?.base, body?.groups)));

route('POST', '/api/v1/invitations', async ({ s, body, user, ip }) => {
  const ids = body?.memberIds; if (!Array.isArray(ids) || !ids.length || ids.length > 300 || ids.some((x: unknown) => typeof x !== 'string' || x.length > 60)) throw new ApiError(400, 'VALIDATION_FAILED', 'memberIds must be a list of member ids.');
  const r = await s.inv.send(user!, ids, ip);
  await s.mail.deliverDue(10, 5000).catch(() => undefined); // send now if we can; the scheduled function retries the rest
  return json(r, 201);
});
route('GET', '/api/v1/invitations', async ({ s, url, user }) => { const ids = url.searchParams.get('memberIds'); return json(await s.inv.list(user!, ids ? ids.split(',').slice(0, 300) : undefined)); });
route('POST', '/api/v1/invitations/preview', async ({ s, body }) => json(await s.inv.preview(str(body, 'token', 100))), { public: true, offNetwork: true });
route('POST', '/api/v1/invitations/accept', async ({ s, body, ip }) => {
  const r = await s.inv.accept(str(body, 'token', 100), str(body, 'password'), ip);
  await s.mail.deliverDue(5, 4000).catch(() => undefined);
  return json({ ok: true, redirect_to: '/' }, 200, { 'Set-Cookie': s.auth.sessionCookie(r.token) });
}, { public: true, offNetwork: true });
route('GET', '/invite/accept', async () => {
  const nonce = randomBytes(16).toString('base64');
  return new Response(acceptPage(nonce), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}, { public: true, offNetwork: true });

// ---- browser extension ----
route('POST', '/api/v1/extension/token', async ({ s, body, ip }) => {
  const u = await s.auth.login(str(body, 'email', 254), str(body, 'password'));
  await audit(s.db, null, u.accountId, 'auth.ExtensionConnected', 'account', u.accountId, {}, ip);
  return json({ token: s.auth.issueExtensionToken(u.accountId), name: u.name, member_id: u.memberId, expires_in_days: 30 });
}, { public: true });
route('GET', '/api/v1/extension/config', async ({ s }) => json({ detection: await s.prod.detection(), server_time: Date.now(), heartbeat_seconds: 60 }), { ext: true });
route('POST', '/api/v1/production/activity', async ({ s, body, user }) => json(await s.prod.record(user!, body?.events)), { ext: true });
route('GET', '/api/v1/production/me', async ({ s, user }) => json(await s.prod.mine(user!)), { ext: true });

// routes with an id in the path
route('POST', '/api/v1/invitations/:id/resend', async c => { const id = idParam(c, true); const r = await c.s.inv.resend(c.user!, id, c.ip); await c.s.mail.deliverDue(5, 4000).catch(() => undefined); return json(r); });
route('POST', '/api/v1/invitations/:id/revoke', async c => json(await c.s.inv.revoke(c.user!, idParam(c, true), c.ip)));
route('POST', '/api/v1/members/:id/password-reset', async c => { const r = await c.s.inv.sendReset(c.user!, idParam(c, false), c.ip); await c.s.mail.deliverDue(5, 4000).catch(() => undefined); return json(r); });
function idParam(c: Ctx, uuid: boolean) { const id = decodeURIComponent(c.params.id || ''); if (uuid ? !UUID.test(id) : (!id || id.length > 60)) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid id.'); return id; }

/**
 * Handles one request. `ip` is the client's address as reported by the platform (Netlify's context.ip),
 * so it cannot be faked with a header.
 */
export async function handle(req: Request, ip: string, s: Services = services()): Promise<Response> {
  const url = new URL(req.url);
  try {
    const r = routes.find(r => r.method === req.method && r.path.test(url.pathname));
    if (!r) return json({ code: 'NOT_FOUND', message: 'No such endpoint.', details: {} }, 404);
    const params = { ...(url.pathname.match(r.path)?.groups || {}) } as Record<string, string>;
    await s.db.ensureSchema();
    const core = await s.state.core().catch(() => null);
    const zone = zoneFor(ip, core?.zones)?.name ?? null;
    if (s.cfg.enforceNetwork && core && !zone && !(r.offNetwork && s.cfg.allowAcceptOffNetwork))
      throw new ApiError(403, 'NETWORK_NOT_AUTHORIZED', `Requests from ${ip} are outside the company network.`);
    const bearer = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    const tok = bearer || cookie(req, SESSION_COOKIE); const v = tok ? s.auth.verify(tok) : null;
    const user = v ? await s.auth.sessionUser(v.sub) : null;
    if (!r.public && !user) throw new ApiError(401, 'NOT_SIGNED_IN', 'Sign in to continue.');
    if (v?.ext && user && !r.ext && !r.public) throw new ApiError(403, 'EXTENSION_KEY_LIMITED', 'The browser extension key can only report Labelbox activity.');
    let body: any = null;
    if (req.method === 'POST') { const t = await req.text(); if (t) { try { body = JSON.parse(t); } catch { throw new ApiError(400, 'VALIDATION_FAILED', 'The request body must be JSON.'); } } }
    return await r.handler({ req, url, ip, zone, user, body, s, params });
  } catch (e) {
    if (e instanceof ApiError) return err(e);
    const pg = e as any; if (pg && pg.code === '23505') return json({ code: 'CONFLICT', message: 'That record already exists.', details: {} }, 409);
    console.error(e); return json({ code: 'INTERNAL', message: 'Something went wrong on the server.', details: {} }, 500);
  }
}
