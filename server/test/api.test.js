// In-process API tests against a throwaway database. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-')), 'test.db');
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, migrate, seedFeeds;
before(async () => {
  ({ migrate } = await import('../src/db.js'));
  ({ seedFeeds } = await import('../src/lib/feeds.js'));
  migrate(); seedFeeds();
  ({ app } = await import('../src/app.js'));
});

async function api(method, path, body, token = 'test-master-token', headers = {}) {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

test('health is public, everything else needs a token', async () => {
  assert.equal((await api('GET', '/api/health', undefined, null)).status, 200);
  assert.equal((await api('GET', '/api/todos', undefined, null)).status, 401);
  assert.equal((await api('GET', '/api/todos', undefined, 'wrong')).status, 401);
});

test('CORS allows the Tauri and Capacitor origins only', async () => {
  const ok = await api('OPTIONS', '/api/todos', undefined, null, { Origin: 'http://tauri.localhost' });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://tauri.localhost');
  const bad = await api('OPTIONS', '/api/todos', undefined, null, { Origin: 'https://evil.example' });
  assert.equal(bad.status, 403);
});

test('device pairing issues a revocable token', async () => {
  const p = await api('POST', '/api/devices/pair', { name: 'Test phone', platform: 'android' });
  assert.equal(p.status, 201);
  assert.ok(p.body.token);
  assert.equal((await api('GET', '/api/todos', undefined, p.body.token)).status, 200);
  // a device token cannot pair further devices
  assert.equal((await api('POST', '/api/devices/pair', { name: 'x' }, p.body.token)).status, 403);
  await api('DELETE', '/api/devices/' + p.body.id);
  assert.equal((await api('GET', '/api/todos', undefined, p.body.token)).status, 401);
});

test('todo CRUD and sync with last-write-wins', async () => {
  const c = await api('POST', '/api/todos', { title: '  Apply at N26  ', priority: 'high', due: '2026-10-10' });
  assert.equal(c.status, 201);
  assert.equal(c.body.title, 'Apply at N26');
  const id = c.body.id;
  const p = await api('PATCH', '/api/todos/' + id, { done: true });
  assert.equal(p.body.done, true);
  assert.ok(p.body.completedAt);
  const s1 = await api('POST', '/api/sync', { since: 0, upserts: [] });
  assert.ok(s1.body.todos.some(t => t.id === id));
  // older client write loses
  const stale = { ...p.body, title: 'old title', updatedAt: p.body.updatedAt - 1000 };
  await api('POST', '/api/sync', { since: s1.body.cursor, upserts: [stale] });
  assert.equal((await api('GET', '/api/todos/' + id)).body.title, 'Apply at N26');
  assert.equal((await api('DELETE', '/api/todos/' + id)).status, 200);
  assert.equal((await api('GET', '/api/todos/' + id)).status, 404);
  assert.equal((await api('POST', '/api/todos', { title: '' })).status, 400);
});

test('jobs sync round-trip', async () => {
  const job = { id: 'job_test1', company: 'Trade Republic', role: 'Werkstudent Frontend', type: 'werkstudent', status: 'applied', updatedAt: Date.now() };
  const r = await api('POST', '/api/jobs/sync', { since: 0, upserts: [job] });
  assert.ok(r.body.jobs.some(j => j.id === 'job_test1' && j.type === 'werkstudent'));
  const list = await api('GET', '/api/jobs');
  assert.equal(list.body.jobs.find(j => j.id === 'job_test1').company, 'Trade Republic');
});

test('settings merge with defaults and reject unknown keys', async () => {
  const s = await api('PATCH', '/api/settings', { briefing: { time: '07:45' } });
  assert.equal(s.body.settings.briefing.time, '07:45');
  assert.equal(s.body.settings.phone.monthlyCapEur, 10);
  assert.equal((await api('PATCH', '/api/settings', { nope: {} })).status, 400);
});

test('agent policy: outward tools are always queued, never run', async () => {
  const { policyFor } = await import('../src/agent/runner.js');
  assert.equal(policyFor('draft_email', ['read', 'internal', 'outward']), 'queue');
  assert.equal(policyFor('schedule_call', ['read', 'internal', 'outward']), 'queue');
  assert.equal(policyFor('draft_email', ['read', 'internal']), 'forbidden');   // background jobs
  assert.equal(policyFor('create_todo', ['read', 'internal']), 'run');
  assert.equal(policyFor('send_money', ['read']), 'unknown');
});

test('phone refuses to dial when switched off', async () => {
  const r = await api('POST', '/api/phone/call', { purpose: 'test' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /switched off/);
});

test('scheduled jobs run once per slot', async () => {
  const a = await api('POST', '/api/dev/run-job', { job: 'maintenance', slot: 'slot-x' });
  const b = await api('POST', '/api/dev/run-job', { job: 'maintenance', slot: 'slot-x' });
  assert.equal(a.body.ok, true);
  assert.equal(b.body.skipped, true);
});

test('calendar events endpoint validates dates and returns cached events', async () => {
  assert.equal((await api('GET', '/api/calendar/events?from=x&to=y')).status, 400);
  const r = await api('GET', '/api/calendar/events?from=2026-10-01&to=2026-10-31');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.events, []);
});

test('news wire groups one event per cluster with all its outlets', async () => {
  const { db } = await import('../src/db.js');
  const now = Date.now();
  const add = (id, source, sig, topic, ago) => db.run(`INSERT INTO news_items (id, feed_id, source, url, title, published_at, region, topic, significance, cluster, headline, scored, created_at)
    VALUES (?, 'bbc-world', ?, ?, ?, ?, 'europe', ?, ?, ?, ?, 1, ?)`, id, source, 'https://x.test/' + id, 'T ' + id, now - ago, topic, sig, topic === 'economy' ? 'ecb-rates' : id, 'H ' + id, now);
  add('w1', 'BBC', 7, 'economy', 60000);
  add('w2', 'DW', 8, 'economy', 120000);
  add('w3', 'AP', 4, 'politics', 30000);              // below the wire threshold
  add('w4', 'AP', 9, 'other', 30000);                 // sport etc. never shows
  const r = await api('GET', '/api/news/digest/latest');
  assert.equal(r.status, 200);
  assert.equal(r.body.digest, null);
  assert.equal(r.body.wire.length, 1);
  assert.equal(r.body.wire[0].headline, 'H w2');       // the most significant item leads the cluster
  assert.deepEqual(r.body.wire[0].sources.sort(), ['BBC', 'DW']);
});

test('usage reports a monthly cap', async () => {
  const r = await api('GET', '/api/usage');
  assert.equal(r.body.usage.aiCapUsd, 40);
});
