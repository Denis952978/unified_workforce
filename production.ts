import { Db } from './db';
import { ApiError } from './errors';
import { SessionUser } from './roles';
import { Core, StateStore } from './state';

/**
 * Activity from the browser extension: when a labeller starts labelling or reviewing in Labelbox,
 * how long they actively work (tab in front, keyboard or mouse used in the last 5 minutes), and how many
 * items they submit or review. Time and counts are only credited inside the person's rostered shift.
 */
export interface Activity { e: string; d: string; p: string; sid: string; startedAt: number; last: number | null; lastBeat: number | null; ls: number; rs: number; ul: number; ur: number; task: 'LABEL' | 'REVIEW'; state: 'active' | 'idle' | 'stopped'; url?: string }
export interface ExtEvent { type: 'start' | 'beat' | 'item' | 'stop'; task?: string; seconds?: number; count?: number; url?: string }

export const DEFAULT_DETECTION = {
  hosts: ['labelbox.com'],
  startLabel: ['start labeling', 'start labelling', 'label data', 'start annotating'],
  startReview: ['start reviewing', 'start review', 'review data'],
  submitLabel: ['submit'],
  submitReview: ['approve', 'reject', 'submit review'],
  idleMinutes: 5,
};
export type Detection = typeof DEFAULT_DETECTION;

const MAX_BEAT_SECONDS = 90;      // a heartbeat never credits more than this
const MAX_ITEMS_PER_EVENT = 20;   // one report can't add more than this many items
const KEEP_DAYS = 3;

