// Agent tasks: Lina (or Kevin in the app) hands work to an agent and follows it to the end.
//   hermes    · server-op  a verb of agent-ops.sh on the main server (read verbs run straight away, the rest need OK)
//   workbench · coding     a Claude or Codex session in Workbench on the PC or the Mac (always needs OK, once: the box's
//                          workbench-relay starts it with an orch token, so Workbench doesn't ask a second time)
//   server    · job        one of this server's jobs (briefing, inbox refresh …), run here, no OK needed
// A task that needs Kevin's OK creates an ordinary approval, so the phone buttons, the Hub and the Telegram relay
// decide it. For server-op the approval's verb and args are exactly what agent-ops.sh checks, so Hermes runs the verb
// with the task's approval id and Kevin approves once. Mounted in app.js with requireDevice: the apps create, read and
// cancel; an ops token (Hermes) reads its queue, starts, reports progress and finishes. Results are untrusted text.
import { Hono } from 'hono';
import { z } from 'zod';
import { db, j } from '../db.js';
import { HttpError } from '../http.js';
import { uid } from '../lib/crypto.js';
import { notify } from '../notify/index.js';
import { createApproval, getApproval, consumeApproval, decideApproval } from './approvals.js';

const HOUR = 3600000;
const STALE_MS = 2 * HOUR;           // a running task without news for this long is shown as stale
const arg = z.string().regex(/^[A-Za-z0-9_.:@\/-]{1,120}$/, 'args: no spaces or shell characters');

/* The verbs of agent-ops.sh (selluxhenner/agent-box, main-server/agent-ops.sh). That script stays the real guard:
   it re-checks every approval. This list only keeps Lina from asking for verbs that don't exist. */
export const READ_VERBS = ['status', 'pm2', 'docker', 'web', 'backups', 'errors', 'crawler'];
export const WRITE_VERBS = ['restart-container', 'pm2-restart', 'deploy', 'prune-docker', 'rotate-logs', 'renew-cert'];
/* Server jobs a task may start. Not maintenance (it deletes old data) and not the ones that only make sense on their schedule. */
export const TASK_JOBS = ['refresh', 'calendar', 'news', 'digest', 'briefing', 'triage', 'hub', 'aimodels'];

export const KINDS = {
  'server-op': {
    target: 'hermes',
    schema: z.object({ verb: z.enum([...READ_VERBS, ...WRITE_VERBS]), args: z.array(arg).max(6).default([]) }),
    needsApproval: p => WRITE_VERBS.includes(p.verb),
    approval: p => ({ verb: p.verb, args: p.args }),
    consumeOnStart: false           // agent-ops.sh consumes it when it runs the verb
  },
  coding: {
    target: 'workbench',
    schema: z.object({
      project: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, 'project: a hub project id'),
      prompt: z.string().trim().min(10).max(4000),
      agent: z.enum(['claude', 'codex']).default('claude'),
      // a Workbench session profile of that agent (plan, review, cheap …); Workbench checks it exists
      profile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'profile: a Workbench profile id').optional()
    }),
    needsApproval: () => true,
    approval: p => ({ verb: 'coding-session', args: [p.project, p.agent] }),
    consumeOnStart: true
  },
  job: {
    target: 'server',
    schema: z.object({ job: z.enum(TASK_JOBS) }),
    needsApproval: () => false
  }
};
export const TARGETS = [...new Set(Object.values(KINDS).map(k => k.target))];
/* Targets an ops token works: Hermes's server verbs, and the coding sessions the box's workbench-relay hands to
   Workbench. Server jobs run here. */
export const WORKER_TARGETS = ['hermes', 'workbench'];
const WHO = { hermes: 'Hermes', workbench: 'Workbench', server: 'Server' };
const ACTIVE = ['awaiting_approval', 'queued', 'running'];
const FINAL = ['done', 'failed', 'cancelled', 'rejected', 'expired'];

