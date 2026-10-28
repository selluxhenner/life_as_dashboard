// Lina → Hermes questions: queued by Lina's tool, fetched and answered by Hermes's ops token. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-herm-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-herm-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, db, TOOLS, hermesTok, phone;
before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate(); db = dbm.db;
  ({ app } = await import('../src/app.js'));
  ({ TOOLS } = await import('../src/agent/tools.js'));
  hermesTok = (await api('POST', '/api/devices/pair', { name: 'agent-box', platform: 'linux', scope: 'ops' })).body.token;
  phone = (await api('POST', '/api/devices/pair', { name: 'Phone', platform: 'android' })).body.token;
});

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('Lina asks, Hermes fetches and answers, Kevin gets a push and Lina reads it', async () => {
  const r = TOOLS.ask_hermes.run({ question: 'Why is ilge-pianobar.ch answering 502?' }, { trigger: 'voice' });
  assert.ok(r.queued && /^ask_/.test(r.id));
  assert.equal(TOOLS.ask_hermes.risk, 'internal', 'asking needs no approval; Hermes asks before changing anything');

  const open = await api('GET', '/api/hermes/asks?status=open', undefined, hermesTok);
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.asks.map(a => [a.id, a.source]), [[r.id, 'voice']]);
  assert.ok(db.get('SELECT picked_at FROM hermes_asks WHERE id = ?', r.id).picked_at, 'marked as picked');

  const ans = await api('POST', `/api/hermes/asks/${r.id}/answer`, { answer: 'Container pianobar is not Up since yesterday. Restart needs your approval.' }, hermesTok);
  assert.equal(ans.status, 200);
  assert.equal(ans.body.status, 'answered');
  assert.equal((await api('POST', `/api/hermes/asks/${r.id}/answer`, { answer: 'again' }, hermesTok)).status, 409);
  assert.equal((await api('GET', '/api/hermes/asks?status=open', undefined, hermesTok)).body.asks.length, 0);

  const n = db.get("SELECT title, url, kind FROM notifications WHERE ref = ?", 'hermes:' + r.id);
  assert.deepEqual([n.title, n.url, n.kind], ['Hermes answered', '#/hub', 'agent']);
  const read = TOOLS.hermes_answers.run({});
  assert.match(read[0].answer, /pianobar/);
});

test('scopes: only Hermes fetches open questions and answers; the apps only read', async () => {
  const id = TOOLS.ask_hermes.run({ question: 'Disk usage on the main server?' }, { trigger: 'chat' }).id;
  assert.equal((await api('GET', '/api/hermes/asks?status=open', undefined, phone)).status, 403);
  assert.equal((await api('POST', `/api/hermes/asks/${id}/answer`, { answer: 'x' }, phone)).status, 403);
  assert.equal((await api('GET', '/api/hermes/asks', undefined, hermesTok)).status, 403);
  assert.equal((await api('GET', '/api/hermes/asks', undefined, phone)).status, 200);
  assert.equal((await api('GET', '/api/hermes/asks', undefined, null)).status, 401);
  assert.equal((await api('POST', `/api/hermes/asks/${id}/answer`, { answer: '' }, hermesTok)).status, 400);
  assert.equal((await api('POST', '/api/hermes/asks/ask_nope/answer', { answer: 'x' }, hermesTok)).status, 404);
  assert.equal((await api('GET', '/api/todos', undefined, hermesTok)).status, 403, 'everything else stays closed to Hermes');
});