// ---- time helpers (shift windows are in the project's timezone) ----
const _dtf: Record<string, Intl.DateTimeFormat> = {};
function parts(ms: number, tz: string) {
  const f = _dtf[tz] || (_dtf[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const o: Record<string, string> = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value; return o;
}
function offset(ms: number, tz: string) { const p = parts(ms, tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; }
export function ymd(ms: number, tz: string) { return new Date(ms + offset(ms, tz)).toISOString().slice(0, 10); }
export function zoned(date: string, time: string, tz: string) {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number); const guess = Date.UTC(y, m - 1, d, hh, mm);
  const o1 = offset(guess, tz); let t = guess - o1; const o2 = offset(t, tz); if (o2 !== o1) t = guess - o2; return t;
}
export const addDays = (date: string, n: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

/** The shift that is running for this labeller right now, if any. */
export function runningShift(core: Core, memberId: string, now: number) {
  const m = core.users.find(u => u.id === memberId); if (!m || !m.employee_id) return { error: 'NOT_A_LABELLER' as const };
  const emp = core.employees.find((e: any) => e.id === m.employee_id);
  const asg = core.assignments.find((a: any) => a.employee_id === m.employee_id && !a.valid_to);
  if (!emp || !asg) return { error: 'NOT_A_LABELLER' as const };
  const proj = core.projects.find((p: any) => p.id === asg.project_id); const tz = proj?.tz || core.company?.tz || 'UTC';
  const today = ymd(now, tz);
  for (const d of [today, addDays(today, -1)]) {
    const def = (core.shiftDefs || []).find((s: any) => s.id === ((core.shiftAssign || {})[emp.id + '|' + d] || emp.shift_id)); if (!def) continue;
    const start = zoned(d, def.start, tz); const end = zoned(def.end <= def.start ? addDays(d, 1) : d, def.end, tz);
    if (now >= start && now < end) return { emp, project: asg.project_id as string, def, d, start, end, tz };
  }
  return { error: 'NO_SHIFT_RUNNING' as const, emp };
}

export class Production {
  constructor(private db: Db, private state: StateStore) {}

  async detection(): Promise<Detection> { const core = await this.state.core(); return { ...DEFAULT_DETECTION, ...((core as any)?.labelboxDetection || {}) }; }

  /** Applies a batch of extension events for the signed-in labeller and returns their running totals. */
  async record(u: SessionUser, events: ExtEvent[], now = Date.now()) {
    if (!Array.isArray(events) || events.length > 50) throw new ApiError(400, 'VALIDATION_FAILED', 'events must be a list of at most 50 items.');
    for (const ev of events) {
      if (!ev || !['start', 'beat', 'item', 'stop'].includes(ev.type)) throw new ApiError(400, 'VALIDATION_FAILED', 'Unknown event type.');
      if (ev.task !== undefined && !['LABEL', 'REVIEW'].includes(ev.task)) throw new ApiError(400, 'VALIDATION_FAILED', 'task must be LABEL or REVIEW.');
      if (ev.url !== undefined && (typeof ev.url !== 'string' || ev.url.length > 500)) throw new ApiError(400, 'VALIDATION_FAILED', 'url is too long.');
    }
    return this.db.tx(async c => {
      const core = await this.state.core(c); if (!core) throw new ApiError(409, 'NOT_SET_UP', 'The company is not set up yet.');
      const sh = runningShift(core, u.memberId, now);
      if ('error' in sh && sh.error === 'NOT_A_LABELLER') throw new ApiError(409, 'NOT_A_LABELLER', 'Only members of a labelling team record production time.');
      const row = await this.db.one(`SELECT json FROM app_state WHERE name = 'activity' FOR UPDATE`, [], c);
      const doc = row?.json ? JSON.parse(row.json) : { activity: {} }; const all: Record<string, Activity> = doc.activity || (doc.activity = {});
      if ('error' in sh) return { counting: false, reason: 'No shift is running for you right now, so time and items are not counted.', totals: null };
      const key = sh.emp.id + '|' + sh.d;
      const a: Activity = all[key] || (all[key] = { e: sh.emp.id, d: sh.d, p: sh.project, sid: sh.def.id, startedAt: now, last: null, lastBeat: null, ls: 0, rs: 0, ul: 0, ur: 0, task: 'LABEL', state: 'stopped' });
      for (const ev of events) {
        const task = (ev.task as 'LABEL' | 'REVIEW') || a.task;
        if (ev.type === 'start') { a.task = task; a.state = 'active'; if (ev.url) a.url = ev.url; }
        if (ev.type === 'stop') a.state = 'stopped';
        if (ev.type === 'beat') {
          // credit only real elapsed time since the last heartbeat, never more than 90 s, never past the shift end
          const claimed = Math.max(0, Math.min(MAX_BEAT_SECONDS, Number(ev.seconds) || 0));
          const since = a.lastBeat ? (now - a.lastBeat) / 1000 + 5 : MAX_BEAT_SECONDS;
          const credit = Math.max(0, Math.min(claimed, since, (sh.end - now) / 1000 + claimed));
          if (task === 'REVIEW') a.rs += credit; else a.ls += credit;
          a.task = task; a.lastBeat = now; a.state = claimed > 0 ? 'active' : 'idle';
        }
        if (ev.type === 'item') { const n = Math.max(0, Math.min(MAX_ITEMS_PER_EVENT, Math.floor(Number(ev.count) || 1))); if (task === 'REVIEW') a.ur += n; else a.ul += n; a.task = task; }
        a.last = now;
      }
      a.ls = Math.round(a.ls); a.rs = Math.round(a.rs);
      const cut = addDays(sh.d, -KEEP_DAYS); for (const k of Object.keys(all)) if (all[k].d < cut) delete all[k];
      await this.state.write(c, 'activity', JSON.stringify(doc), u.accountId);
      return { counting: true, totals: this.view(core, a) };
    });
  }

  /** What the extension popup shows. */
  async mine(u: SessionUser, now = Date.now()) {
    const core = await this.state.core(); if (!core) throw new ApiError(409, 'NOT_SET_UP', 'The company is not set up yet.');
    const sh = runningShift(core, u.memberId, now);
    if ('error' in sh) return { counting: false, reason: sh.error === 'NOT_A_LABELLER' ? 'You are not on a labelling team.' : 'No shift is running for you right now.', totals: null, name: u.name };
    const row = await this.db.one(`SELECT json FROM app_state WHERE name = 'activity'`);
    const a = (row?.json ? JSON.parse(row.json).activity : {})[sh.emp.id + '|' + sh.d] || null;
    return { counting: true, name: u.name, shift: { date: sh.d, start: sh.def.start, end: sh.def.end, ends_at: sh.end }, totals: a ? this.view(core, a) : null };
  }

  private view(core: Core, a: Activity) {
    const t = (task: string) => { const ts = ((core as any).targets || []).filter((x: any) => x.p === a.p && x.task === task && x.from <= a.d).sort((x: any, y: any) => y.from.localeCompare(x.from)); return ts.length ? ts[0].uph : (task === 'LABEL' ? 900 : 1400); };
    const lh = a.ls / 3600, rh = a.rs / 3600; const tl = t('LABEL'), tr = t('REVIEW');
    const pct = (units: number, h: number, tgt: number) => h > 0 ? Math.round(units / h / tgt * 1000) / 10 : null;
    const hours = lh + rh; const qty = hours > 0 ? Math.round((((pct(a.ul, lh, tl) || 0) * lh + (pct(a.ur, rh, tr) || 0) * rh) / hours) * 10) / 10 : null;
    return { date: a.d, task: a.task, state: a.state, active_seconds: a.ls + a.rs, labelled: a.ul, reviewed: a.ur, label_target: tl, review_target: tr, label_pct: pct(a.ul, lh, tl), review_pct: pct(a.ur, rh, tr), quantity_pct: qty, last_report: a.last };
  }
}