const CreateSchema = z.object({
  kind: z.enum(Object.keys(KINDS)),
  title: z.string().trim().min(3).max(120),
  params: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().trim().max(300).optional(),
  ttlMinutes: z.number().int().min(5).max(24 * 60).default(60)
});
const issues = e => e.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 300);

/** Shown status: while a task waits for its approval, the approval decides what the outside sees. */
function shownStatus(r) {
  if (r.status !== 'awaiting_approval') return r.status;
  const a = r.approval_id && getApproval(r.approval_id);
  if (!a) return 'awaiting_approval';
  if (a.status === 'approved' || a.status === 'used') return 'queued';
  if (a.status === 'rejected' || a.status === 'expired') return a.status;
  return 'awaiting_approval';
}

const view = (r, now = Date.now()) => {
  if (!r) return null;
  const status = shownStatus(r);
  return {
    id: r.id, target: r.target, kind: r.kind, title: r.title, params: j.parse(r.params, {}), reason: r.reason, source: r.source,
    status, approvalId: r.approval_id, worker: r.worker, progress: j.parse(r.progress, []), result: r.result, links: j.parse(r.links, {}),
    stale: status === 'running' && now - r.updated_at > STALE_MS,
    startedAt: r.started_at, finishedAt: r.finished_at, updatedAt: r.updated_at, createdAt: r.created_at
  };
};
const load = id => db.get('SELECT * FROM agent_tasks WHERE id = ?', id);
export const getTask = id => view(load(id));

/** Recent tasks, newest first. active=true: only those still waiting, queued or running. */
export function listTasks({ active = false, limit = 20 } = {}) {
  const rows = active
    ? db.all(`SELECT * FROM agent_tasks WHERE status IN (${ACTIVE.map(() => '?').join(', ')}) ORDER BY created_at DESC LIMIT 100`, ...ACTIVE)
    : db.all('SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT ?', limit);
  const out = rows.map(r => view(r));
  return (active ? out.filter(t => ACTIVE.includes(t.status)) : out).slice(0, limit);
}

/* Server jobs run here. The promise is kept so tests (and a caller that wants to wait) can await the result. */
const serverRuns = new Map();
export const serverRun = id => serverRuns.get(id);

/** Creates a task (Lina's start_task tool and POST /api/tasks). Returns the task as the outside sees it.
    requireApproval: Kevin must OK it even when its kind wouldn't need that (Lina's proposals from the background). */
export async function createTask(input, source = 'app', { requireApproval = false } = {}) {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, issues(parsed.error));
  const t = parsed.data;
  const kind = KINDS[t.kind];
  const p = kind.schema.safeParse(t.params);
  if (!p.success) throw new HttpError(400, 'params.' + issues(p.error));
  const params = p.data;

  const id = uid('tsk_');
  const now = Date.now();
  let approvalId = null;
  if (requireApproval && !kind.approval) throw new HttpError(400, `kind ${t.kind} can't wait for an approval`);
  if (requireApproval || kind.needsApproval(params)) {
    const a = await createApproval('lina', { ...kind.approval(params), reason: (t.reason || t.title).slice(0, 300), ttlMinutes: t.ttlMinutes });
    approvalId = a.id;
  }
  db.run(`INSERT INTO agent_tasks (id, target, kind, title, params, reason, source, status, approval_id, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, kind.target, t.kind, t.title, j.str(params), t.reason || null, String(source).slice(0, 20),
    approvalId ? 'awaiting_approval' : 'queued', approvalId, now, now);
  if (kind.target === 'server') serverRuns.set(id, runServerTask(id).finally(() => serverRuns.delete(id)));
  return getTask(id);
}

/* Moves a task that is ready (queued, or its approval came through) to running. Returns false if it isn't ready. */
function start(r, worker) {
  if (shownStatus(r) !== 'queued') return false;
  if (KINDS[r.kind].consumeOnStart && r.approval_id && !consumeApproval(r.approval_id)) return false;
  const now = Date.now();
  return !!db.run(`UPDATE agent_tasks SET status = 'running', worker = ?, started_at = ?, updated_at = ?
    WHERE id = ? AND status IN ('queued', 'awaiting_approval')`, worker, now, now, r.id).changes;
}

function addProgress(r, note) {
  const list = j.parse(r.progress, []);
  list.push({ at: Date.now(), note });
  db.run('UPDATE agent_tasks SET progress = ?, updated_at = ? WHERE id = ?', j.str(list.slice(-20)), Date.now(), r.id);
}

/** Ends a running task and tells Kevin. Server jobs only push when they fail. */
export async function finishTask(id, { status, result = null, links = {} }) {
  const now = Date.now();
  const changed = db.run(`UPDATE agent_tasks SET status = ?, result = ?, links = ?, finished_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running'`, status, result, j.str(links), now, now, id).changes;
  if (!changed) return false;
  const t = getTask(id);
  if (t.target !== 'server' || status === 'failed') {
    await notify({
      title: `${WHO[t.target]} · ${status === 'done' ? 'done' : 'failed'}: ${t.title}`.slice(0, 120),
      body: (result || (status === 'done' ? 'Finished.' : 'Failed without details.')).slice(0, 240),
      url: '#/hub', priority: status === 'failed' ? 4 : 3, kind: 'agent', ref: 'task:' + id
    }).catch(e => console.error('tasks: notify', e.message));
  }
  return true;
}

