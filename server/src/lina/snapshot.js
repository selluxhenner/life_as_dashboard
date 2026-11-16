// "Where things stand" in one call, for Lina's deck in the apps and her status_report tool: Hermes, Workbench, agent
// tasks, approvals, the Obsidian vault, today's todos, the next calendar entry and the server's health.
import { db } from '../db.js';
import { config } from '../config.js';
import { listOpenTodos } from '../routes/todos.js';
import { listTasks } from '../routes/tasks.js';
import { pendingApprovals } from '../routes/approvals.js';
import { latestOps } from '../routes/ops.js';
import { recentAsks } from '../routes/hermes.js';
import { workbenchSessions, workbenchPlans } from '../routes/workbench.js';
import { vaultConnected, listNotes } from '../connectors/obsidian.js';
import { localDate } from '../lib/time.js';
import { untoldCount } from './feed.js';

const ONLINE_MS = 15 * 60000;
const ACTIVE = ['running', 'active', 'working', 'busy', 'waiting', 'needs-input'];

function hermes(now) {
  const reporters = db.all('SELECT DISTINCT source FROM ops_reports').map(r => r.source);
  const boxes = reporters.length
    ? db.all(`SELECT id, name, last_seen_at FROM devices WHERE revoked = 0 AND scope = 'ops' AND id IN (${reporters.map(() => '?').join(',')})`, ...reporters)
    : [];
  const last = Math.max(0, ...boxes.map(b => b.last_seen_at || 0));
  const asks = recentAsks(5);
  return {
    online: !!last && now - last < ONLINE_MS, lastSeenAt: last || null, name: boxes[0]?.name || 'agent-box',
    openAsks: asks.filter(a => a.status === 'open').length,
    lastAnswer: asks.find(a => a.answer) ? { question: asks.find(a => a.answer).question, answer: asks.find(a => a.answer).answer.slice(0, 300), at: asks.find(a => a.answer).answeredAt } : null
  };
}

function todos(today) {
  const open = listOpenTodos();
  const rank = t => (t.due && t.due < today ? 0 : t.due === today ? 1 : t.priority === 'high' ? 2 : 3);
  const focus = open.filter(t => rank(t) < 3).sort((a, b) => rank(a) - rank(b));
  return { open: open.length, overdue: open.filter(t => t.due && t.due < today).length, dueToday: open.filter(t => t.due === today).length,
    focus: (focus.length ? focus : open).slice(0, 6).map(t => ({ id: t.id, title: t.title, due: t.due || null, high: t.priority === 'high' })) };
}

function vault() {
  if (!config.obsidian.vault || !vaultConnected()) return { connected: false, recent: [] };
  try {
    const notes = listNotes();
    return { connected: true, notes: notes.length,
      recent: notes.slice(0, 6).map(n => ({ path: n.path, title: n.path.split('/').pop().replace(/\.md$/i, ''), folder: n.path.includes('/') ? n.path.split('/')[0] : null, at: n.mtime })) };
  } catch (e) { return { connected: false, error: e.message, recent: [] }; }
}

function nextEvent(now) {
  // starts are stored with their own offset, so compare as times, not as text
  const e = db.all('SELECT title, start, end, location, kind FROM calendar_events WHERE start >= ? AND all_day = 0 ORDER BY start LIMIT 30', localDate(new Date(now)))
    .find(x => new Date(x.end || x.start).getTime() > now);
  return e ? { title: e.title || '(no title)', start: e.start, end: e.end, location: e.location || null, lesson: e.kind === 'lesson' } : null;
}

function server() {
  const ops = latestOps();
  const worst = ops.find(r => r.status === 'fail') || ops.find(r => r.status === 'warn') || ops[0] || null;
  return worst ? { status: worst.status, summary: worst.summary, at: worst.createdAt } : null;
}

export async function linaSnapshot(now = Date.now()) {
  const [wb, plans] = await Promise.all([workbenchSessions(now), workbenchPlans(now)]);
  const tasks = listTasks({ limit: 12 });
  return {
    at: now,
    hermes: hermes(now),
    workbench: {
      configured: wb.configured, reachable: wb.reachable, error: wb.error || null,
      active: wb.sessions.filter(s => ACTIVE.includes(s.status)).length,
      sessions: wb.sessions.slice().sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)).slice(0, 6),
      plans: plans.available ? plans.plans : null, attention: plans.available ? plans.attention : []
    },
    tasks: { open: tasks.filter(t => ['awaiting_approval', 'queued', 'running'].includes(t.status)).length,
      list: tasks.slice(0, 5).map(t => ({ id: t.id, title: t.title, target: t.target, status: t.status, at: t.finishedAt || t.updatedAt })) },
    approvals: pendingApprovals().length,
    vault: vault(),
    todos: todos(localDate(new Date(now))),
    next: nextEvent(now),
    server: server(),
    unread: untoldCount(now)
  };
}
