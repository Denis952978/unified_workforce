import { PoolClient } from 'pg';
import { Db, Queryable } from './db';
import { ApiError } from './errors';
import { isAdmin, managedProjects, Member, RoleAssignment, SessionUser } from './roles';

export const GROUPS = ['core', 'days', 'sessions', 'prod', 'bookings', 'mealdocs', 'outbox', 'notes'] as const;
/** Written only by the server (from the browser extension); readable by the app. */
export const SERVER_GROUPS = ['activity'] as const;
const READABLE: readonly string[] = [...GROUPS, ...SERVER_GROUPS];
export type Revs = Record<string, number>;
const MAX_GROUP_BYTES = 4 * 1024 * 1024; // Netlify functions accept requests up to 6 MB

export interface Core {
  company?: { name?: string; tz?: string }; users: Member[]; employees: any[]; assignments: any[]; zones: { name: string; cidr: string; active: boolean }[];
  projects: any[]; [k: string]: any;
}

/**
 * The app's shared records. Every change is a commit against the versions the browser last saw;
 * if anyone else changed the records in between, the commit is refused with STALE and the browser
 * re-applies its change to the fresh copy. Commits are serialised with row locks.
 */
export class StateStore {
  private cache: { rev: number; core: Core | null } = { rev: -1, core: null };
  constructor(private db: Db, private cfg: { testControls: boolean }) {}

  async revs(q: Queryable = this.db.pool): Promise<Revs> {
    const out: Revs = {}; for (const r of await this.db.query('SELECT name, rev FROM app_state', [], q)) out[r.name] = Number(r.rev); return out;
  }
  async read(names?: string[]) {
    const want = names && names.length ? names.filter(n => READABLE.includes(n)) : [...READABLE];
    const rows = await this.db.query('SELECT name, rev, json FROM app_state WHERE name = ANY($1)', [want]);
    const groups: Record<string, { rev: number; json: string | null }> = {}; for (const r of rows) groups[r.name] = { rev: Number(r.rev), json: r.json };
    return { groups, revs: await this.revs() };
  }
  async core(q: Queryable = this.db.pool): Promise<Core | null> {
    const row = await this.db.one('SELECT rev FROM app_state WHERE name = $1', ['core'], q);
    const rev = Number(row?.rev ?? 0);
    if (rev === this.cache.rev) return this.cache.core;
    const full = await this.db.one('SELECT rev, json FROM app_state WHERE name = $1', ['core'], q);
    const core = full?.json ? normalise(JSON.parse(full.json)) : null;
    this.cache = { rev: Number(full?.rev ?? 0), core }; return core;
  }
  member(core: Core | null, id: string) { return core?.users.find(u => u.id === id) ?? null; }
  async lockAll(c: PoolClient) {
    const rows = await this.db.query('SELECT name, rev, json FROM app_state ORDER BY name FOR UPDATE', [], c);
    const map: Record<string, { rev: number; json: string | null }> = {}; for (const r of rows) map[r.name] = { rev: Number(r.rev), json: r.json }; return map;
  }
  async write(c: PoolClient, name: string, json: string, by: string | null) {
    await this.db.query('UPDATE app_state SET rev = rev + 1, json = $2, updated_at = now(), updated_by = $3 WHERE name = $1', [name, json, by], c);
  }

