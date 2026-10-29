// Approvals between the agent box and the apps, and the Hub state. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-apr-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-apr-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, db, hermes, runner, phone;
before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate(); db = dbm.db;
  ({ app } = await import('../src/app.js'));
  hermes = (await api('POST', '/api/devices/pair', { name: 'agent-box', platform: 'linux', scope: 'ops' })).body.token;
  runner = (await api('POST', '/api/devices/pair', { name: 'main-server', platform: 'linux', scope: 'ops' })).body.token;
  phone = (await api('POST', '/api/devices/pair', { name: 'Phone', platform: 'android' })).body.token;
});

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json };
}

const ask = (over = {}) => api('POST', '/api/approvals', { verb: 'restart-container', args: ['umami'], reason: 'umami is down since 03:10', ...over }, hermes);

test('hermes asks, the phone approves, the server script consumes once', async () => {
  const created = await ask();
  assert.equal(created.status, 201);
  const { id } = created.body;
  assert.match(id, /^apr_[A-Za-z0-9_-]{20,}$/);
  assert.equal(created.body.status, 'pending');

  const seen = await api('GET', '/api/approvals/' + id, undefined, runner);
  assert.equal(seen.status, 200);
  assert.deepEqual([seen.body.verb, seen.body.args], ['restart-container', ['umami']]);

  assert.equal((await api('POST', `/api/approvals/${id}/consume`, {}, runner)).status, 409, 'not approved yet');
  const ok = await api('POST', `/api/approvals/${id}/approve`, {}, phone);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'approved');
  assert.equal((await api('POST', `/api/approvals/${id}/reject`, {}, phone)).status, 409, 'a decision does not flip');

  assert.equal((await api('POST', `/api/approvals/${id}/consume`, {}, runner)).body.status, 'used');
  assert.equal((await api('POST', `/api/approvals/${id}/consume`, {}, runner)).status, 409, 'one yes, one run');
});

test('a new approval raises an agent notification', async () => {
  const { id } = (await ask({ verb: 'pm2-restart', args: ['housing-finder'] })).body;
  const n = db.get('SELECT title, kind, url FROM notifications WHERE ref = ?', 'approval:' + id);
  assert.equal(n.kind, 'agent');
  assert.equal(n.url, '#/hub');
  assert.match(n.title, /pm2-restart housing-finder/);
});

test('scopes: only ops asks and consumes, only apps decide and list', async () => {
  assert.equal((await api('POST', '/api/approvals', { verb: 'x', reason: 'y' }, phone)).status, 403);
  const { id } = (await ask()).body;
  assert.equal((await api('POST', `/api/approvals/${id}/approve`, {}, hermes)).status, 403, 'the agent cannot approve itself');
  assert.equal((await api('GET', '/api/approvals', undefined, hermes)).status, 403);
  assert.equal((await api('GET', '/api/approvals', undefined, phone)).status, 200);
  assert.equal((await api('GET', '/api/approvals/' + id, undefined, null)).status, 401);
  assert.equal((await api('GET', '/api/hub/state', undefined, null)).status, 401);
});

test('hub state for an ops token: read-only summary without device or approval ids', async () => {
  const { id } = (await ask({ verb: 'deploy', args: ['agentic-os'] })).body;
  const s = await api('GET', '/api/hub/state', undefined, hermes);
  assert.equal(s.status, 200);
  assert.ok(s.body.devices.length >= 3);
  assert.ok(s.body.devices.every(d => !('id' in d)), 'no device ids');
  assert.ok(s.body.devices.some(d => d.name === 'agent-box' && d.current));
  const mine = s.body.approvals.find(a => a.verb === 'deploy' && a.args[0] === 'agentic-os');
  assert.ok(mine && mine.status === 'pending');
  assert.ok(s.body.approvals.every(a => !('id' in a) && !('decidedBy' in a)), 'no approval ids');
  assert.ok(!JSON.stringify(s.body).includes(id));
  assert.ok(Array.isArray(s.body.ops));
  assert.equal((await api('GET', '/api/todos', undefined, hermes)).status, 403, 'other routes stay closed to ops');
});

test('rejected and expired approvals cannot be consumed', async () => {
  const a = (await ask()).body.id;
  await api('POST', `/api/approvals/${a}/reject`, {}, phone);
  assert.equal((await api('POST', `/api/approvals/${a}/consume`, {}, runner)).status, 409);

  const b = (await ask()).body.id;
  await api('POST', `/api/approvals/${b}/approve`, {}, phone);
  db.run('UPDATE approvals SET expires_at = ? WHERE id = ?', Date.now() - 1000, b);
  assert.equal((await api('GET', '/api/approvals/' + b, undefined, runner)).body.status, 'expired');
  assert.equal((await api('POST', `/api/approvals/${b}/consume`, {}, runner)).status, 409);

  const c = (await ask()).body.id;
  db.run('UPDATE approvals SET expires_at = ? WHERE id = ?', Date.now() - 1000, c);
  assert.equal((await api('POST', `/api/approvals/${c}/approve`, {}, phone)).status, 409, 'too late to approve');
});

test('verbs and args are validated so nothing shell-like reaches the server script', async () => {
  for (const bad of [{ verb: 'Restart!' }, { args: ['umami; rm -rf /'] }, { args: ['a b'] }, { args: Array(7).fill('x') }, { reason: '' }, { ttlMinutes: 5000 }]) {
    assert.equal((await ask(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await api('GET', '/api/approvals/apr_nope', undefined, runner)).status, 404);
});

test('hub state lists devices, open approvals and ops', async () => {
  await api('POST', '/api/ops/report', { job: 'site-check', status: 'warn', summary: '🟡 1 site slow' }, hermes);
  const s = await api('GET', '/api/hub/state', undefined, phone);
  assert.equal(s.status, 200);
  const me = s.body.devices.find(d => d.current);
  assert.equal(me.name, 'Phone');
  assert.equal(me.online, true);
  assert.ok(s.body.devices.some(d => d.name === 'agent-box' && d.scope === 'ops'));
  assert.ok(s.body.approvals.length >= 1 && s.body.approvals.every(a => a.status === 'pending'));
  assert.equal(s.body.ops[0].job, 'site-check');
  // the agent box reports, so it is expected online; the main server's script token only acts on demand
  const by = Object.fromEntries(s.body.devices.map(d => [d.name, d]));
  assert.equal(by['agent-box'].onCall, false);
  assert.equal(by['main-server'].onCall, true);
  assert.equal(by.Phone.onCall, false);
});
