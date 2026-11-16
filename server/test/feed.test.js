// Lina's feed: apps and agents post updates, notifications land there too, Lina tells them once. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-feed-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-feed-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, db, TOOLS, notify, opsTok, phone;
before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate(); db = dbm.db;
  ({ app } = await import('../src/app.js'));
  ({ TOOLS } = await import('../src/agent/tools.js'));
  ({ notify } = await import('../src/notify/index.js'));
  opsTok = (await api('POST', '/api/devices/pair', { name: 'agent-box', platform: 'linux', scope: 'ops' })).body.token;
  phone = (await api('POST', '/api/devices/pair', { name: 'Phone', platform: 'android' })).body.token;
});

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('an app posts an update, the same ref updates it, bad input is refused', async () => {
  const a = await api('POST', '/api/lina/events', { source: 'housing', title: 'Viewing confirmed: Kreuzberg 2-room, Thu 18:00', ref: 'viewing-42' }, phone);
  assert.equal(a.status, 201);
  const b = await api('POST', '/api/lina/events', { source: 'housing', title: 'Viewing moved to Fri 17:00', ref: 'viewing-42', level: 'warn' }, phone);
  assert.equal(b.status, 200);
  assert.equal(b.body.id, a.body.id, 'same ref, same entry');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM lina_feed WHERE source = ?', 'housing').n, 1);
  assert.equal((await api('POST', '/api/lina/events', { source: 'Bad Source!', title: 'x' }, phone)).status, 400);
  assert.equal((await api('POST', '/api/lina/events', { source: 'bank' }, phone)).status, 400);
  assert.equal((await api('POST', '/api/lina/events', { source: 'bank', title: 'x' }, null)).status, 401);
});

test('Hermes (ops token) may post but not read the feed', async () => {
  assert.equal((await api('POST', '/api/lina/events', { source: 'hermes', title: 'Backups ok, disk 71 %' }, opsTok)).status, 201);
  assert.equal((await api('GET', '/api/lina/feed', undefined, opsTok)).status, 403);
});

test('notifications reach the feed; the deck sees them with a snapshot', async () => {
  await notify({ title: 'Hermes answered', body: 'Container pianobar restarted.', kind: 'agent', ref: 'hermes:ask_1' });
  const f = await api('GET', '/api/lina/feed', undefined, phone);
  assert.equal(f.status, 200);
  const hermes = f.body.events.find(e => e.title === 'Hermes answered');
  assert.equal(hermes.source, 'hermes');
  assert.ok(f.body.unread >= 3);
  const s = f.body.snapshot;
  assert.ok(s && 'hermes' in s && 'workbench' in s && 'vault' in s && 'todos' in s);
  assert.equal(s.workbench.configured, false);
});

test('get_updates tells each update once', async () => {
  const first = await TOOLS.get_updates.run({});
  assert.ok(Array.isArray(first) && first.some(e => e.from === 'housing' && /Fri 17:00/.test(e.title)));
  const again = await TOOLS.get_updates.run({});
  assert.equal(again.none, true);
  assert.equal((await api('GET', '/api/lina/feed?snapshot=0', undefined, phone)).body.unread, 0);
  const all = await TOOLS.get_updates.run({ all: true });
  assert.ok(all.length >= 3, 'all: the latest ones, told or not');
  const st = await TOOLS.status_report.run({});
  assert.equal(st.unread, 0);
});

test('alert-level app updates also push', async () => {
  const before = db.get('SELECT COUNT(*) AS n FROM notifications').n;
  await api('POST', '/api/lina/events', { source: 'banking', title: 'Rent payment failed', level: 'alert' }, phone);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM notifications').n, before + 1);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM lina_feed WHERE title = 'Rent payment failed'").n, 1, 'one feed entry, not two');
});

test('open_page and sort_captures hand their result to the app; unknown captures are refused', async () => {
  const { runDirect } = await import('../src/agent/runner.js');
  const { writeDoc } = await import('../src/routes/docs.js');
  writeDoc('capture:c1', { id: 'c1', text: 'Buy a bike lock', type: 'none', createdAt: 1, archived: false });
  writeDoc('capture:c2', { id: 'c2', text: 'Read 20 pages every day', type: 'none', createdAt: 2, archived: false });
  const list = await TOOLS.list_captures.run({});
  assert.deepEqual(list.map(c => c.id).sort(), ['c1', 'c2']);
  const r = await runDirect([{ name: 'open_page', input: { page: 'calendar' } }, { name: 'sort_captures', input: { items: [{ id: 'c1', type: 'task' }, { id: 'c2', type: 'habit' }, { id: 'nope', type: 'note' }] } }]);
  assert.deepEqual(r.ui.find(u => u.action === 'open_page').data, { page: 'calendar' });
  const sorted = r.ui.find(u => u.action === 'sort_captures').data;
  assert.deepEqual(sorted.items.map(i => [i.id, i.type]), [['c1', 'task'], ['c2', 'habit']]);
  assert.equal((await TOOLS.sort_captures.run({ items: [{ id: 'nope', type: 'note' }] })).error !== undefined, true);
});