async function runServerTask(id) {
  const r = load(id);
  if (!start(r, 'server')) return;
  const { runJob } = await import('../jobs/scheduler.js');   // lazy: the scheduler imports the agent, which imports this
  const name = j.parse(r.params, {}).job;
  const out = await runJob(name, 'task-' + id, { force: true }).catch(e => ({ ok: false, error: e.message }));
  const info = out.ok ? JSON.stringify(out.info ?? null) : out.error;
  await finishTask(id, { status: out.ok ? 'done' : 'failed', result: `${name}: ${String(info).slice(0, 400)}` });
}

/* ---------- routes ---------- */
const isOps = u => u.scope === 'ops' || u.deviceId === 'master';
const isApp = u => u.scope === 'full';

function forWorker(c, { started = true } = {}) {
  const user = c.get('user');
  if (!isOps(user)) throw new HttpError(403, 'Use an ops token');
  const r = load(c.req.param('id'));
  if (!r || !WORKER_TARGETS.includes(r.target)) throw new HttpError(404, 'No such task');
  // progress and finish only from the token that started it
  if (started && r.worker && r.worker !== user.deviceId && user.deviceId !== 'master') throw new HttpError(403, 'Started by another worker');
  return { user, r };
}
async function json(c) { return c.req.json().catch(() => null); }

export const tasks = new Hono();

tasks.post('/tasks', async c => {
  if (!isApp(c.get('user'))) throw new HttpError(403, 'Use an app token');
  return c.json(await createTask(await json(c), 'app'), 201);
});

tasks.get('/tasks', c => {
  if (!isApp(c.get('user'))) throw new HttpError(403, 'Use an app token');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20));
  return c.json({ tasks: listTasks({ active: c.req.query('active') === '1', limit }) });
});

/* The box polls this (no side effects, so a cheap monitor can diff it): tasks for one target that are ready to start.
   ?target=hermes (default: Hermes's agent-tasks job) or workbench (the workbench-relay). */
tasks.get('/tasks/queue', c => {
  if (!isOps(c.get('user'))) throw new HttpError(403, 'Use an ops token');
  const target = c.req.query('target') || 'hermes';
  if (!WORKER_TARGETS.includes(target)) throw new HttpError(400, 'target: ' + WORKER_TARGETS.join(' or '));
  const rows = db.all("SELECT * FROM agent_tasks WHERE target = ? AND status IN ('queued', 'awaiting_approval') ORDER BY created_at LIMIT 50", target);
  return c.json({ tasks: rows.map(r => view(r)).filter(t => t.status === 'queued').slice(0, 10) });
});

