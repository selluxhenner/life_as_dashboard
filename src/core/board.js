// The Plan board: every task as a Kanban card, grouped by project.
// Projects come from the hub registry (selluxhenner/hub projects.yaml) plus "Private" and any project Kevin adds.
// A task's column is `status`; tasks from before the board (or edited by an old app) have none and read as
// To do, or Done when they are done. Pure functions of the state — covered by tests/board.test.js.
import { state, save } from './store.js';
import { liveTasks, updateTask } from './model.js';
import { linked, updateCapture } from '../features/capture/captures.js';

export const STATUSES = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'To do' },
  { key: 'doing', label: 'Doing' },
  { key: 'done', label: 'Done' }
];

/* kind: private = Kevin's own life, next = nextup (the startup), project = a code project from the hub registry.
   repo = folder name Workbench reports for its sessions. */
export const HUB_PROJECTS = [
  { id: 'private', name: 'Private', kind: 'private' },
  { id: 'nextup', name: 'nextup', kind: 'next', repo: 'nextup' },
  { id: 'life-os', name: 'LIFE OS', kind: 'project', repo: 'life_as_dashboard' },
  { id: 'workbench', name: 'Workbench', kind: 'project', repo: 'workbench' },
  { id: 'hermes', name: 'Hermes', kind: 'project', repo: 'open_claw' },
  { id: 'hub', name: 'Hub', kind: 'project', repo: 'hub' },
  { id: 'agentic-os-framework', name: 'Agentic OS', kind: 'project', repo: 'agentic-os' },
  { id: 'obsidian_vault', name: 'Vault', kind: 'project', repo: 'obsidian_vault' },
  { id: 'bank_berlin', name: 'Finanzen Berlin', kind: 'private', repo: 'bank_berlin' }
];
export const KINDS = [
  { value: 'all', label: 'All' },
  { value: 'private', label: 'Private' },
  { value: 'next', label: 'nextup' },
  { value: 'project', label: 'Projects' }
];

const slug = s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/* Registry projects, then ones Kevin added on the board, then any project name only found on a task. */
export function projects() {
  const out = [...HUB_PROJECTS];
  for (const p of (state.board && state.board.projects) || []) if (!out.some(x => x.id === p.id)) out.push(p);
  for (const t of liveTasks()) if (t.project && !out.some(x => x.id === t.project)) out.push({ id: t.project, name: t.project, kind: 'project' });
  return out;
}
export const projectOf = id => projects().find(p => p.id === id) || null;

export function addProject(name, kind = 'project') {
  const id = slug(name);
  if (!id) return null;
  if (projectOf(id)) return projectOf(id);
  if (!state.board) state.board = { projects: [] };
  const p = { id, name: name.trim(), kind };
  state.board.projects.push(p);
  save();
  return p;
}

export function statusOf(t) {
  if (t.done) return 'done';
  return t.status && t.status !== 'done' ? t.status : 'todo';
}

/* Moving a card to Done ticks the task off; moving it out of Done reopens it. */
export function moveTask(t, status) {
  if (!STATUSES.some(s => s.key === status) || statusOf(t) === status && t.status === status) return;
  updateTask(t, { status, done: status === 'done' });
}

/* kind: all | private | next | project | unplaced; project: a project id or '' for every project of that kind */
export function boardTasks({ kind = 'all', project = '' } = {}) {
  return liveTasks().filter(t => {
    if (project) return t.project === project;
    if (kind === 'all') return true;
    if (kind === 'unplaced') return !t.project;
    const p = t.project ? projectOf(t.project) : null;
    return !!p && p.kind === kind;
  });
}

export function columns(tasks) {
  const cols = Object.fromEntries(STATUSES.map(s => [s.key, []]));
  for (const t of tasks) cols[statusOf(t)].push(t);
  const prio = { high: 0, med: 1, low: 2 };
  for (const k of Object.keys(cols)) {
    cols[k].sort(k === 'done'
      ? (a, b) => (b.completedAt || 0) - (a.completedAt || 0)
      : (a, b) => (prio[a.priority] ?? 1) - (prio[b.priority] ?? 1) || (a.due || '9999').localeCompare(b.due || '9999') || a.sort - b.sort);
  }
  return cols;
}

/* Per project: open cards per column, cards done in the last 7 days. */
export function projectSummary(id, now = Date.now()) {
  const tasks = liveTasks().filter(t => t.project === id);
  const n = { backlog: 0, todo: 0, doing: 0, done: 0, doneWeek: 0, open: 0 };
  for (const t of tasks) {
    const s = statusOf(t);
    n[s]++;
    if (s !== 'done') n.open++;
    else if (t.completedAt && now - t.completedAt < 7 * 864e5) n.doneWeek++;
  }
  return n;
}

/* Workbench names a session after its folder ("life_as_dashboard", a worktree keeps the repo name). */
export function projectForSession(session) {
  const folder = String(session.project || '').toLowerCase();
  const p = projects().find(x => x.repo && x.repo.toLowerCase() === folder) || projects().find(x => x.id === folder);
  return p ? p.id : null;
}

/* Captures that are not on the board yet: unsorted ones, and tasks that never got a project. */
export function captureInbox() {
  return state.captures.filter(c => {
    if (c.archived) return false;
    if (c.type === 'none') return true;
    if (c.type !== 'task') return false;
    const t = linked(c);
    return !!t && !t.project && !t.done;
  });
}

/* A capture goes onto the board: it becomes a task (if it isn't one) in that project and column. */
export function forwardCapture(c, project, status = 'todo') {
  if (c.type !== 'task') updateCapture(c, { type: 'task' });
  const t = linked(c);
  if (!t) return null;
  updateTask(t, { project: project || null, status, done: status === 'done' });
  return t;
}
