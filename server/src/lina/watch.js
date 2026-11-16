// Watches Workbench while the server runs: a session that starts, finishes, fails or waits for Kevin becomes an entry
// in Lina's feed, so she can say "the nextup session is done" without being asked. Every 90 seconds, only when
// WORKBENCH_URL and WORKBENCH_TOKEN are set. The first look only remembers what is there.
import { config } from '../config.js';
import { workbenchSessions, workbenchPlans } from '../routes/workbench.js';
import { addFeed } from './feed.js';

const EVERY_MS = 90000;
const LEVEL = { done: 'good', completed: 'good', idle: 'info', failed: 'alert', error: 'alert', waiting: 'warn', 'needs-input': 'warn', blocked: 'warn' };
let seen = null, seenAttention = null, timer = null;

const label = s => s.title || s.project || s.id;

/** One look. Returns the entries it added (for tests). */
export async function watchWorkbench(now = Date.now()) {
  const wb = await workbenchSessions(now);
  if (!wb.configured || !wb.reachable) return [];
  const added = [];
  const next = new Map(wb.sessions.map(s => [s.id, s.status || 'unknown']));
  if (seen) {
    for (const s of wb.sessions) {
      const was = seen.get(s.id), is = s.status || 'unknown';
      if (was === is) continue;
      const title = was == null ? `Workbench · started: ${label(s)}` : `Workbench · ${label(s)}: ${is}`;
      const body = [s.project, s.branch, s.ahead ? s.ahead + ' commits ahead' : null, s.unpushed ? 'not pushed' : null].filter(Boolean).join(' · ');
      const e = addFeed({ source: 'workbench', kind: 'session', title, body, level: LEVEL[is] || 'info', ref: `wb:${s.id}:${is}`, at: now });
      if (e) added.push(e);
    }
  }
  seen = next;
  const plans = await workbenchPlans(now);
  if (plans.available) {
    const keys = new Set(plans.attention.map(a => a.title));
    if (seenAttention) for (const a of plans.attention) {
      if (seenAttention.has(a.title)) continue;
      const e = addFeed({ source: 'workbench', kind: 'plan', title: 'Workbench · ' + a.title, body: a.detail || '', level: 'warn', ref: 'wbplan:' + a.title, at: now });
      if (e) added.push(e);
    }
    seenAttention = keys;
  }
  return added;
}

export function startWorkbenchWatch() {
  if (timer || !config.workbench.url || !config.workbench.token) return;
  const run = () => watchWorkbench().catch(e => console.error('workbench watch', e.message));
  run();
  timer = setInterval(run, EVERY_MS);
  timer.unref?.();
}
export const resetWatch = () => { seen = null; seenAttention = null; };
