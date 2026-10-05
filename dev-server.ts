/**
 * Runs the whole system on your computer the way Netlify serves it: files from public/,
 * and /api/*, /invite/accept and /healthz handled by the same code as the Netlify function.
 *   npm run dev        then open http://localhost:8888
 * (The Netlify CLI's `netlify dev` works too.)
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { extname, join, normalize } from 'path';
import { handle, Services, services } from '../server/app';
import { forwardedIp } from '../server/network';
import { sendMealReminders } from '../server/meal-reminders';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const API = /^\/(api\/|invite\/accept$|healthz$)/;

export function devServer(s: Services = services(), publicDir = join(__dirname, '..', 'public')): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (API.test(url.pathname)) {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v); else if (Array.isArray(v)) headers.set(k, v.join(', '));
      const r = await handle(new Request(url.href.replace('http://localhost', `http://${req.headers.host}`), { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : Buffer.concat(chunks) }),
        forwardedIp(req.socket.remoteAddress || '', req.headers['x-forwarded-for'] as string, s.cfg.trustedProxies), s);
      const out: Record<string, string | string[]> = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; }); const sc = (r.headers as any).getSetCookie?.(); if (sc?.length) out['set-cookie'] = sc;
      res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    let file = normalize(join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(publicDir) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', ...(file.endsWith('.html') ? { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' } : {}) });
    res.end(readFileSync(file));
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8888);
  const s = services(); setInterval(() => { s.db.ensureSchema().then(() => sendMealReminders(s.cfg, s.db, s.mail)).then(() => s.mail.deliverDue()).catch(e => console.error('email:', e.message)); }, 60_000);
  devServer(s).listen(port, () => console.log(`UnifiedWorkforce running at http://localhost:${port}`));
}
