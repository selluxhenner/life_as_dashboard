// What Kevin is working on in Workbench (home PC), for the Plan board.
// The server reads Workbench's agent feed (GET /api/workbench-agent/sessions, bearer wbk_ token) over the tailnet
// and caches it briefly, so the phone never needs a route to the PC. No prompts, diffs or paths come through.
import { Hono } from 'hono';
import { config } from '../config.js';

const CACHE_MS = 30000;
const TIMEOUT_MS = 5000;
let cache = null;

export function resetWorkbenchCache() { cache = null; }

const pick = s => ({
  id: String(s.id), title: String(s.title || '').slice(0, 80), project: String(s.project || ''), agent: s.agent || null,
  branch: s.branch || null, status: s.status || null, lastActivityAt: s.lastActivityAt || s.createdAt || null,
  dirtyFiles: Number(s.dirtyFiles) || 0, ahead: Number(s.ahead) || 0, unpushed: !!s.unpushed
});

export async function workbenchSessions(now = Date.now()) {
  const { url, token } = config.workbench;
  if (!url || !token) return { configured: false, reachable: false, sessions: [], at: now };
  if (cache && now - cache.at < CACHE_MS) return cache;
  try {
    const res = await fetch(url + '/api/workbench-agent/sessions', {
      headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) throw new Error('Workbench answered ' + res.status);
    const json = await res.json();
    const list = (json && json.data && json.data.sessions) || [];
    cache = { configured: true, reachable: true, sessions: list.map(pick), at: now };
  } catch (e) {
    // keep the last good list visible, marked as stale
    cache = { configured: true, reachable: false, error: e.name === 'TimeoutError' ? 'Workbench did not answer' : e.message,
      sessions: cache ? cache.sessions : [], at: now };
  }
  return cache;
}

/* Where orch's plans stand (GET /api/workbench-agent/plans, a newer Workbench). Older Workbench builds answer 404:
   {available: false}, and Lina says she can see sessions only. Cached like the sessions. */
let plansCache = null;
const pickPlan = p => ({
  id: String(p.id || p.plan || ''), title: String(p.title || p.id || '').slice(0, 100), state: p.state || null,
  done: Number(p.done) || 0, total: Number(p.total) || 0, running: Number(p.running) || 0, waiting: Number(p.waiting) || 0,
  next: p.next ? String(p.next).slice(0, 120) : null
});
export async function workbenchPlans(now = Date.now()) {
  const { url, token } = config.workbench;
  if (!url || !token) return { configured: false, available: false, plans: [], attention: [], at: now };
  if (plansCache && now - plansCache.at < CACHE_MS) return plansCache;
  try {
    const res = await fetch(url + '/api/workbench-agent/plans', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) plansCache = { configured: true, available: false, plans: [], attention: [], at: now };
    else if (!res.ok) throw new Error('Workbench answered ' + res.status);
    else {
      const d = ((await res.json()) || {}).data || {};
      plansCache = { configured: true, available: true, plans: (d.plans || []).slice(0, 20).map(pickPlan),
        attention: (d.attention || []).slice(0, 10).map(a => ({ title: String(a.title || '').slice(0, 120), detail: a.detail ? String(a.detail).slice(0, 200) : null })), at: now };
    }
  } catch (e) {
    plansCache = { configured: true, available: !!plansCache?.available, error: e.name === 'TimeoutError' ? 'Workbench did not answer' : e.message,
      plans: plansCache ? plansCache.plans : [], attention: plansCache ? plansCache.attention : [], at: now };
  }
  return plansCache;
}

export const workbench = new Hono();

workbench.get('/workbench/sessions', async c => c.json(await workbenchSessions()));
workbench.get('/workbench/plans', async c => c.json(await workbenchPlans()));
