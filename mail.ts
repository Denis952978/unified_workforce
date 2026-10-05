import * as nodemailer from 'nodemailer';
import { Config } from './config';
import { Db, Queryable } from './db';

export interface OutgoingMail { to: string; subject: string; text: string; html: string; ref?: string }
export interface MailTransport { sendMail(m: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> }
const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720];
export const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;

/**
 * Emails are written to email_outbox in the same transaction as the change that caused them.
 * The API sends a few straight away; the scheduled "deliver-email" function retries the rest every minute,
 * so a mail-server outage delays an email but never loses it.
 */
export class Mailer {
  private transport: MailTransport;
  constructor(private cfg: Config, private db: Db) {
    this.transport = cfg.smtp.host
      ? nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure, auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000 })
      : { sendMail: async () => { throw new Error('SMTP is not configured (set SMTP_HOST)'); } };
  }
  useTransport(t: MailTransport) { this.transport = t; }
  async enqueue(q: Queryable, m: OutgoingMail) {
    await this.db.query('INSERT INTO email_outbox (to_email, subject, text_body, html_body, ref) VALUES ($1, $2, $3, $4, $5)', [m.to, m.subject, m.text, m.html, m.ref ?? null], q);
  }
  /** Sends what is due, oldest first, stopping after `budgetMs` so a request never runs into the function time limit. */
  async deliverDue(limit = 20, budgetMs = 20_000): Promise<{ sent: number; failed: number }> {
    const t0 = Date.now(); let sent = 0, failed = 0;
    while (Date.now() - t0 < budgetMs) {
      const n = await this.db.tx(async c => {
        const rows = await this.db.query(`SELECT * FROM email_outbox WHERE status = 'PENDING' AND next_attempt_at <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit], c);
        for (const r of rows) {
          if (Date.now() - t0 > budgetMs) break;
          try {
            await this.transport.sendMail({ from: this.cfg.mailFrom, to: r.to_email, subject: r.subject, text: r.text_body, html: r.html_body });
            await this.db.query(`UPDATE email_outbox SET status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [r.id], c); sent++;
          } catch (e) {
            const attempts = r.attempts + 1; const give = attempts >= MAX_ATTEMPTS;
            await this.db.query(`UPDATE email_outbox SET attempts = $2, last_error = $3, status = $4, next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id = $1`,
              [r.id, attempts, String((e as Error).message).slice(0, 500), give ? 'FAILED' : 'PENDING', String(BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)])], c);
            failed++;
          }
        }
        return rows.length;
      });
      if (n < limit) break;
    }
    return { sent, failed };
  }
}
