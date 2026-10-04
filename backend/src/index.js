/*
 * LIFE OS API — To-dos für Dashboard, Handy-Widget und Claude.
 *
 *   GET    /api/health                 ohne Auth
 *   GET    /api/todos?since=&all=       Liste (Standard: nur nicht gelöschte)
 *   POST   /api/todos                   ein To-do oder {todos:[...]} als Batch
 *   PATCH  /api/todos/:id               Felder ändern
 *   DELETE /api/todos/:id               Soft Delete (Tombstone)
 *   POST   /api/sync                    {since, upserts:[...]} -> {todos, cursor}
 *
 *   /api/gcal/...                     Google Kalender, siehe gcal.js
 *
 * Auth: Authorization: Bearer <API_TOKEN>. Konflikte: last write wins über updatedAt.
 */

import { CORS, HttpError, json, readBody } from './http.js';
import { gcalRoute } from './gcal.js';

const PRIORITIES = ['high', 'med', 'low'];
const SOURCES = ['app', 'widget', 'claude', 'api'];
const MAX_BATCH = 200;

/* Konstante Laufzeit, damit das Token nicht über Timing erraten werden kann. */
function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

function rowToTodo(r) {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    done: !!r.done,
    priority: r.priority,
    due: r.due,
    project: r.project,
    sort: r.sort,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    deleted: !!r.deleted
  };
}

function str(v, field, max, { required = false, nullable = false } = {}) {
  if (v === undefined) {
    if (required) throw new HttpError(400, `${field} fehlt`);
    return undefined;
  }
  if (v === null || v === '') {
    if (required) throw new HttpError(400, `${field} darf nicht leer sein`);
    return nullable ? null : '';
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} muss ein String sein`);
  const s = v.trim();
  if (required && !s) throw new HttpError(400, `${field} darf nicht leer sein`);
  if (s.length > max) throw new HttpError(400, `${field} ist zu lang (max ${max})`);
  return s;
}

function num(v, field) {
  if (v === undefined || v === null) return v;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${field} muss eine Zahl sein`);
  return v;
}

/* Prüft eingehende Felder; bei partial=true (PATCH) sind alle Felder optional. */
function validate(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'To-do muss ein Objekt sein');
  const t = {};
  if (input.id !== undefined) {
    t.id = str(input.id, 'id', 64, { required: true });
    if (!/^[\w-]+$/.test(t.id)) throw new HttpError(400, 'id enthält ungültige Zeichen');
  }
  t.title = str(input.title, 'title', 500, { required: !partial });
  t.notes = str(input.notes, 'notes', 5000);
  if (input.done !== undefined) {
    if (typeof input.done !== 'boolean') throw new HttpError(400, 'done muss true/false sein');
    t.done = input.done;
  }
  if (input.priority !== undefined) {
    if (!PRIORITIES.includes(input.priority)) throw new HttpError(400, `priority muss ${PRIORITIES.join('|')} sein`);
    t.priority = input.priority;
  }
  t.due = str(input.due, 'due', 10, { nullable: true });
  if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) throw new HttpError(400, 'due muss YYYY-MM-DD sein');
  t.project = str(input.project, 'project', 80, { nullable: true });
  t.sort = num(input.sort, 'sort');
  if (input.source !== undefined) {
    if (!SOURCES.includes(input.source)) throw new HttpError(400, `source muss ${SOURCES.join('|')} sein`);
    t.source = input.source;
  }
  t.createdAt = num(input.createdAt, 'createdAt');
  t.updatedAt = num(input.updatedAt, 'updatedAt');
  t.completedAt = num(input.completedAt, 'completedAt');
  if (input.deleted !== undefined) {
    if (typeof input.deleted !== 'boolean') throw new HttpError(400, 'deleted muss true/false sein');
    t.deleted = input.deleted;
  }
  for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
  return t;
}

/* Vollständiger Datensatz mit Defaults, für Inserts und Sync-Upserts. */
function complete(t, now, defaultSource) {
  const done = !!t.done;
  return {
    id: t.id || crypto.randomUUID(),
    title: t.title,
    notes: t.notes || '',
    done,
    priority: t.priority || 'med',
    due: t.due ?? null,
    project: t.project ?? null,
    sort: t.sort ?? now,
    source: t.source || defaultSource,
    createdAt: t.createdAt ?? now,
    updatedAt: t.updatedAt ?? now,
    completedAt: done ? (t.completedAt ?? now) : null,
    deleted: !!t.deleted
  };
}

const BUMP_REV = "UPDATE meta SET value = value + 1 WHERE key = 'rev'";
const CUR_REV = "(SELECT value FROM meta WHERE key = 'rev')";

/* Insert oder Update; ein bestehender Datensatz wird nur überschrieben, wenn der neue jünger ist. */
function upsertStmt(db, t) {
  return db.prepare(
    `INSERT INTO todos (id, title, notes, done, priority, due, project, sort, source, created_at, updated_at, completed_at, deleted, rev)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ${CUR_REV})
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, notes = excluded.notes, done = excluded.done, priority = excluded.priority,
       due = excluded.due, project = excluded.project, sort = excluded.sort,
       updated_at = excluded.updated_at, completed_at = excluded.completed_at,
       deleted = excluded.deleted, rev = excluded.rev
     WHERE excluded.updated_at > todos.updated_at`
  ).bind(
    t.id, t.title, t.notes, t.done ? 1 : 0, t.priority, t.due, t.project, t.sort, t.source,
    t.createdAt, t.updatedAt, t.completedAt, t.deleted ? 1 : 0
  );
}

