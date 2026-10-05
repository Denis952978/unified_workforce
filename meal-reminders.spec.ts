import { sendMealReminders } from '../server/meal-reminders';
import { addDays, ymd } from '../server/production';
import { freshApp } from './helpers';

const TZ = 'Africa/Nairobi'; const MIN = 60_000;
const hhmm = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
let f: Awaited<ReturnType<typeof freshApp>>;
const now = Date.now(); const shiftStart = now - 3 * 60 * MIN; const shiftEnd = now + 20 * MIN; // a shift ending in 20 minutes
const shiftDate = ymd(shiftStart, TZ); const tomorrow = addDays(shiftDate, 1); const restDay = (new Date(shiftDate + 'T00:00:00Z').getUTCDay() + 3) % 7;

function person(n: number, name: string) {
  return { user: { id: 'u' + n, name, email: name.split(' ')[0].toLowerCase() + '@acme.co.ke', status: 'ACTIVE', roles: [{ role: 'employee', project_id: null }], employee_id: 'e' + n },
    emp: { id: 'e' + n, staff_no: String(n).padStart(3, '0'), full_name: name, active: true, shift_id: 'sNow', project_id: 'pA', rest: restDay } };
}
async function write(name: string, obj: any) { await f.s.db.query('UPDATE app_state SET json = $2, rev = rev + 1 WHERE name = $1', [name, JSON.stringify(obj)]); }
let core: any;

beforeAll(async () => {
  f = await freshApp();
  const people = [person(1, 'John Smith'), person(2, 'Mary Wanjiku'), person(3, 'Peter Otieno')];
  core = { v: 4, clockOffset: 0, company: { name: 'Acme Labelling', tz: TZ }, settings: { meal_reminder_minutes: 30 }, holidays: [], zones: [],
    projects: [{ id: 'pA', name: 'Project A', tz: TZ }], shiftDefs: [{ id: 'sNow', project_id: 'pA', name: 'DAY', start: hhmm(shiftStart), end: hhmm(shiftEnd) }],
    users: people.map(p => p.user), employees: people.map(p => p.emp), assignments: people.map(p => ({ employee_id: p.emp.id, project_id: 'pA', valid_to: null })),
    vendors: [{ id: 'v1', name: 'Kilele Kitchen', meal_type: 'LUNCH', deadline: '23:59', deadline_day: 0, lead_min: 0, active: true }],
    menu: [{ id: 'm1', v: 'v1', name: 'Pilau with kachumbari', active: true }, { id: 'm2', v: 'v1', name: 'Githeri with avocado', active: true }],
    priceRules: [{ mt: 'LUNCH', es: 10000, cs: 15000, from: '2000-01-01', to: null }] };
  await write('core', core);
  // John and Mary are at work this shift; Peter didn't come in. Mary has already booked tomorrow's lunch.
  await write('sessions', { sessions: [{ id: 's1', e: 'e1', d: shiftDate, in: shiftStart }, { id: 's2', e: 'e2', d: shiftDate, in: shiftStart }], adjustments: [], leave: [] });
  await write('bookings', { bookings: [{ id: 'b1', e: 'e2', d: tomorrow, mt: 'LUNCH', st: 'BOOKED' }] });
});
afterAll(async () => { await f.close(); });

test('nothing is sent earlier than 30 minutes before the shift ends', async () => {
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now - 15 * MIN)).toBe(0); // shift then ends in 35 minutes
});

test('within 30 minutes of the end, only the person at work who has not booked gets one email', async () => {
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now)).toBe(1);
  await f.mail.deliverDue();
  const m = f.sent.find(s => s.to === 'john@acme.co.ke')!;
  expect(m.subject).toMatch(/^Book your lunch for /);
  expect(m.text).toContain('Kilele Kitchen'); expect(m.text).not.toContain('Pilau'); expect(m.text).toContain('KES 100');
  expect(m.text).toContain('https://acme-workforce.netlify.app/');
  expect(m.html).toContain('Book my meal');
  expect(f.sent.some(s => s.to === 'mary@acme.co.ke')).toBe(false);  // already booked
  expect(f.sent.some(s => s.to === 'peter@acme.co.ke')).toBe(false); // not at work
});

test('the reminder is sent once, not every minute', async () => {
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now + MIN)).toBe(0);
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now + 5 * MIN)).toBe(0);
});

test('choosing "no meal" counts as answered; the admin can turn reminders off or change the timing', async () => {
  await f.s.db.query('DELETE FROM meal_reminders');
  await write('bookings', { bookings: [{ id: 'b1', e: 'e2', d: tomorrow, mt: 'LUNCH', st: 'BOOKED' }, { id: 'b2', e: 'e1', d: tomorrow, mt: 'LUNCH', st: 'NO_MEAL' }] });
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now)).toBe(0);
  await write('bookings', { bookings: [] });
  await write('core', { ...core, settings: { meal_reminder_minutes: 0 } });
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now)).toBe(0);
  await write('core', { ...core, settings: { meal_reminder_minutes: 15 } });
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now)).toBe(0);              // 20 minutes left: too early for a 15-minute reminder
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now + 6 * MIN)).toBe(2);    // 14 minutes left: John and Mary (neither booked now)
});

test('no reminder when booking has already closed, or there is no meal vendor', async () => {
  await f.s.db.query('DELETE FROM meal_reminders');
  await write('core', { ...core, vendors: [{ ...core.vendors[0], deadline: '00:01', deadline_day: -1 }] }); // closed before now
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now)).toBe(0);
  await write('core', { ...core, vendors: [] });
  expect(await sendMealReminders(f.s.cfg, f.s.db, f.s.mail, now)).toBe(0);
});
