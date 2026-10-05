import { Server } from 'http';
import { AddressInfo } from 'net';
import { Client } from 'pg';
import request from 'supertest';
import { services, Services } from '../server/app';
import { devServer } from '../scripts/dev-server';

export const DB = process.env.TEST_DATABASE_URL || 'postgresql://uws:uws@localhost:5432/uws_test';
export const OFFICE = '10.20.4.17', HOME = '197.248.10.5';
export interface Sent { to: string; subject: string; text: string; html: string }

/** A fresh database and the system served exactly as on Netlify (static files + the API function's handler). */
export async function freshApp(env: Record<string, string> = {}) {
  const c = new Client({ connectionString: DB }); await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();
  const s: Services = services({ NODE_ENV: 'test', DATABASE_URL: DB, PUBLIC_URL: 'https://acme-workforce.netlify.app', JWT_SECRET: 'x'.repeat(40), TRUSTED_PROXIES: '127.0.0.1', ...env });
  await s.db.ensureSchema();
  const sent: Sent[] = []; const ctl = { fail: 0 };
  s.mail.useTransport({ sendMail: async (m: any) => { if (ctl.fail > 0) { ctl.fail--; throw new Error('SMTP connection refused'); } sent.push(m); return {}; } });
  const server: Server = devServer(s); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => { await new Promise(r => server.close(r)); await s.db.pool.end(); };
  return { s, server, base, sent, ctl, mail: s.mail, close };
}
export function agent(server: Server, ip = OFFICE) {
  const a = request.agent(server);
  return { get: (u: string) => a.get(u).set('X-Forwarded-For', ip), post: (u: string) => a.post(u).set('X-Forwarded-For', ip) };
}
export function tokenFor(sent: Sent[], email: string) {
  const m = [...sent].reverse().find(s => s.to === email); if (!m) throw new Error('no email to ' + email);
  return decodeURIComponent(m.text.match(/token=([^\s&]+)/)![1]);
}
export function baseCore(): any {
  return {
    v: 4, clockOffset: 0, company: { name: 'Acme Labelling', tz: 'Africa/Nairobi' }, settings: {}, statuses: [], holidays: [],
    zones: [{ id: 'z1', name: 'Office LAN', cidr: '10.20.0.0/16', active: true }],
    projects: [{ id: 'pA', name: 'Project A', tz: 'Africa/Nairobi' }, { id: 'pB', name: 'Project B', tz: 'Africa/Nairobi' }],
    shiftDefs: [{ id: 'sA', project_id: 'pA', name: 'DAY', start: '06:00', end: '15:00' }, { id: 'sB', project_id: 'pB', name: 'DAY', start: '08:00', end: '17:00' }],
    employees: [{ id: 'e_admin', staff_no: '001', full_name: 'Grace Admin', active: true, shift_id: 'sA', project_id: 'pA' }],
    assignments: [] as any[],
    users: [{ id: 'u_admin', name: 'Grace Admin', email: 'grace@acme.co.ke', status: 'ACTIVE', roles: [{ role: 'admin', project_id: null }, { role: 'employee', project_id: null }], employee_id: 'e_admin' }] as any[],
    priceRules: [], vendors: [], menu: [], targets: [], weights: {},
  };
}
export type CoreT = ReturnType<typeof baseCore>;
export function invited(id: string, name: string, email: string, roles: any[], project?: { pid: string; shift: string; sup?: string }, by = 'u_admin') {
  const eid = 'e_' + id;
  return { user: { id, name, email, status: 'INVITED', roles, employee_id: eid, invitedBy: by },
    employee: { id: eid, staff_no: id.slice(-3), full_name: name, active: false, shift_id: project?.shift || 'sA', project_id: project?.pid || 'pA' },
    assignment: project && roles.every(r => r.role === 'employee') ? { employee_id: eid, project_id: project.pid, sup: project.sup || null, valid_from: '2026-10-01', valid_to: null } : null };
}
