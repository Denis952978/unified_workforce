import type { Config } from '@netlify/functions';
import { services } from '../server/app';
import { sendMealReminders } from '../server/meal-reminders';

/** Every minute: queue "book your meal" reminders that are due, then send any emails still waiting (first tries and retries). */
export default async () => {
  const s = services(); await s.db.ensureSchema();
  const reminders = await sendMealReminders(s.cfg, s.db, s.mail).catch(e => { console.error('meal reminders:', e.message); return 0; });
  if (reminders) console.log(`meal reminders queued: ${reminders}`);
  const r = await s.mail.deliverDue(25, 20_000);
  if (r.sent || r.failed) console.log(`email: ${r.sent} sent, ${r.failed} failed (will retry)`);
};

export const config: Config = { schedule: '* * * * *' };
