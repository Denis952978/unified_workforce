/** Settings come from Netlify environment variables (Site configuration > Environment variables). */
function bool(v: string | undefined, d: boolean) { return v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()); }
function num(v: string | undefined, d: number) { const n = Number(v); return v && Number.isFinite(n) ? n : d; }

export interface Config {
  env: string; databaseUrl: string; publicUrl: string; jwtSecret: string; sessionTtlHours: number; cookieSecure: boolean;
  inviteTtlDays: number; minPasswordLength: number; smtp: { host: string; port: number; secure: boolean; user: string; pass: string }; mailFrom: string;
  enforceNetwork: boolean; allowAcceptOffNetwork: boolean; testControls: boolean; setupToken: string; trustedProxies: string[];
  /** How often open screens check for changes. Each check is one function call. */
  pollSeconds: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c: Config = {
    env: env.NODE_ENV || (env.NETLIFY ? 'production' : 'development'),
    // Netlify DB / Neon provide NETLIFY_DATABASE_URL; any PostgreSQL works through DATABASE_URL
    databaseUrl: env.DATABASE_URL || env.NETLIFY_DATABASE_URL || 'postgresql://uws:uws@localhost:5432/uws',
    // Netlify sets URL to the site's main address
    publicUrl: (env.PUBLIC_URL || env.URL || 'http://localhost:8888').replace(/\/$/, ''),
    jwtSecret: env.JWT_SECRET || '',
    sessionTtlHours: num(env.SESSION_TTL_HOURS, 12),
    cookieSecure: bool(env.COOKIE_SECURE, !!env.NETLIFY || env.NODE_ENV === 'production'),
    inviteTtlDays: num(env.INVITE_TTL_DAYS, 7),
    minPasswordLength: num(env.MIN_PASSWORD_LENGTH, 10),
    smtp: { host: env.SMTP_HOST || '', port: num(env.SMTP_PORT, 587), secure: bool(env.SMTP_SECURE, false), user: env.SMTP_USER || '', pass: env.SMTP_PASS || '' },
    mailFrom: env.MAIL_FROM || 'UnifiedWorkforce <no-reply@example.com>',
    enforceNetwork: bool(env.ENFORCE_NETWORK, false),
    allowAcceptOffNetwork: bool(env.ALLOW_ACCEPT_OFF_NETWORK, true),
    testControls: bool(env.TEST_CONTROLS, false),
    setupToken: env.SETUP_TOKEN || '',
    trustedProxies: (env.TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean),
    pollSeconds: Math.min(300, Math.max(3, num(env.POLL_SECONDS, 15))),
  };
  if (!c.jwtSecret) {
    if (c.env === 'production') throw new Error('JWT_SECRET is not set. Add it under Site configuration > Environment variables (at least 32 random characters).');
    c.jwtSecret = 'dev-only-secret-change-me';
  }
  if (c.env === 'production' && c.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
  return c;
}
