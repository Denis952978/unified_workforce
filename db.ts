import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { MIGRATIONS } from './migrations';

types.setTypeParser(1082, v => v); // DATE stays 'YYYY-MM-DD'
export type Queryable = Pick<PoolClient, 'query'>;

/** One small pool per warm function instance. */
export class Db {
  readonly pool: Pool;
  private migrated: Promise<void> | null = null;
  constructor(url: string) {
    const ssl = /sslmode=(require|verify)/.test(url) || /neon\.tech|supabase\.co|render\.com|aws/.test(url) ? { rejectUnauthorized: false } : undefined;
    this.pool = new Pool({ connectionString: url.replace(/[?&]sslmode=[^&]+/, m => m.startsWith('?') ? '?' : '').replace(/\?$/, ''), ssl, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 });
  }
  async query<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], q: Queryable = this.pool): Promise<T[]> { return (await q.query<T>(sql, params)).rows; }
  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], q: Queryable = this.pool): Promise<T | null> { return (await this.query<T>(sql, params, q))[0] ?? null; }
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; }
    finally { c.release(); }
  }
  /** Creates the tables on first use; safe if several instances start at once. */
  ensureSchema(): Promise<void> {
    if (!this.migrated) this.migrated = (async () => {
      const c = await this.pool.connect();
      try {
        await c.query('SELECT pg_advisory_lock(727001)');
        await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
        const done = new Set((await c.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
        for (const [v, sql] of MIGRATIONS) {
          if (done.has(v)) continue;
          await c.query('BEGIN');
          try { await c.query(sql); await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [v]); await c.query('COMMIT'); }
          catch (e) { await c.query('ROLLBACK'); throw e; }
        }
      } finally { await c.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined); c.release(); }
    })().catch(e => { this.migrated = null; throw e; });
    return this.migrated;
  }
}