tasks.get('/tasks/:id', c => {
  const user = c.get('user');
  const r = load(c.req.param('id'));
  if (!r || (!isApp(user) && !WORKER_TARGETS.includes(r.target))) throw new HttpError(404, 'No such task');
  return c.json(view(r));
});

/** Kevin decides through Lina (decide_approval): a task waiting for its OK (tsk_…) or one of Hermes's own approvals
    (apr_…). Same rules as the phone and the Hub: only an open approval, once. by: 'lina-chat' | 'lina-voice' | … */
export function decideTaskApproval(id, ok, by) {
  if (/^tsk_/.test(id)) {
    const r = load(id);
    if (!r) throw new HttpError(404, 'No such task');
    const shown = shownStatus(r);
    if (shown !== 'awaiting_approval') throw new HttpError(409, `Task is ${shown}`);
    decideApproval(r.approval_id, ok, by);
    const t = getTask(id);
    return { id: t.id, title: t.title, status: t.status };
  }
  const a = decideApproval(id, ok, by);
  return { id: a.id, verb: a.verb, args: a.args, status: a.status };
}

/** Kevin stops a task (the route and Lina's cancel_task). A pending or unused approval is withdrawn, so the phone card
    goes away and its id no longer runs the verb; a running worker sees 409 on its next call. */
export function cancelTask(id) {
  const r = load(id);
  if (!r) throw new HttpError(404, 'No such task');
  const shown = shownStatus(r);
  if (FINAL.includes(shown)) throw new HttpError(409, `Task is ${shown}`);
  const now = Date.now();
  db.tx(() => {
    db.run("UPDATE agent_tasks SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?", now, now, r.id);
    if (r.approval_id) db.run("UPDATE approvals SET status = 'rejected', decided_by = 'task-cancelled', decided_at = ? WHERE id = ? AND status IN ('pending', 'approved')", now, r.approval_id);
  });
  return getTask(r.id);
}

tasks.post('/tasks/:id/cancel', c => {
  if (!isApp(c.get('user'))) throw new HttpError(403, 'Use an app token');
  return c.json(cancelTask(c.req.param('id')));
});

tasks.post('/tasks/:id/start', c => {
  const { user, r } = forWorker(c, { started: false });
  if (!start(r, user.deviceId)) throw new HttpError(409, `Task is ${shownStatus(r)}`);
  return c.json(getTask(r.id));
});

const ProgressSchema = z.object({ note: z.string().trim().min(1).max(300) });
tasks.post('/tasks/:id/progress', async c => {
  const { r } = forWorker(c);
  const parsed = ProgressSchema.safeParse(await json(c));
  if (!parsed.success) throw new HttpError(400, 'note: 1 to 300 characters');
  if (r.status !== 'running') throw new HttpError(409, `Task is ${shownStatus(r)}`);   // cancelled → stop working
  addProgress(r, parsed.data.note);
  return c.json(getTask(r.id));
});

const url = z.string().url().max(500).refine(u => /^https?:/.test(u), 'http(s) only');
const FinishSchema = z.object({
  status: z.enum(['done', 'failed']),
  result: z.string().trim().min(1).max(4000),
  links: z.object({ pr: url.optional(), url: url.optional(), report: z.number().int().positive().optional(),
    device: z.string().regex(/^[A-Za-z0-9 ._()-]{1,60}$/).optional() }).strict().default({})   // device: where a coding session ran
});
tasks.post('/tasks/:id/finish', async c => {
  const { r } = forWorker(c);
  const parsed = FinishSchema.safeParse(await json(c));
  if (!parsed.success) throw new HttpError(400, issues(parsed.error));
  if (!(await finishTask(r.id, parsed.data))) throw new HttpError(409, `Task is ${shownStatus(r)}`);
  return c.json(getTask(r.id));
});
