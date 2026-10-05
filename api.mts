import type { Config, Context } from '@netlify/functions';
import { handle } from '../server/app';

/** The UnifiedWorkforce API, the invitation page and the health check. */
export default async (req: Request, context: Context) => handle(req, context.ip);

export const config: Config = { path: ['/api/*', '/invite/accept', '/healthz'] };
