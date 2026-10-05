import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { audit as auditLog } from './audit';
import { Auth } from './auth';
import { Config } from './config';
import { Db, Queryable } from './db';
import { ApiError } from './errors';
import { Mailer } from './mail';
import { isAdmin, mainRole, managedProjects, Member, SessionUser } from './roles';
import { Core, normalise, StateStore } from './state';
import { acceptedEmail, invitationEmail, resetEmail } from './templates';

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export class Invitations {
  private audit = { log: (q: Queryable | null, actor: string | null, action: string, entity: string, id: string | null, detail: Record<string, unknown> = {}, ip: string | null = null) => auditLog(this.db, q, actor, action, entity, id, detail, ip) };
  constructor(private cfg: Config, private db: Db, private mail: Mailer, private auth: Auth, private state: StateStore) {}

  private projectsOf(core: Core, m: Member): string[] {
    const out = new Set<string>(m.roles.filter(r => r.project_id).map(r => r.project_id as string));
    if (m.employee_id) for (const a of core.assignments) if (a.employee_id === m.employee_id && !a.valid_to) out.add(a.project_id);
    return [...out];
  }
  /** Admins invite anyone; project managers invite team members and supervisors on their own projects. */
  private mayInvite(u: SessionUser, core: Core, m: Member) {
    if (isAdmin(u)) return true;
    const mine = managedProjects(u); const ps = this.projectsOf(core, m);
    return mine.length > 0 && m.roles.every(r => r.role === 'employee' || (r.role === 'supervisor' && mine.includes(r.project_id as string))) && ps.length > 0 && ps.every(p => mine.includes(p));
  }
  private describe(core: Core, m: Member) {
    const r = mainRole(m); const pid = r.project_id || this.projectsOf(core, m)[0];
    return { role: r.role, project: pid ? core.projects.find(p => p.id === pid)?.name ?? null : null };
  }
  private link(token: string) { return `${this.cfg.publicUrl}/invite/accept?token=${encodeURIComponent(token)}`; }

  private async queue(c: Queryable, core: Core, kind: 'INVITE' | 'RESET', m: Member, inviter: string, token: string, expiresAt: Date, invId: string) {
    const co = core.company?.name || 'UnifiedWorkforce'; const tz = core.company?.tz || 'UTC';
    const mail = kind === 'INVITE'
      ? invitationEmail({ company: co, tz, fullName: m.name, ...this.describe(core, m), inviter, link: this.link(token), expiresAt })
      : resetEmail({ company: co, tz, fullName: m.name, inviter, link: this.link(token), expiresAt });
    await this.mail.enqueue(c, { to: m.email.toLowerCase(), ...mail, ref: `${kind.toLowerCase()}:${invId}` });
  }

  /** Emails an invitation to each person the app has just added (status INVITED). */
  async send(u: SessionUser, memberIds: string[], ip: string | null) {
    const core = await this.state.core(); if (!core) throw new ApiError(409, 'NOT_SET_UP', 'Set up the company first.');
    return this.db.tx(async c => {
      const out: any[] = [];
      for (const id of [...new Set(memberIds)]) {
        const m = this.state.member(core, id);
        if (!m) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'That person is not in the company records. Save them first.');
        if (m.status !== 'INVITED') throw new ApiError(409, 'NOT_INVITED', `${m.name} is already ${m.status === 'ACTIVE' ? 'a member' : m.status.toLowerCase()}.`);
        if (!this.mayInvite(u, core, m)) throw new ApiError(403, 'NOT_IN_SCOPE', `You can't invite ${m.name}: project managers invite team members and supervisors on their own projects.`);
        if (await this.db.one('SELECT 1 FROM accounts WHERE lower(email) = lower($1)', [m.email], c)) throw new ApiError(409, 'ACCOUNT_EXISTS', `${m.email} already has an account.`);
        await this.db.query(`UPDATE invitations SET status = 'REVOKED' WHERE member_id = $1 AND kind = 'INVITE' AND status = 'PENDING'`, [id], c);
        const token = newToken();
        const inv = await this.db.one(`INSERT INTO invitations (kind, member_id, email, token_hash, invited_by_member, invited_by_account, expires_at)
          VALUES ('INVITE', $1, lower($2), $3, $4, $5, now() + ($6 || ' days')::interval) RETURNING *`, [id, m.email, hashToken(token), u.memberId, u.accountId, String(this.cfg.inviteTtlDays)], c);
        await this.queue(c, core, 'INVITE', m, u.name, token, new Date(inv!.expires_at), inv!.id);
        await this.audit.log(c, u.accountId, 'invitation.Sent', 'member', id, { email: m.email, ...this.describe(core, m) }, ip);
        out.push(view(inv));
      }
      return { invitations: out };
    });
  }

  async list(u: SessionUser, memberIds?: string[]) {
    const core = await this.state.core(); if (!core) return { invitations: [] };
    const rows = await this.db.query(`SELECT * FROM invitations WHERE kind = 'INVITE' AND ($1::text[] IS NULL OR member_id = ANY($1)) ORDER BY created_at DESC LIMIT 1000`, [memberIds?.length ? memberIds : null]);
    return { invitations: rows.filter(r => { const m = this.state.member(core, r.member_id); return m ? this.mayInvite(u, core, m) : isAdmin(u); }).map(view) };
  }

  private async mine(u: SessionUser, id: string, c: PoolClient) {
    const inv = await this.db.one('SELECT * FROM invitations WHERE id = $1 FOR UPDATE', [id], c);
    if (!inv) throw new ApiError(404, 'NOT_FOUND', 'Invitation not found.');
    const core = (await this.state.core(c))!; const m = this.state.member(core, inv.member_id);
    if (!(m ? this.mayInvite(u, core, m) : isAdmin(u))) throw new ApiError(403, 'NOT_IN_SCOPE', 'This invitation is outside your scope.');
    return { inv, core, m };
  }

  async resend(u: SessionUser, id: string, ip: string | null) {
    return this.db.tx(async c => {
      const { inv, core, m } = await this.mine(u, id, c);
      if (inv.status !== 'PENDING' || !m || m.status !== 'INVITED') throw new ApiError(409, 'NOT_PENDING', 'This invitation has already been used or cancelled.');
      if (Date.now() - new Date(inv.last_sent_at).getTime() < 60_000) throw new ApiError(429, 'TOO_SOON', 'Wait a minute before sending this invitation again.');
      const token = newToken(); // the earlier link stops working
      const upd = await this.db.one(`UPDATE invitations SET token_hash = $2, email = lower($3), expires_at = now() + ($4 || ' days')::interval, sent_count = sent_count + 1, last_sent_at = now() WHERE id = $1 RETURNING *`,
        [id, hashToken(token), m.email, String(this.cfg.inviteTtlDays)], c);
      await this.queue(c, core, 'INVITE', m, u.name, token, new Date(upd!.expires_at), id);
      await this.audit.log(c, u.accountId, 'invitation.Resent', 'member', inv.member_id, { email: m.email }, ip);
      return { invitation: view(upd) };
    });
  }

  async revoke(u: SessionUser, id: string, ip: string | null) {
    return this.db.tx(async c => {
      const { inv } = await this.mine(u, id, c);
      if (inv.status !== 'PENDING') throw new ApiError(409, 'NOT_PENDING', 'This invitation has already been used or cancelled.');
      const upd = await this.db.one(`UPDATE invitations SET status = 'REVOKED' WHERE id = $1 RETURNING *`, [id], c);
      await this.audit.log(c, u.accountId, 'invitation.Revoked', 'member', inv.member_id, { email: inv.email }, ip);
      return { invitation: view(upd) };
    });
  }

  /** Admin: email a link to choose a new password. */
  async sendReset(u: SessionUser, memberId: string, ip: string | null) {
    if (!isAdmin(u)) throw new ApiError(403, 'FORBIDDEN', 'Only administrators can send password resets.');
    return this.db.tx(async c => {
      const core = (await this.state.core(c))!; const m = this.state.member(core, memberId);
      const acct = await this.db.one('SELECT id FROM accounts WHERE member_id = $1', [memberId], c);
      if (!m || !acct || m.status !== 'ACTIVE') throw new ApiError(409, 'NO_ACCOUNT', 'Only active members with an account can reset their password.');
      await this.db.query(`UPDATE invitations SET status = 'REVOKED' WHERE member_id = $1 AND kind = 'RESET' AND status = 'PENDING'`, [memberId], c);
      const token = newToken();
      const inv = await this.db.one(`INSERT INTO invitations (kind, member_id, email, token_hash, invited_by_member, invited_by_account, expires_at, account_id)
        VALUES ('RESET', $1, lower($2), $3, $4, $5, now() + interval '2 days', $6) RETURNING *`, [memberId, m.email, hashToken(token), u.memberId, u.accountId, acct.id], c);
      await this.queue(c, core, 'RESET', m, u.name, token, new Date(inv!.expires_at), inv!.id);
      await this.audit.log(c, u.accountId, 'account.PasswordResetSent', 'member', memberId, {}, ip);
      return { ok: true };
    });
  }

  // ---- public: the person who received the email ----

  private async byToken(token: string, q: Queryable, lock = false) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    return this.db.one(`SELECT * FROM invitations WHERE token_hash = $1 ${lock ? 'FOR UPDATE' : ''}`, [hashToken(token)], q);
  }
  private invalid(): never { throw new ApiError(410, 'INVITATION_INVALID', 'This link is no longer valid. It may have expired, been used already, or been replaced by a newer email. Ask the person who sent it to send it again.'); }

  async preview(token: string) {
    const inv = await this.byToken(token, this.db.pool);
    if (!inv || inv.status !== 'PENDING' || new Date(inv.expires_at) < new Date()) this.invalid();
    const core = await this.state.core(); const m = this.state.member(core, inv.member_id);
    if (!core || !m || (inv.kind === 'INVITE' && m.status !== 'INVITED')) this.invalid();
    const inviter = this.state.member(core, inv.invited_by_member);
    return { invitation: { kind: inv.kind, email: m.email, full_name: m.name, ...this.describe(core, m), company: core.company?.name || 'UnifiedWorkforce', invited_by: inviter?.name ?? null, expires_at: inv.expires_at } };
  }

  /**
   * INVITE: creates the sign-in account and switches the person to ACTIVE in the company records, in one transaction.
   * RESET: sets a new password.
   */
  async accept(token: string, password: string, ip: string | null) {
    this.auth.checkPasswordStrength(password);
    const accountId = await this.db.tx(async c => {
      const inv = await this.byToken(token, c, true);
      if (!inv || inv.status !== 'PENDING' || new Date(inv.expires_at) < new Date()) this.invalid();
      const rows = await this.state.lockAll(c);
      if (!rows.core.json) this.invalid();
      const core = normalise(JSON.parse(rows.core.json!)); const m = core.users.find(u => u.id === inv.member_id);
      let acctId: string;
      if (inv.kind === 'RESET') {
        if (!m || m.status !== 'ACTIVE') this.invalid();
        const a = await this.db.one('UPDATE accounts SET password_hash = $2 WHERE member_id = $1 RETURNING id', [inv.member_id, await this.auth.hashPassword(password)], c);
        if (!a) this.invalid(); acctId = a!.id;
        await this.audit.log(c, acctId, 'account.PasswordReset', 'member', inv.member_id, {}, ip);
      } else {
        if (!m || m.status !== 'INVITED') this.invalid();
        if (await this.db.one('SELECT 1 FROM accounts WHERE lower(email) = lower($1) OR member_id = $2', [m!.email, m!.id], c)) throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists. Sign in instead.');
        const a = await this.db.one('INSERT INTO accounts (email, password_hash, member_id, last_login_at) VALUES (lower($1), $2, $3, now()) RETURNING id', [m!.email, await this.auth.hashPassword(password), m!.id], c);
        acctId = a!.id;
        m!.status = 'ACTIVE'; m!.code = null;
        const emp = m!.employee_id ? core.employees.find(e => e.id === m!.employee_id) : null; if (emp) emp.active = true;
        await this.state.write(c, 'core', JSON.stringify(core), acctId);
        await this.audit.log(c, acctId, 'invitation.Accepted', 'member', m!.id, { email: m!.email, ...this.describe(core, m!) }, ip);
        const inviter = inv.invited_by_member ? core.users.find(u => u.id === inv.invited_by_member && u.status === 'ACTIVE') : null;
        if (inviter) await this.mail.enqueue(c, { to: inviter.email.toLowerCase(), ...acceptedEmail({ company: core.company?.name || 'UnifiedWorkforce', fullName: m!.name, email: m!.email, ...this.describe(core, m!) }), ref: `accepted:${inv.id}` });
      }
      await this.db.query(`UPDATE invitations SET status = 'ACCEPTED', accepted_at = now(), account_id = $2 WHERE id = $1`, [inv.id, acctId], c);
      return acctId;
    });
    return { token: this.auth.issueToken(accountId) };
  }
}

function view(i: any) {
  return { id: i.id, member_id: i.member_id, email: i.email, status: i.status === 'PENDING' && new Date(i.expires_at) < new Date() ? 'EXPIRED' : i.status,
    expires_at: i.expires_at, sent_count: i.sent_count, last_sent_at: i.last_sent_at, accepted_at: i.accepted_at, created_at: i.created_at };
}
