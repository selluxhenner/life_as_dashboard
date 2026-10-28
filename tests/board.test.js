import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// the board works on the app store, which lives in localStorage
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);

let state, board, model, captures;
beforeAll(async () => {
  ({ state } = await import('../src/core/store.js'));
  model = await import('../src/core/model.js');
  board = await import('../src/core/board.js');
  captures = await import('../src/features/capture/captures.js');
});
beforeEach(() => {
  state.tasks = [];
  state.captures = [];
  state.board = { projects: [] };
});

describe('status', () => {
  it('reads tasks from before the board as To do or Done', () => {
    expect(board.statusOf({ done: false })).toBe('todo');
    expect(board.statusOf({ done: true, status: 'doing' })).toBe('done');
    // reopened on an older app: done went false, status still says done
    expect(board.statusOf({ done: false, status: 'done' })).toBe('todo');
    expect(board.statusOf({ done: false, status: 'backlog' })).toBe('backlog');
  });
  it('moving to Done ticks the task off, moving back reopens it', () => {
    const t = model.addTask('Ship board', 'high', { project: 'life-os' });
    board.moveTask(t, 'doing');
    expect(t.status).toBe('doing');
    expect(t.done).toBe(false);
    board.moveTask(t, 'done');
    expect(t.done).toBe(true);
    expect(t.completedAt).toBeTruthy();
    board.moveTask(t, 'todo');
    expect(t.done).toBe(false);
    expect(t.completedAt).toBe(null);
    expect(state.sync.dirty[t.id]).toBe(true);
  });
});

describe('projects and filters', () => {
  it('lists registry projects, added ones and ones only found on tasks', () => {
    board.addProject('Uni CODE', 'private');
    model.addTask('x', 'med', { project: 'mystery' });
    const ids = board.projects().map(p => p.id);
    expect(ids).toEqual(expect.arrayContaining(['life-os', 'private', 'nextup', 'uni-code', 'mystery']));
    expect(board.addProject('Uni CODE').id).toBe('uni-code');
    expect(state.board.projects).toHaveLength(1);
  });
  it('filters by kind and by project, and groups into columns', () => {
    model.addTask('gym plan', 'med', { project: 'private' });
    model.addTask('pitch deck', 'med', { project: 'nextup', status: 'doing' });
    model.addTask('hub tab', 'high', { project: 'life-os', status: 'backlog' });
    model.addTask('loose', 'low');
    expect(board.boardTasks({ kind: 'private' }).map(t => t.title)).toEqual(['gym plan']);
    expect(board.boardTasks({ kind: 'next' }).map(t => t.title)).toEqual(['pitch deck']);
    expect(board.boardTasks({ kind: 'project' }).map(t => t.title)).toEqual(['hub tab']);
    expect(board.boardTasks({ kind: 'unplaced' }).map(t => t.title)).toEqual(['loose']);
    expect(board.boardTasks({ project: 'life-os' })).toHaveLength(1);
    const cols = board.columns(board.boardTasks());
    expect(cols.backlog.map(t => t.title)).toEqual(['hub tab']);
    expect(cols.doing.map(t => t.title)).toEqual(['pitch deck']);
    expect(cols.todo).toHaveLength(2);
  });
  it('summarises a project', () => {
    model.addTask('a', 'med', { project: 'workbench', status: 'doing' });
    model.addTask('b', 'med', { project: 'workbench' });
    const c = model.addTask('c', 'med', { project: 'workbench' });
    board.moveTask(c, 'done');
    expect(board.projectSummary('workbench')).toMatchObject({ open: 2, doing: 1, todo: 1, done: 1, doneWeek: 1 });
  });
  it('maps Workbench sessions to projects by folder name', () => {
    expect(board.projectForSession({ project: 'life_as_dashboard' })).toBe('life-os');
    expect(board.projectForSession({ project: 'open_claw' })).toBe('hermes');
    expect(board.projectForSession({ project: 'something-else' })).toBe(null);
  });
});

describe('captures to the board', () => {
  it('unsorted captures wait in the inbox and move onto the board with a project', () => {
    const [c] = captures.captureText('Fix sync bug in Lina');
    expect(board.captureInbox()).toContain(c);
    const t = board.forwardCapture(c, 'life-os', 'todo');
    expect(c.type).toBe('task');
    expect(t.title).toBe('Fix sync bug in Lina');
    expect(t.project).toBe('life-os');
    expect(board.statusOf(t)).toBe('todo');
    expect(board.captureInbox()).not.toContain(c);
  });
  it('a task capture without a project stays in the inbox until it gets one', () => {
    const [c] = captures.captureText('Call the landlord');
    captures.setType(c, 'task');
    expect(board.captureInbox()).toContain(c);
    board.forwardCapture(c, 'private');
    expect(board.captureInbox()).not.toContain(c);
    expect(state.tasks.filter(t => !t.deleted)).toHaveLength(1);
  });
});
