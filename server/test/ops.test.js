// Ops reports from the agent box: scoped token, validation, alerts, briefing context. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-ops-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-ops-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, db, opsToken, appToken;
before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate(); db = dbm.db;
  ({ app } = await import('../src/app.js'));
  opsToken = (await api('POST', '/api/devices/pair', { name: 'agent-box', platform: 'linux', scope: 'ops' })).body.token;
  appToken = (await api('POST', '/api/devices/pair', { name: 'Phone', platform: 'android' })).body.token;
});

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json };
}

const report = (over = {}) => ({
  job: 'morning-digest', status: 'fail', summary: '🔴 2 problems',
  findings: [{ level: 'fail', text: 'djhappytunes.com: certificate does not cover the hostname' }, { level: 'warn', text: 'Disk / at 81 %' }],
  metrics: { disk_pct: 81, ram_avail_mb: 2459, 'pm2.housing-finder.restarts': 2 }, ...over
});

test('an ops token can post reports and nothing else', async () => {
  assert.equal((await api('POST', '/api/ops/report', report(), opsToken)).status, 201);
  for (const [m, p] of [['GET', '/api/todos'], ['GET', '/api/inbox/email'], ['GET', '/api/ops/latest'], ['GET', '/api/settings'], ['DELETE', '/api/devices/x'], ['POST', '/api/devices/pair']]) {
    assert.equal((await api(m, p, m === 'POST' ? {} : undefined, opsToken)).status, 403, `${m} ${p} must refuse the ops token`);
  }
});

test('app tokens cannot post reports; posting needs a token at all', async () => {
  assert.equal((await api('POST', '/api/ops/report', report(), appToken)).status, 403);
  assert.equal((await api('POST', '/api/ops/report', report(), null)).status, 401);
  assert.equal((await api('POST', '/api/ops/report', report(), 'wrong')).status, 401);
});

test('pairing rejects unknown scopes and lists the scope', async () => {
  assert.equal((await api('POST', '/api/devices/pair', { name: 'x', scope: 'admin' })).status, 400);
  const devices = (await api('GET', '/api/devices')).body.devices;
  assert.equal(devices.find(d => d.name === 'agent-box').scope, 'ops');
  assert.equal(devices.find(d => d.name === 'Phone').scope, 'full');
});

test('reports are validated and size-limited', async () => {
  const bad = [
    report({ status: 'broken' }),
    report({ job: 'Morning Digest!' }),
    report({ summary: '' }),
    report({ findings: [{ level: 'fail', text: 'x'.repeat(301) }] }),
    report({ metrics: { 'BAD KEY': 1 } }),
    report({ metrics: { nested: { a: 1 } } })
  ];
  for (const b of bad) assert.equal((await api('POST', '/api/ops/report', b, opsToken)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await api('POST', '/api/ops/report', '{not json', opsToken)).status, 400);
  assert.equal((await api('POST', '/api/ops/report', report({ summary: 'x'.repeat(40000) }), opsToken)).status, 413);
});

test('the apps read the newest report per job, worst first, with history', async () => {
  await api('POST', '/api/ops/report', report({ job: 'site-check', status: 'ok', summary: '🟢 Sites OK', findings: [] }), opsToken);
  const latest = (await api('GET', '/api/ops/latest', undefined, appToken)).body.reports;
  assert.deepEqual(latest.map(r => r.job), ['morning-digest', 'site-check']);
  assert.equal(latest[0].metrics.disk_pct, 81);
  assert.equal(latest[0].findings[0].level, 'fail');
  const hist = (await api('GET', '/api/ops/reports?job=morning-digest&limit=5', undefined, appToken)).body.reports;
  assert.ok(hist.length >= 1 && hist.every(r => r.job === 'morning-digest'));
});

test('a problem raises one ops notification per job, day and status', async () => {
  const count = () => db.get("SELECT COUNT(*) n FROM notifications WHERE kind = 'ops' AND ref LIKE 'ops:alert-test:%'").n;
  await api('POST', '/api/ops/report', report({ job: 'alert-test', status: 'warn', summary: '🟡 1 warning' }), opsToken);
  assert.equal(count(), 1);
  await api('POST', '/api/ops/report', report({ job: 'alert-test', status: 'warn', summary: '🟡 1 warning' }), opsToken);
  assert.equal(count(), 1, 'same status the same day stays quiet');
  await api('POST', '/api/ops/report', report({ job: 'alert-test', status: 'fail', summary: '🔴 1 problem' }), opsToken);
  assert.equal(count(), 2, 'a worse status alerts again');
  await api('POST', '/api/ops/report', report({ job: 'alert-test', status: 'ok', summary: '🟢 Server OK', findings: [] }), opsToken);
  assert.equal(count(), 2, 'ok never alerts');
  const n = db.get("SELECT title, body FROM notifications WHERE ref LIKE 'ops:alert-test:%:fail'");
  assert.equal(n.title, 'Server · 🔴 1 problem');
  assert.match(n.body, /djhappytunes/);
});

test('switching off ops alerts in settings silences them', async () => {
  await api('PATCH', '/api/settings', { alerts: { ops: false } });
  await api('POST', '/api/ops/report', report({ job: 'muted-test' }), opsToken);
  assert.equal(db.get("SELECT COUNT(*) n FROM notifications WHERE ref LIKE 'ops:muted-test:%'").n, 0);
  await api('PATCH', '/api/settings', { alerts: { ops: true } });
});

test('the briefing context carries recent problems only, as ids it can cite', async () => {
  const { gatherContext } = await import('../src/jobs/briefing.js');
  const ctx = gatherContext();
  assert.ok(ctx.ops.length >= 1);
  assert.ok(ctx.ops.every(o => o.status !== 'ok' && /^ops:\d+$/.test(o.id)));
  assert.ok(!ctx.ops.some(o => o.job === 'site-check'), 'ok reports are left out');
  // older than 26 h: not in the briefing
  db.run("UPDATE ops_reports SET created_at = ? WHERE job = 'morning-digest'", Date.now() - 30 * 3600000);
  assert.ok(!gatherContext().ops.some(o => o.job === 'morning-digest'));
});
