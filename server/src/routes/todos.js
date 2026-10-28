// Todos with rev-based sync (ported from the Cloudflare Worker). Last write wins on updatedAt; deletes are tombstones.
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { HttpError, body } from '../http.js';
import { readDoc } from './docs.js';

const PRIORITIES = ['high', 'med', 'low'];
export const STATUSES = ['backlog', 'todo', 'doing', 'done'];   // Kanban column on the Plan board

/* Task groups (Private, School, Business, …) are the app's "taskGroups" document; a todo's `group` holds its group id
   (column task_group; `project` belongs to the Plan board).
   Until the groups are edited for the first time that document does not exist and these defaults apply. */
export const DEFAULT_GROUPS = [
  { id: 'private', name: 'Private', color: 'samerica' },
  { id: 'school', name: 'School', color: 'africa' },
  { id: 'business', name: 'Business', color: 'europe' }
];
export function taskGroups() { const g = readDoc('taskGroups'); return Array.isArray(g) ? g.filter(x => x && x.id && x.name) : DEFAULT_GROUPS; }
/* A group by id or by name ("school", "School"); null clears it. Unknown names are an error that lists the real ones. */
export function groupId(v) {
  if (v === null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  const g = taskGroups().find(x => x.id.toLowerCase() === s || x.name.trim().toLowerCase() === s);
  if (!g) throw new HttpError(400, `Unknown group "${v}". Groups: ${taskGroups().map(x => x.name).join(', ') || 'none'}`);
  return g.id;
}
export const groupName = id => (taskGroups().find(g => g.id === id) || {}).name || null;
const SOURCES = ['app', 'widget', 'claude', 'api', 'agent', 'voice', 'phone', 'capture'];
const MAX_BATCH = 200;

const rowToTodo = r => ({
  id: r.id, title: r.title, notes: r.notes, done: !!r.done, priority: r.priority, status: r.status ?? null, due: r.due, project: r.project, group: r.task_group ?? null,
  sort: r.sort, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at, deleted: !!r.deleted
});

function str(v, field, max, { required = false, nullable = false } = {}) {
  if (v === undefined) { if (required) throw new HttpError(400, `${field} is missing`); return undefined; }
  if (v === null || v === '') { if (required) throw new HttpError(400, `${field} must not be empty`); return nullable ? null : ''; }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be a string`);
  const s = v.trim();
  if (required && !s) throw new HttpError(400, `${field} must not be empty`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return s;
}
function num(v, field) {
  if (v === undefined || v === null) return v;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${field} must be a number`);
  return v;
}

export function validate(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Todo must be an object');
  const t = {};
  if (input.id !== undefined) {
    t.id = str(input.id, 'id', 64, { required: true });
    if (!/^[\w-]+$/.test(t.id)) throw new HttpError(400, 'id contains invalid characters');
  }
  t.title = str(input.title, 'title', 500, { required: !partial });
  t.notes = str(input.notes, 'notes', 5000);
  if (input.done !== undefined) { if (typeof input.done !== 'boolean') throw new HttpError(400, 'done must be boolean'); t.done = input.done; }
  if (input.priority !== undefined) { if (!PRIORITIES.includes(input.priority)) throw new HttpError(400, `priority must be ${PRIORITIES.join('|')}`); t.priority = input.priority; }
  if (input.status !== undefined && input.status !== null) { if (!STATUSES.includes(input.status)) throw new HttpError(400, `status must be ${STATUSES.join('|')}`); t.status = input.status; }
  t.due = str(input.due, 'due', 10, { nullable: true });
  if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) throw new HttpError(400, 'due must be YYYY-MM-DD');
  t.project = str(input.project, 'project', 80, { nullable: true });
  t.group = str(input.group, 'group', 80, { nullable: true });
  // App builds from before the group field put the group id in `project`: move it where it belongs.
  if (t.group === undefined && t.project && taskGroups().some(g => g.id === t.project)) { t.group = t.project; t.project = null; }
  t.sort = num(input.sort, 'sort');
  if (input.source !== undefined) { if (!SOURCES.includes(input.source)) throw new HttpError(400, `source must be ${SOURCES.join('|')}`); t.source = input.source; }
  t.createdAt = num(input.createdAt, 'createdAt');
  t.updatedAt = num(input.updatedAt, 'updatedAt');
  t.completedAt = num(input.completedAt, 'completedAt');
  if (input.deleted !== undefined) { if (typeof input.deleted !== 'boolean') throw new HttpError(400, 'deleted must be boolean'); t.deleted = input.deleted; }
  for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
  return t;
}

function complete(t, now, defaultSource) {
  const done = !!t.done;
  return {
    id: t.id || randomUUID(), title: t.title, notes: t.notes || '', done, priority: t.priority || 'med', status: t.status ?? null,
    due: t.due ?? null, project: t.project ?? null, group: t.group, groupSent: t.group !== undefined, sort: t.sort ?? now, source: t.source || defaultSource,
    createdAt: t.createdAt ?? now, updatedAt: t.updatedAt ?? now, completedAt: done ? (t.completedAt ?? now) : null, deleted: !!t.deleted
  };
}

const bumpRev = () => { db.run("UPDATE meta SET value = value + 1 WHERE key = 'rev'"); return db.get("SELECT value FROM meta WHERE key = 'rev'").value; };

