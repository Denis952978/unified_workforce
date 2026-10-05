import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { Config } from './config';
import { Db, Queryable } from './db';
import { ApiError } from './errors';
import { SessionUser } from './roles';
import { StateStore } from './state';

export const SESSION_COOKIE = 'uws_session';
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5yPAIMs9OEdGq8wM2UW7y0Wl3rpFlaq';

export class Auth {
  constructor(private cfg: Config, private db: Db, private state: StateStore) {}
  hashPassword(pw: string) { return bcrypt.hash(pw, 12); }
  verifyPassword(pw: string, hash: string | null | undefined) { return bcrypt.compare(String(pw ?? ''), hash || DUMMY_HASH); }
  checkPasswordStrength(pw: unknown) {
    if (typeof pw !== 'string' || pw.length < this.cfg.minPasswordLength) throw new ApiError(422, 'WEAK_PASSWORD', `Use at least ${this.cfg.minPasswordLength} characters.`);
    if (pw.length > 200) throw new ApiError(422, 'WEAK_PASSWORD', 'That password is too long.');
  }
  issueToken(accountId: string) { return jwt.sign({ sub: accountId }, this.cfg.jwtSecret, { expiresIn: `${this.cfg.sessionTtlHours}h`, algorithm: 'HS256' }); }
  /** A longer-lived key for the browser extension. It can only report activity and read the person's own totals. */
  issueExtensionToken(accountId: string) { return jwt.sign({ sub: accountId, typ: 'ext' }, this.cfg.jwtSecret, { expiresIn: '30d', algorithm: 'HS256' }); }
  verifyToken(token: string): string | null { return this.verify(token)?.sub ?? null; }
  verify(token: string): { sub: string; ext: boolean } | null {
    try { const p = jwt.verify(token, this.cfg.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload; return typeof p.sub === 'string' ? { sub: p.sub, ext: p.typ === 'ext' } : null; } catch { return null; }
  }
  sessionCookie(token: string) { return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${this.cfg.sessionTtlHours * 3600}${this.cfg.cookieSecure ? '; Secure' : ''}`; }
  clearCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.cfg.cookieSecure ? '; Secure' : ''}`; }

  /** An account works only while its person is ACTIVE in the company records. */
  async sessionUser(accountId: string, q?: Queryable): Promise<SessionUser | null> {
    const a = await this.db.one('SELECT id, email, member_id FROM accounts WHERE id = $1', [accountId], q);
    if (!a) return null;
    const m = this.state.member(await this.state.core(q), a.member_id);
    if (!m || m.status !== 'ACTIVE') return null;
    return { accountId: a.id, email: a.email, memberId: a.member_id, name: m.name, roles: m.roles || [] };
  }
  async login(email: string, password: string): Promise<SessionUser> {
    const a = await this.db.one('SELECT id, password_hash FROM accounts WHERE lower(email) = lower($1)', [email]);
    const ok = await this.verifyPassword(password, a?.password_hash);
    if (!a || !ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'That email and password do not match an account.');
    const u = await this.sessionUser(a.id);
    if (!u) throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated. Contact an administrator.');
    await this.db.query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [a.id]);
    return u;
  }
  async changePassword(u: SessionUser, current: string, next: string) {
    const a = await this.db.one('SELECT password_hash FROM accounts WHERE id = $1', [u.accountId]);
    if (!(await this.verifyPassword(current, a?.password_hash))) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Your current password is not right.');
    this.checkPasswordStrength(next);
    await this.db.query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [u.accountId, await this.hashPassword(next)]);
  }
}