async function getTodo(db, id) {
  const row = await db.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first();
  return row ? rowToTodo(row) : null;
}

async function listTodos(db, url) {
  const since = Number(url.searchParams.get('since') || 0);
  const all = url.searchParams.get('all') === '1';
  let sql = 'SELECT * FROM todos WHERE rev > ?';
  if (!all && !since) sql += ' AND deleted = 0';
  sql += ' ORDER BY done, sort, created_at';
  const { results } = await db.prepare(sql).bind(since).all();
  return json({ todos: results.map(rowToTodo) });
}

async function createTodos(db, request) {
  const body = await readBody(request);
  const batch = Array.isArray(body?.todos);
  const items = batch ? body.todos : [body];
  if (!items.length) throw new HttpError(400, 'Keine To-dos übergeben');
  if (items.length > MAX_BATCH) throw new HttpError(400, `Maximal ${MAX_BATCH} To-dos pro Anfrage`);
  const now = Date.now();
  const todos = items.map((it) => complete(validate(it), now, 'api'));
  await db.batch([db.prepare(BUMP_REV), ...todos.map((t) => upsertStmt(db, t))]);
  const saved = await Promise.all(todos.map((t) => getTodo(db, t.id)));
  return json(batch ? { todos: saved } : saved[0], 201);
}

async function updateTodo(db, id, request) {
  const existing = await getTodo(db, id);
  if (!existing || existing.deleted) throw new HttpError(404, 'To-do nicht gefunden');
  const patch = validate(await readBody(request), { partial: true });
  delete patch.id; delete patch.createdAt; delete patch.source;
  const now = Date.now();
  const merged = { ...existing, ...patch, updatedAt: Math.max(now, existing.updatedAt + 1) };
  if (patch.done === true && !existing.done) merged.completedAt = patch.completedAt ?? now;
  if (patch.done === false) merged.completedAt = null;
  await db.batch([db.prepare(BUMP_REV), upsertStmt(db, merged)]);
  return json(await getTodo(db, id));
}

async function deleteTodo(db, id) {
  const existing = await getTodo(db, id);
  if (!existing || existing.deleted) throw new HttpError(404, 'To-do nicht gefunden');
  const t = { ...existing, deleted: true, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
  await db.batch([db.prepare(BUMP_REV), upsertStmt(db, t)]);
  return json({ ok: true, id });
}

/* App-Sync: lokale Änderungen hochladen, dann alles seit `since` zurückgeben (inkl. Tombstones). */
async function sync(db, request) {
  const body = await readBody(request);
  const since = Number(body?.since || 0);
  const upserts = Array.isArray(body?.upserts) ? body.upserts : [];
  if (upserts.length > MAX_BATCH) throw new HttpError(400, `Maximal ${MAX_BATCH} Änderungen pro Sync`);
  const now = Date.now();
  const todos = upserts.map((it) => {
    const v = validate(it);
    if (!v.id) throw new HttpError(400, 'Sync-Einträge brauchen eine id');
    return complete(v, now, 'app');
  });
  if (todos.length) await db.batch([db.prepare(BUMP_REV), ...todos.map((t) => upsertStmt(db, t))]);

  const { results } = await db.prepare('SELECT * FROM todos WHERE rev > ? ORDER BY rev').bind(since).all();
  // Cursor aus den gelieferten Zeilen statt aus meta: so geht keine parallele Änderung verloren.
  const cursor = results.reduce((m, r) => Math.max(m, r.rev), since);
  return json({ todos: results.map(rowToTodo), cursor });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (path === '/api/health') return json({ ok: true });
  // OAuth-Rückkehr von Google: kommt ohne Bearer-Header, ist über den signierten state geschützt.
  if (path === '/api/gcal/callback' && method === 'GET') return gcalRoute(request, env, url, path);
  if (!path.startsWith('/api/')) throw new HttpError(404, 'Nicht gefunden');

  const auth = request.headers.get('Authorization') || '';
  if (!tokenMatches(auth.replace(/^Bearer\s+/i, ''), env.API_TOKEN)) throw new HttpError(401, 'Nicht autorisiert');

  if (path.startsWith('/api/gcal')) return gcalRoute(request, env, url, path);

  const db = env.DB;
  if (path === '/api/sync' && method === 'POST') return sync(db, request);
  if (path === '/api/todos') {
    if (method === 'GET') return listTodos(db, url);
    if (method === 'POST') return createTodos(db, request);
  }
  const m = path.match(/^\/api\/todos\/([\w-]{1,64})$/);
  if (m) {
    if (method === 'GET') {
      const t = await getTodo(db, m[1]);
      if (!t || t.deleted) throw new HttpError(404, 'To-do nicht gefunden');
      return json(t);
    }
    if (method === 'PATCH') return updateTodo(db, m[1], request);
    if (method === 'DELETE') return deleteTodo(db, m[1]);
  }
  throw new HttpError(405, 'Methode nicht erlaubt');
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Serverfehler' }, 500);
    }
  }
};
