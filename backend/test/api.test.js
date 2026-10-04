// Integrationstests gegen einen laufenden Worker: erst `npm run dev`, dann `npm test`.
// LIFEOS_API / LIFEOS_TOKEN überschreiben Ziel und Token (Standard: localhost + .dev.vars).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.LIFEOS_API || 'http://127.0.0.1:8787';
const TOKEN = process.env.LIFEOS_TOKEN
  || readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/API_TOKEN=(.+)/)[1].trim();

async function api(method, path, body, token = TOKEN) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

const uniq = () => 'test-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

test('health braucht keine Auth, alles andere schon', async () => {
  assert.equal((await api('GET', '/api/health', undefined, null)).status, 200);
  assert.equal((await api('GET', '/api/todos', undefined, null)).status, 401);
  assert.equal((await api('GET', '/api/todos', undefined, 'falsch')).status, 401);
});

test('CORS-Preflight', async () => {
  const res = await fetch(BASE + '/api/todos', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('CRUD: anlegen, lesen, ändern, erledigen, löschen', async () => {
  const created = await api('POST', '/api/todos', { title: '  Steuererklärung  ', priority: 'high', due: '2026-10-01', project: 'admin' });
  assert.equal(created.status, 201);
  const t = created.body;
  assert.equal(t.title, 'Steuererklärung');
  assert.equal(t.source, 'api');
  assert.equal(t.done, false);

  const patched = await api('PATCH', '/api/todos/' + t.id, { done: true, notes: 'Belege im Ordner' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.done, true);
  assert.ok(patched.body.completedAt);
  assert.ok(patched.body.updatedAt > t.updatedAt);

  const reopened = await api('PATCH', '/api/todos/' + t.id, { done: false });
  assert.equal(reopened.body.completedAt, null);

  assert.equal((await api('DELETE', '/api/todos/' + t.id)).status, 200);
  assert.equal((await api('GET', '/api/todos/' + t.id)).status, 404);
  const list = await api('GET', '/api/todos');
  assert.ok(!list.body.todos.some((x) => x.id === t.id), 'gelöschte To-dos tauchen in der Liste nicht auf');
});

test('Batch-Import', async () => {
  const res = await api('POST', '/api/todos', { todos: [{ title: 'A', source: 'claude' }, { title: 'B', priority: 'low' }] });
  assert.equal(res.status, 201);
  assert.equal(res.body.todos.length, 2);
  assert.equal(res.body.todos[0].source, 'claude');
});

test('Validierung', async () => {
  assert.equal((await api('POST', '/api/todos', { title: '' })).status, 400);
  assert.equal((await api('POST', '/api/todos', { title: 'x', priority: 'urgent' })).status, 400);
  assert.equal((await api('POST', '/api/todos', { title: 'x', due: '1.10.2026' })).status, 400);
  assert.equal((await api('POST', '/api/todos', { title: 'x', id: 'bad id!' })).status, 400);
  assert.equal((await api('PATCH', '/api/todos/gibtsnicht', { title: 'x' })).status, 404);
});

test('Sync: Upload, inkrementeller Pull, Tombstones', async () => {
  const start = await api('POST', '/api/sync', { since: 0 });
  const cursor0 = start.body.cursor;

  const id = uniq();
  const now = Date.now();
  const up = await api('POST', '/api/sync', {
    since: cursor0,
    upserts: [{ id, title: 'Vom Handy', priority: 'med', createdAt: now, updatedAt: now }]
  });
  assert.equal(up.status, 200);
  assert.ok(up.body.todos.some((x) => x.id === id && x.source === 'app'));
  assert.ok(up.body.cursor > cursor0);

  // Nichts Neues seit dem letzten Cursor
  const idle = await api('POST', '/api/sync', { since: up.body.cursor });
  assert.equal(idle.body.todos.length, 0);

  // Löschen über REST muss als Tombstone im nächsten Pull ankommen
  await api('DELETE', '/api/todos/' + id);
  const pulled = await api('POST', '/api/sync', { since: up.body.cursor });
  const tomb = pulled.body.todos.find((x) => x.id === id);
  assert.ok(tomb && tomb.deleted);
});

test('Sync: last write wins — ältere Änderung überschreibt neuere nicht', async () => {
  const id = uniq();
  const t0 = Date.now();
  await api('POST', '/api/sync', { since: 0, upserts: [{ id, title: 'neu', createdAt: t0, updatedAt: t0 + 1000 }] });
  const stale = await api('POST', '/api/sync', { since: 0, upserts: [{ id, title: 'alt', createdAt: t0, updatedAt: t0 }] });
  assert.equal(stale.body.todos.find((x) => x.id === id).title, 'neu');
  const got = await api('GET', '/api/todos/' + id);
  assert.equal(got.body.title, 'neu');
});

// Google Kalender: was ohne echte Google-Anmeldung prüfbar ist. Setzt voraus, dass lokal
// keine Verbindung gespeichert ist (gcal_auth leer).
test('Kalender: Auth, Status und Validierung', async () => {
  assert.equal((await api('GET', '/api/gcal/status', undefined, null)).status, 401);
  assert.equal((await api('POST', '/api/gcal/push', {}, 'falsch')).status, 401);

  const st = await api('GET', '/api/gcal/status');
  assert.equal(st.status, 200);
  assert.equal(typeof st.body.configured, 'boolean');
  assert.equal(st.body.connected, false);

  const conn = await api('POST', '/api/gcal/connect', {});
  if (st.body.configured) {
    const u = new URL(conn.body.url);
    assert.equal(u.host, 'accounts.google.com');
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.equal(u.searchParams.get('redirect_uri'), BASE + '/api/gcal/callback');
    assert.equal(u.searchParams.get('state').split('.').length, 3);
  } else {
    assert.equal(conn.status, 503);
  }

  assert.equal((await api('GET', '/api/gcal/events?from=2026-10-05')).status, 400);
  assert.equal((await api('GET', '/api/gcal/events?from=2026-10-05&to=2026-10-01')).status, 400);
  assert.equal((await api('GET', '/api/gcal/events?from=2026-01-01&to=2026-12-31')).status, 400);
  const ev = await api('GET', '/api/gcal/events?from=2026-10-05&to=2026-10-12');
  assert.deepEqual(ev.body, { connected: false, events: [] });

  const bad = await api('POST', '/api/gcal/push', { upserts: [{ key: 'plan:x', title: 'A', date: '2026-10-05', time: '9:00' }] });
  assert.equal(bad.status, 400);
  const badEnd = await api('POST', '/api/gcal/push', { upserts: [{ key: 'plan:x', title: 'A', date: '2026-10-05', time: '09:00', endTime: '08:00' }] });
  assert.equal(badEnd.status, 400);
  const tooMany = Array.from({ length: 21 }, (_, i) => 'todo:' + i);
  assert.equal((await api('POST', '/api/gcal/push', { deletes: tooMany })).status, 400);
  const ok = await api('POST', '/api/gcal/push', { timeZone: 'Europe/Zurich', upserts: [{ key: 'plan:2026-10-05:a', title: 'Deep Work', date: '2026-10-05', time: '09:00', endTime: '10:30' }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.connected, false);
});

test('Kalender: Callback ohne gültigen state wird abgelehnt', async () => {
  const res = await fetch(BASE + '/api/gcal/callback?code=x&state=1.2.falsch');
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const stale = await fetch(BASE + '/api/gcal/callback?code=x');
  assert.equal(stale.status, 400);
  const denied = await fetch(BASE + '/api/gcal/callback?error=access_denied');
  assert.equal(denied.status, 200);
  assert.match(await denied.text(), /ABGEBROCHEN/);
});
