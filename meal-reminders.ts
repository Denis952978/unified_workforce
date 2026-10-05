import { Config } from './config';
import { Db } from './db';
import { Mailer } from './mail';
import { addDays, ymd, zoned } from './production';
import { normalise } from './state';

const DAY = 86_400_000;
const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const weekday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const fmtDay = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(d + 'T00:00:00Z'));
const fmtTime = (ms: number, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const kes = (c: number) => 'KES ' + String(Math.round((c || 0) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * "Book your meal" reminders, run every minute by the scheduled function.
 * A person gets one email, `meal_reminder_minutes` (default 30) before their shift ends, when:
 * they are checked in for this shift, their next working day has a meal vendor, booking is still open,
 * and they haven't booked that meal or chosen "no meal" yet. The rules match the app's own meal logic.
 */
export async function sendMealReminders(cfg: Config, db: Db, mail: Mailer, at = Date.now()): Promise<number> {
  const rows = await db.query(`SELECT name, json FROM app_state WHERE name IN ('core', 'sessions', 'bookings')`);
  const g: Record<string, any> = {}; for (const r of rows) g[r.name] = r.json ? JSON.parse(r.json) : null;
  if (!g.core) return 0;
  const core = normalise(g.core); const now = at + (cfg.testControls ? (core.clockOffset || 0) : 0);
  const lead = Number((core.settings || {}).meal_reminder_minutes ?? 30); if (!(lead > 0)) return 0;
  const companyTz = core.company?.tz || 'Africa/Nairobi';
  const sessions: any[] = g.sessions?.sessions || []; const leave: any[] = g.sessions?.leave || []; const bookings: any[] = g.bookings?.bookings || [];
  const defOf = (emp: any, d: string) => (core.shiftDefs || []).find((s: any) => s.id === ((core.shiftAssign || {})[emp.id + '|' + d] || emp.shift_id));
  const working = (emp: any, d: string) => !(core.holidays || []).some((h: any) => h.date === d) && weekday(d) !== emp.rest
    && !leave.some(l => l.e === emp.id && l.status === 'APPROVED' && l.start <= d && l.end >= d);
  let sent = 0;
  for (const m of core.users) {
    if (m.status !== 'ACTIVE' || !m.employee_id) continue;
    const emp = core.employees.find((e: any) => e.id === m.employee_id); if (!emp || !emp.active) continue;
    const tz = (core.projects.find((p: any) => p.id === emp.project_id) || {}).tz || companyTz;
    // the shift that ends within the next `lead` minutes
    let shiftDate: string | null = null, shiftEnd = 0;
    for (const d of [ymd(now, tz), addDays(ymd(now, tz), -1)]) {
      const def = defOf(emp, d); if (!def) continue;
      const end = zoned(def.end <= def.start ? addDays(d, 1) : d, def.end, tz);
      if (now >= end - lead * 60_000 && now < end) { shiftDate = d; shiftEnd = end; break; }
    }
    if (!shiftDate || !sessions.some(s => s.e === emp.id && s.d === shiftDate)) continue; // only people at work this shift
    let next: string | null = null; for (let i = 1; i <= 7 && !next; i++) { const d = addDays(shiftDate, i); if (working(emp, d)) next = d; }
    if (!next) continue;
    const mealType = defOf(emp, next)?.name === 'NIGHT' ? 'DINNER' : 'LUNCH';
    const v = (core.vendors || []).find((x: any) => x.active && x.meal_type === mealType); if (!v) continue;
    const cutoff = zoned(addDays(next, v.deadline_day || 0), v.deadline, companyTz) - (v.lead_min || 0) * 60_000;
    if (now >= cutoff) continue;
    if (bookings.some(b => b.e === emp.id && b.d === next && b.mt === mealType && ['BOOKED', 'LOCKED', 'NO_MEAL'].includes(b.st))) continue;
    const fresh = await db.one('INSERT INTO meal_reminders (member_id, meal_date) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING member_id', [m.id, next]);
    if (!fresh) continue; // already reminded
    const rule = (core.priceRules || []).filter((r: any) => r.mt === mealType && r.from <= next! && (!r.to || r.to >= next!)).sort((a: any, b: any) => b.from.localeCompare(a.from))[0];
    const co = core.company?.name || 'UnifiedWorkforce'; const meal = mealType === 'LUNCH' ? 'lunch' : 'dinner';
    const subject = `Book your ${meal} for ${fmtDay(next)}`;
    const text = `Hi ${m.name},\n\nYour shift ends at ${fmtTime(shiftEnd, tz)}. Remember to book your ${meal} for ${fmtDay(next)} from ${v.name} (see this week's menu).\n\n${rule ? `Your share is ${kes(rule.es)} (deducted from salary); the company pays ${kes(rule.cs)}.\n` : ''}Booking closes ${fmtTime(cutoff, companyTz)}. Book or choose "no meal" here: ${cfg.publicUrl}/ (Meals)\n\n${co}`;
    const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#15262A;background:#E9EEE9;padding:28px 14px"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #CFD8D1;border-radius:12px;padding:24px">
<div style="font-weight:800">${esc(co)}</div><h1 style="font-size:21px;margin:12px 0 6px">Book your ${meal} for ${esc(fmtDay(next))}</h1>
<p style="margin:0 0 14px">Hi ${esc(m.name)}, your shift ends at ${esc(fmtTime(shiftEnd, tz))}. Book your ${meal} from ${esc(v.name)} (see this week's menu), or choose “no meal”.</p>
${rule ? `<p style="font-size:14px;color:#566762;margin:0 0 16px">Your share: <b>${esc(kes(rule.es))}</b> (deducted from salary). Company subsidy: ${esc(kes(rule.cs))}.</p>` : ''}
<a href="${esc(cfg.publicUrl)}/" style="display:inline-block;background:#0D5747;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Book my meal</a>
<p style="font-size:13px;color:#566762;margin:16px 0 0">Booking closes ${esc(fmtTime(cutoff, companyTz))}. Open Meals in the app and tap Book meal.</p></div></body></html>`;
    await mail.enqueue(db.pool, { to: m.email.toLowerCase(), subject, text, html, ref: `meal-reminder:${m.id}:${next}` });
    sent++;
  }
  return sent;
}
