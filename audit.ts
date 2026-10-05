import { Db, Queryable } from './db';
export async function audit(db: Db, q: Queryable | null, actorAccountId: string | null, action: string, entity: string, entityId: string | null, detail: Record<string, unknown> = {}, ip: string | null = null) {
  await db.query('INSERT INTO audit_log (actor_account_id, action, entity, entity_id, detail, source_ip) VALUES ($1, $2, $3, $4, $5, $6)',
    [actorAccountId, action, entity, entityId, JSON.stringify(detail), ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null], q ?? undefined);
}