  async commit(actor: SessionUser, base: Revs, groups: Record<string, string>) {
    if (!base || typeof base !== 'object' || !groups || typeof groups !== 'object') throw new ApiError(400, 'VALIDATION_FAILED', 'base and groups are required.');
    const names = Object.keys(groups);
    if (!names.length) throw new ApiError(422, 'NOTHING_TO_SAVE', 'No changes were sent.');
    for (const n of names) {
      if (!(GROUPS as readonly string[]).includes(n)) throw new ApiError(422, 'UNKNOWN_GROUP', `Unknown records group "${n}".`);
      if (typeof groups[n] !== 'string' || groups[n].length > MAX_GROUP_BYTES) throw new ApiError(413, 'TOO_LARGE', `The ${n} records are too large to save.`);
      let parsed: unknown; try { parsed = JSON.parse(groups[n]); } catch { throw new ApiError(422, 'INVALID_JSON', `The ${n} records are not valid.`); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError(422, 'INVALID_JSON', `The ${n} records are not valid.`);
    }
    return this.db.tx(async c => {
      const cur = await this.lockAll(c);
      const stale = GROUPS.filter(n => (base[n] ?? -1) !== cur[n].rev);
      if (stale.length) throw new ApiError(409, 'STALE', 'Someone else saved a change first.', { revs: Object.fromEntries(GROUPS.map(n => [n, cur[n].rev])) });
      if (groups.core !== undefined) {
        if (!cur.core.json) throw new ApiError(409, 'NOT_SET_UP', 'The company has not been set up yet.');
        checkCoreChange(normalise(JSON.parse(cur.core.json)), normalise(JSON.parse(groups.core)), actor, this.cfg);
      }
      for (const n of names) if (groups[n] !== cur[n].json) await this.write(c, n, groups[n], actor.accountId);
      return { revs: await this.revs(c) };
    });
  }
}

export function normalise(core: any): Core {
  for (const k of ['users', 'employees', 'assignments', 'zones', 'projects']) if (!Array.isArray(core[k])) core[k] = [];
  return core as Core;
}

const json = (v: unknown) => JSON.stringify(v ?? null);
const isEmail = (e: unknown) => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;

/** Who is in which team project, for scope checks. */
function memberProjects(core: Core, m: Member): string[] {
  const out = new Set<string>(m.roles.filter(r => r.project_id).map(r => r.project_id as string));
  if (m.employee_id) for (const a of core.assignments) if (a.employee_id === m.employee_id && !a.valid_to) out.add(a.project_id);
  return [...out];
}
function onlyTeamRoles(roles: RoleAssignment[], allowed: string[]) {
  return roles.every(r => r.role === 'employee' || (r.role === 'supervisor' && allowed.includes(r.project_id as string)));
}

/**
 * Server-side rules for the people and settings records. The browser runs the day-to-day logic
 * (check-in, shifts, meals), but it cannot grant access, link accounts or change company settings
 * beyond what the signed-in person's role allows.
 */
export function checkCoreChange(old: Core, next: Core, actor: SessionUser, cfg: { testControls: boolean }) {
  const admin = isAdmin(actor); const pmOf = managedProjects(actor);
  const deny = (msg: string): never => { throw new ApiError(403, 'FORBIDDEN', msg); };
  const role = (r: string) => actor.roles.some(x => x.role === r);

  const before = new Map(old.users.map(u => [u.id, u])); const after = new Map(next.users.map(u => [u.id, u]));
  const emails = new Set<string>();
  for (const u of next.users) {
    if (!isEmail(u.email)) throw new ApiError(422, 'INVALID_EMAIL', `"${u.email}" is not a valid email address.`);
    const e = u.email.toLowerCase(); if (emails.has(e)) throw new ApiError(409, 'EMAIL_TAKEN', `${u.email} is used by more than one person.`); emails.add(e);
    const was = before.get(u.id);
    if (!was) {
      if (u.status !== 'INVITED') deny('New people join by invitation only.');
      if (!admin) { if (!pmOf.length) deny('Only administrators and project managers can add people.'); if (!onlyTeamRoles(u.roles, pmOf)) deny('Project managers can add team members and supervisors to their own projects only.'); if (!memberProjects(next, u).every(p => pmOf.includes(p)) || !memberProjects(next, u).length) deny('You can only add people to projects you manage.'); }
      continue;
    }
    if (u.id === actor.memberId && json(u.roles) !== json(was.roles) && !admin) deny('Ask an administrator to change your own access.');
    if ((u.email || '').toLowerCase() !== (was.email || '').toLowerCase() && was.status !== 'INVITED' && !admin) deny('Only administrators can change a member\'s email.');
    if (u.status !== was.status) {
      const ok = (was.status === 'ACTIVE' && u.status === 'DISABLED') || (was.status === 'DISABLED' && u.status === 'ACTIVE');
      if (!ok) deny('That change of account status is made by the server (for example, accepting an invitation).');
      if (!admin) deny('Only administrators can deactivate or reactivate accounts.');
    }
    if (json(u.roles) !== json(was.roles) && !admin) {
      if (!pmOf.length) deny('Only administrators and project managers can change access.');
      if (!onlyTeamRoles(was.roles, pmOf) || !onlyTeamRoles(u.roles, pmOf)) deny('Project managers can only change team members and supervisors on their own projects.');
    }
  }
  for (const was of old.users) if (!after.has(was.id)) {
    if (was.status !== 'INVITED' && was.status !== 'PENDING') deny('Members are deactivated, not deleted, so their history is kept.');
    if (!admin && !(pmOf.length && onlyTeamRoles(was.roles, pmOf))) deny('Only administrators can remove that invitation.');
  }
  if (!next.users.some(u => u.status === 'ACTIVE' && u.roles.some(r => r.role === 'admin'))) deny('The company must keep at least one active administrator.');

  const changed = (k: string) => json(old[k]) !== json(next[k]);
  for (const k of ['company', 'settings', 'zones', 'statuses', 'holidays', 'projects', 'shiftDefs', 'labelboxDetection']) if (changed(k) && !admin) deny(`Only administrators can change ${k === 'shiftDefs' ? 'shifts' : k}.`);
  if (changed('priceRules') && !admin && !role('finance')) deny('Only Finance and administrators can change meal prices.');
  for (const k of ['vendors', 'menu']) if (changed(k) && !admin && !role('logistics')) deny('Only Logistics and administrators can change vendors and menus.');
  for (const k of ['targets', 'weights']) if (changed(k) && !admin && !pmOf.length) deny('Only project managers and administrators can change targets.');
  if ((next.clockOffset || 0) !== (old.clockOffset || 0)) { if (!cfg.testControls) deny('The server clock cannot be moved.'); if (!admin) deny('Only administrators can move the test clock.'); }
}