function upsert(t, rev) {
  // status and group: old app versions don't send them, so a missing one keeps what is stored
  db.run(`INSERT INTO todos (id, title, notes, done, priority, status, due, project, task_group, sort, source, created_at, updated_at, completed_at, deleted, rev)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, notes = excluded.notes, done = excluded.done, priority = excluded.priority,
       status = COALESCE(excluded.status, todos.status),
       due = excluded.due, project = excluded.project, sort = excluded.sort,
       task_group = CASE WHEN ? THEN excluded.task_group ELSE todos.task_group END,
       updated_at = excluded.updated_at, completed_at = excluded.completed_at, deleted = excluded.deleted, rev = excluded.rev
     WHERE excluded.updated_at > todos.updated_at`,
    t.id, t.title, t.notes, t.done, t.priority, t.status, t.due, t.project, t.group ?? null, t.sort, t.source, t.createdAt, t.updatedAt, t.completedAt, t.deleted, rev, t.groupSent === false ? 0 : 1);
}

export function getTodo(id) { const r = db.get('SELECT * FROM todos WHERE id = ?', id); return r ? rowToTodo(r) : null; }
export function listOpenTodos() { return db.all('SELECT * FROM todos WHERE deleted = 0 AND done = 0 ORDER BY sort').map(rowToTodo); }

/* Used by the agent and phone flows. */
export function createTodo(input, source = 'agent') {
  const t = complete(validate({ ...input, source }), Date.now(), source);
  db.tx(() => upsert(t, bumpRev()));
  return getTodo(t.id);
}
export function patchTodo(id, patch) {
  const existing = getTodo(id);
  if (!existing || existing.deleted) throw new HttpError(404, 'Todo not found');
  const p = validate(patch, { partial: true });
  delete p.id; delete p.createdAt; delete p.source;
  const now = Date.now();
  const merged = { ...existing, ...p, updatedAt: Math.max(now, existing.updatedAt + 1) };
  if (p.done === true && !existing.done) merged.completedAt = p.completedAt ?? now;
  if (p.done === false) merged.completedAt = null;
  db.tx(() => upsert(merged, bumpRev()));
  return getTodo(id);
}

export const todos = new Hono();

todos.get('/todos', c => {
  const since = Number(c.req.query('since') || 0);
  const all = c.req.query('all') === '1';
  let sql = 'SELECT * FROM todos WHERE rev > ?';
  if (!all && !since) sql += ' AND deleted = 0';
  return c.json({ todos: db.all(sql + ' ORDER BY done, sort, created_at', since).map(rowToTodo) });
});

todos.post('/todos', async c => {
  const b = await body(c);
  const batch = Array.isArray(b?.todos);
  const items = batch ? b.todos : [b];
  if (!items.length) throw new HttpError(400, 'No todos given');
  if (items.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} todos per request`);
  const now = Date.now();
  const list = items.map(it => complete(validate(it), now, 'api'));
  db.tx(() => { const rev = bumpRev(); list.forEach(t => upsert(t, rev)); });
  const saved = list.map(t => getTodo(t.id));
  return c.json(batch ? { todos: saved } : saved[0], 201);
});

todos.get('/todos/:id', c => {
  const t = getTodo(c.req.param('id'));
  if (!t || t.deleted) throw new HttpError(404, 'Todo not found');
  return c.json(t);
});
todos.patch('/todos/:id', async c => c.json(patchTodo(c.req.param('id'), await body(c))));
// the same for clients without PATCH (Android's HttpURLConnection: the tasks widget ticks a todo off)
todos.post('/todos/:id', async c => c.json(patchTodo(c.req.param('id'), await body(c))));
todos.delete('/todos/:id', c => {
  const existing = getTodo(c.req.param('id'));
  if (!existing || existing.deleted) throw new HttpError(404, 'Todo not found');
  db.tx(() => upsert({ ...existing, deleted: true, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) }, bumpRev()));
  return c.json({ ok: true, id: existing.id });
});

/* App sync: upload local changes, return everything since `since` (incl. tombstones). */
todos.post('/sync', async c => {
  const b = await body(c);
  const since = Number(b?.since || 0);
  const ups = Array.isArray(b?.upserts) ? b.upserts : [];
  if (ups.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} changes per sync`);
  const now = Date.now();
  // one bad todo must not block the whole sync (and every other device's notes behind it): skip it and say so
  const list = [], rejected = [];
  for (const it of ups) {
    try { const v = validate(it); if (!v.id) throw new HttpError(400, 'Sync items need an id'); list.push(complete(v, now, 'app')); }
    catch (e) { if (!(e instanceof HttpError)) throw e; rejected.push({ id: it && it.id, error: e.message }); }
  }
  if (rejected.length) console.warn('sync: skipped', rejected.length, 'todo(s):', JSON.stringify(rejected).slice(0, 500));
  if (list.length) db.tx(() => { const rev = bumpRev(); list.forEach(t => upsert(t, rev)); });
  const rows = db.all('SELECT * FROM todos WHERE rev > ? ORDER BY rev', since);
  const cursor = rows.reduce((m, r) => Math.max(m, r.rev), since);
  return c.json({ todos: rows.map(rowToTodo), cursor, rejected });
});
