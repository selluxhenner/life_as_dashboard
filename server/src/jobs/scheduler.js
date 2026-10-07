// In-process scheduler (node-cron, Europe/Berlin — DST handled by the zone).
// Every job run is keyed by (job, slot) in job_runs, so a restart or overlapping tick never runs a slot twice.
import cron from 'node-cron';
import { db } from '../db.js';
import { config } from '../config.js';
import { getSetting } from '../settings.js';
import { localDate, localTime } from '../lib/time.js';
import { BudgetError, AiUnavailable } from '../ai/claude.js';
import { refreshCalendar, refreshInbox } from './refresh.js';
import { newsTick, buildDigest } from './news.js';
import { aiDaily, aiWatch } from './aimodels.js';
import { briefingJob } from './briefing.js';
import { triageInbox } from './triage.js';
import { meetingPrep, jobNudge } from './assist.js';

export const JOBS = {
  refresh: async () => ({ inbox: await refreshInbox(), triaged: await triageInbox() }),
  calendar: refreshCalendar,
  news: newsTick,
  digest: () => buildDigest(localDate() + ' ' + localTime().slice(0, 2)),
  aimodels: aiDaily,
  aiwatch: aiWatch,
  briefing: briefingJob,
  triage: triageInbox,
  prep: meetingPrep,
  nudge: jobNudge,
  maintenance: maintenance
};

let running = 0;
const queue = [];

/* Run a job once per slot. force=true ignores the slot record (manual runs). */
export async function runJob(name, slot = localDate() + ' ' + localTime(), { force = false } = {}) {
  const fn = JOBS[name];
  if (!fn) throw new Error('Unknown job ' + name);
  if (!force) {
    const r = db.run('INSERT OR IGNORE INTO job_runs (job, slot, status, started_at) VALUES (?, ?, ?, ?)', name, slot, 'running', Date.now());
    if (!r.changes) return { skipped: true, slot };
  } else db.run('INSERT OR REPLACE INTO job_runs (job, slot, status, started_at) VALUES (?, ?, ?, ?)', name, slot, 'running', Date.now());
  if (running >= 3) await new Promise(res => queue.push(res));
  running++;
  try {
    const info = await fn();
    db.run('UPDATE job_runs SET status = ?, finished_at = ?, info = ? WHERE job = ? AND slot = ?', 'done', Date.now(), JSON.stringify(info ?? null).slice(0, 2000), name, slot);
    return { ok: true, slot, info };
  } catch (e) {
    const status = e instanceof BudgetError || e instanceof AiUnavailable ? 'skipped' : 'error';
    db.run('UPDATE job_runs SET status = ?, finished_at = ?, info = ? WHERE job = ? AND slot = ?', status, Date.now(), e.message.slice(0, 500), name, slot);
    if (status === 'error') console.error(`[job ${name}]`, e);
    return { ok: false, slot, error: e.message };
  } finally {
    running--;
    queue.shift()?.();
  }
}

async function maintenance() {
  const day = 86400000, now = Date.now();
  db.run('DELETE FROM news_items WHERE published_at < ?', now - 14 * day);
  db.run('DELETE FROM news_digests WHERE created_at < ?', now - 14 * day);
  db.run('DELETE FROM emails WHERE received_at < ?', now - 7 * day);
  db.run('DELETE FROM ai_updates WHERE published_at < ?', now - 60 * day);
  db.run('DELETE FROM job_runs WHERE started_at < ?', now - 30 * day);
  db.run('DELETE FROM agent_runs WHERE started_at < ?', now - 90 * day);
  db.run('DELETE FROM notifications WHERE created_at < ?', now - 30 * day);
  db.exec('PRAGMA optimize');
  return { ok: true };
}

/* The briefing runs 10 minutes before the configured time, so it's ready on the minute. */
function briefingDue(now) {
  const [h, m] = getSetting('briefing').time.split(':').map(Number);
  const target = h * 60 + m - 10;
  const [ch, cm] = localTime(now).split(':').map(Number);
  return ch * 60 + cm >= target;
}

export function startScheduler() {
  const tz = { timezone: config.tz };
  const slot15 = () => localDate() + ' ' + localTime();   // one run per job per minute
  cron.schedule('*/15 * * * *', () => { runJob('refresh', slot15()); runJob('prep', slot15()); }, tz);
  cron.schedule('*/30 6-23 * * *', () => runJob('news', slot15()), tz);
  cron.schedule('0 7,13,19 * * *', () => runJob('digest', localDate() + ' ' + localTime().slice(0, 2)), tz);
  cron.schedule('30 7 * * *', () => runJob('aimodels', localDate()), tz);
  cron.schedule('20 6-23 * * *', () => runJob('aiwatch', slot15()), tz);           // major AI news → alert
  cron.schedule('40 7 * * *', () => runJob('calendar', localDate() + ' am'), tz);
  cron.schedule('5 * * * *', () => runJob('calendar', localDate() + ' ' + localTime().slice(0, 2)), tz);
  // Briefing: checked every 5 minutes from 05:00, runs once per day as soon as its time has come.
  cron.schedule('*/5 5-12 * * *', () => { if (briefingDue(new Date())) runJob('briefing', localDate()); }, tz);
  cron.schedule('0 13,18 * * *', () => runJob('triage', localDate() + ' ' + localTime().slice(0, 2)), tz);
  cron.schedule('0 10 * * *', () => runJob('nudge', localDate()), tz);
  cron.schedule('0 3 * * *', () => runJob('maintenance', localDate()), tz);
  console.log('scheduler started (' + config.tz + ')');
}
