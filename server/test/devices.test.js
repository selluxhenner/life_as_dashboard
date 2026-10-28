// Devices on the Hub: one row per phone, browsers temporary, the duplicate cleanup migration. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-devices-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-devices-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, db, dbm;
before(async () => {
  dbm = await import('../src/db.js');
  dbm.migrate(); db = dbm.db;
  ({ app } = await import('../src/app.js'));
});

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}
const pair = b => api('POST', '/api/devices/pair', b).then(r => r.body);
const live = () => db.all('SELECT * FROM devices WHERE revoked = 0');

test('pairing the phone again reuses its row; the old token stops working', async () => {
  const first = await pair({ name: 'Phone (Android)', platform: 'android' });
  db.run('UPDATE devices SET push_token = ? WHERE id = ?', 'old-push', first.id);
  const again = await pair({ name: 'Phone (Android)', platform: 'android' });
  assert.equal(again.id, first.id);
  assert.equal(live().filter(d => d.platform === 'android').length, 1);
  assert.equal(db.get('SELECT push_token FROM devices WHERE id = ?', first.id).push_token, null);
  assert.equal((await api('GET', '/api/hub/state', undefined, first.token)).status, 401);
  assert.equal((await api('GET', '/api/hub/state', undefined, again.token)).status, 200);
});

test('desktops and ops tokens still get a row each', async () => {
  const a = await pair({ name: 'Desktop (Windows)', platform: 'desktop' });
  const b = await pair({ name: 'Desktop (Windows)', platform: 'desktop' });
  assert.notEqual(a.id, b.id);
  db.run('UPDATE devices SET revoked = 1 WHERE platform = ?', 'desktop');
});

test('browsers are temporary on the Hub and revoked after two weeks idle', async () => {
  const phone = await pair({ name: 'Phone (Android)', platform: 'android' });
  const fresh = await pair({ name: 'Browser · Windows', platform: 'web' });
  const stale = await pair({ name: 'Browser · Windows', platform: 'web' });
  db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', Date.now() - 19 * 86400000, stale.id);
  const s = (await api('GET', '/api/hub/state', undefined, phone.token)).body;
  const browsers = s.devices.filter(d => d.platform === 'web');
  assert.equal(browsers.length, 1);                       // the stale one is gone
  assert.ok(browsers.every(d => d.temporary));
  assert.ok(s.devices.filter(d => d.platform !== 'web').every(d => !d.temporary));
  assert.equal(db.get('SELECT revoked FROM devices WHERE id = ?', stale.id).revoked, 1);
  assert.equal((await api('GET', '/api/hub/state', undefined, stale.token)).status, 401);
  assert.equal((await api('GET', '/api/hub/state', undefined, fresh.token)).status, 200);
});

test('the cleanup migration keeps the newest phone and names the build token Laptop', () => {
  db.run('DELETE FROM devices');
  const day = 86400000, now = Date.now();
  const row = (id, name, platform, seen, scope = 'full') => db.run(
    'INSERT INTO devices (id, name, platform, token_hash, scope, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, name, platform, 'hash-' + id, scope, now - 30 * day, seen == null ? null : now - seen);
  row('p1', 'Phone (Android)', 'android', 9 * 60000);
  row('p2', 'Phone (Android)', 'android', 3 * day);
  row('p3', 'Phone (Android)', 'android', 7 * day);
  row('p4', 'Phone (Android)', 'android', 9 * day);
  row('p5', 'Phone (Android)', 'android', null);
  row('b1', 'My builds', 'build', 60000);
  row('s1', 'main-server', 'linux', 10 * 60000, 'ops');
  row('s2', 'approval-relay', 'linux', 10 * 60000, 'ops');
  row('s3', 'agent-box', 'linux', 9 * 3600000, 'ops');
  db.run('INSERT INTO notes (id, title, body, created_at) VALUES (?, ?, ?, ?)', 'n1', 'Keep', 'not a device', now);

  db.run('DELETE FROM schema_migrations WHERE name = ?', '0014_device_cleanup.sql');
  assert.deepEqual(dbm.migrate(), ['0014_device_cleanup.sql']);

  assert.deepEqual(live().map(d => d.id).sort(), ['b1', 'p1', 's1', 's2', 's3']);
  assert.equal(db.all('SELECT id FROM devices').length, 9);   // revoked, not deleted
  const laptop = db.get('SELECT name, platform FROM devices WHERE id = ?', 'b1');
  assert.deepEqual({ ...laptop }, { name: 'Laptop', platform: 'laptop' });
  assert.equal(db.get('SELECT body FROM notes WHERE id = ?', 'n1').body, 'not a device');
});
