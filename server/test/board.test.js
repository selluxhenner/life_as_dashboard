// Plan board: the todo status column and the Workbench sessions feed. Run: npm test (inside server/)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-board-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-board-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, config, resetWorkbenchCache, ops, wb, wbHits = 0, wbDown = false;
before(async () => {
  // a stand-in for Workbench's agent feed
  wb = createServer((req, res) => {
    wbHits++;
    if (wbDown) { res.writeHead(503).end(); return; }
    if (req.headers.authorization !== 'Bearer wbk_test') { res.writeHead(401).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, data: { sessions: [
      { id: 's1', title: 'Plan board', project: 'life_as_dashboard', agent: 'claude', branch: 'feat/board', status: 'running', lastActivityAt: 1, dirtyFiles: 3, ahead: 1, unpushed: true, prompt: 'secret' }
    ] } }));
  });
  await new Promise(r => wb.listen(0, '127.0.0.1', r));
  const dbm = await import('../src/db.js');
  dbm.migrate();
  ({ app } = await import('../src/app.js'));
  ({ config } = await import('../src/config.js'));
  ({ resetWorkbenchCache } = await import('../src/routes/workbench.js'));
  ops = (await api('POST', '/api/devices/pair', { name: 'agent-box', platform: 'linux', scope: 'ops' })).body.token;
});
after(() => wb.close());

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json };
}

test('a todo keeps its board column through sync, and old clients do not wipe it', async () => {
  const t0 = Date.now();
  let r = await api('POST', '/api/sync', { since: 0, upserts: [{ id: 'b1', title: 'Board card', status: 'doing', project: 'life-os', updatedAt: t0, createdAt: t0 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.todos.find(t => t.id === 'b1').status, 'doing');
  // an app version without the board edits the title and sends no status
  r = await api('POST', '/api/sync', { since: 0, upserts: [{ id: 'b1', title: 'Board card, renamed', project: 'life-os', updatedAt: t0 + 5, createdAt: t0 }] });
  const t = r.body.todos.find(x => x.id === 'b1');
  assert.equal(t.title, 'Board card, renamed');
  assert.equal(t.status, 'doing');
});

test('status is validated and a todo without one reads as null', async () => {
  const bad = await api('POST', '/api/todos', { title: 'x', status: 'someday' });
  assert.equal(bad.status, 400);
  const plain = await api('POST', '/api/todos', { title: 'plain' });
  assert.equal(plain.status, 201);
  assert.equal(plain.body.status, null);
  const moved = await api('PATCH', '/api/todos/' + plain.body.id, { status: 'backlog' });
  assert.equal(moved.body.status, 'backlog');
});

test('workbench sessions: not configured, then read through the feed without secrets', async () => {
  resetWorkbenchCache();
  let r = await api('GET', '/api/workbench/sessions');
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.deepEqual(r.body.sessions, []);

  config.workbench.url = 'http://127.0.0.1:' + wb.address().port;
  config.workbench.token = 'wbk_test';
  resetWorkbenchCache();
  r = await api('GET', '/api/workbench/sessions');
  assert.equal(r.body.reachable, true);
  assert.equal(r.body.sessions.length, 1);
  assert.equal(r.body.sessions[0].project, 'life_as_dashboard');
  assert.equal(r.body.sessions[0].prompt, undefined);

  // cached for 30 s, then a failing Workbench keeps the last list, marked unreachable
  const hits = wbHits;
  await api('GET', '/api/workbench/sessions');
  assert.equal(wbHits, hits);
  const { workbenchSessions } = await import('../src/routes/workbench.js');
  wbDown = true;
  const stale = await workbenchSessions(Date.now() + 60000);
  assert.equal(stale.reachable, false);
  assert.equal(stale.sessions.length, 1);
});

test('the ops token (agent box) cannot read the board feed', async () => {
  const r = await api('GET', '/api/workbench/sessions', undefined, ops);
  assert.equal(r.status, 403);
});
