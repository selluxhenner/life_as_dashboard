// Phone alerts: kinds, switches, the daily cap, breaking/AI detection, the glance summary and the optional FCM ping.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createVerify } from 'node:crypto';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-alerts-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-alerts-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, db, j, setSetting;
before(async () => {
  const dbm = await import('../src/db.js');
  ({ db, j } = dbm);
  dbm.migrate();
  (await import('../src/lib/feeds.js')).seedFeeds();
  ({ setSetting } = await import('../src/settings.js'));
  ({ app } = await import('../src/app.js'));
});
beforeEach(() => {
  db.run('DELETE FROM notifications');
  db.run("DELETE FROM settings WHERE key = 'alerts'");
});

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('notifications carry a kind and a ref; a switched-off kind is not raised', async () => {
  const { notify } = await import('../src/notify/index.js');
  const id = await notify({ title: 'Your morning briefing', body: 'School day.', url: '#/home', kind: 'briefing', ref: 'briefing:2026-10-06' });
  assert.ok(id > 0);
  await notify({ title: 'x', body: 'y', kind: 'nonsense' });
  const list = (await api('GET', '/api/notifications?since=0')).body.notifications;
  assert.deepEqual(list.map(n => [n.kind, n.ref]), [['briefing', 'briefing:2026-10-06'], ['general', null]]);
  setSetting('alerts', { briefing: false });
  assert.equal(await notify({ title: 'Your morning briefing', body: 'Again', kind: 'briefing' }), null);
  assert.equal((await api('GET', '/api/notifications?since=0')).body.notifications.length, 2);
});

test('breaking and AI alerts share a daily cap; other kinds are never capped', async () => {
  const { notify, newsAlertsToday } = await import('../src/notify/index.js');
  setSetting('alerts', { maxPerDay: 2 });
  assert.ok(await notify({ title: 'Breaking', body: 'a', kind: 'breaking' }));
  assert.ok(await notify({ title: 'OpenAI', body: 'b', kind: 'ai' }));
  assert.equal(await notify({ title: 'Breaking', body: 'c', kind: 'breaking' }), null);
  assert.ok(await notify({ title: '09:00 · Standup', body: 'd', kind: 'calendar' }));
  assert.equal(newsAlertsToday(), 2);
  // yesterday's alerts don't count
  db.run('UPDATE notifications SET created_at = created_at - 86400000 * 2');
  assert.equal(newsAlertsToday(), 0);
});

function addNews(id, { feed, sig, country = null, cluster, ago = 600000, headline = 'H ' + id }) {
  const now = Date.now();
  db.run(`INSERT INTO news_items (id, feed_id, source, url, title, published_at, region, country, topic, significance, cluster, headline, scored, created_at)
          VALUES (?, ?, 'Src', ?, ?, ?, 'europe', ?, 'politics', ?, ?, ?, 1, ?)`, id, feed, 'https://x.test/' + id, 'T ' + id, now - ago, country, sig, cluster, headline, now);
}

test('breaking: two outlets at the threshold, or one step below for the home country; once per cluster', async () => {
  const { detectBreaking } = await import('../src/jobs/news.js');
  addNews('b1', { feed: 'bbc-world', sig: 9, country: 'France', cluster: 'fr-gov-falls', headline: 'French government falls' });
  addNews('b2', { feed: 'dw', sig: 8, country: 'France', cluster: 'fr-gov-falls', headline: 'Zz lower headline' });
  addNews('g1', { feed: 'bbc-world', sig: 8, country: 'Germany', cluster: 'de-coalition', headline: 'German coalition collapses' });
  addNews('g2', { feed: 'dw', sig: 8, country: 'Germany', cluster: 'de-coalition', ago: 1800000 });   // older: the newest headline leads
  addNews('i1', { feed: 'bbc-world', sig: 8, country: 'Italy', cluster: 'it-budget' });        // 8 abroad: not breaking
  addNews('i2', { feed: 'dw', sig: 8, country: 'Italy', cluster: 'it-budget' });
  addNews('s1', { feed: 'bbc-world', sig: 10, country: 'Spain', cluster: 'es-solo' });        // one outlet only
  assert.equal(await detectBreaking(), 2);
  const list = (await api('GET', '/api/notifications?since=0')).body.notifications;
  assert.deepEqual(list.map(n => [n.title, n.body, n.kind, n.ref]).sort(), [
    ['Breaking · France', 'French government falls', 'breaking', 'news:fr-gov-falls'],
    ['Breaking · Germany', 'German coalition collapses', 'breaking', 'news:de-coalition']
  ]);
  assert.equal(await detectBreaking(), 0, 'a cluster pings once');
});

function addAi(id, { vendor, importance, kind = 'release', ago = 3600000, title = 'T ' + id }) {
  db.run(`INSERT INTO ai_updates (id, feed_id, vendor, title, url, published_at, kind, importance, summary, classified)
          VALUES (?, 'ai-openai', ?, ?, ?, ?, ?, ?, ?, 1)`, id, vendor, title, 'https://ai.test/' + id, Date.now() - ago, kind, importance, 'What changed: ' + id);
}

test('AI alerts: at or above the threshold, one per vendor per 12 h, old news never replayed', async () => {
  const { detectAiAlerts } = await import('../src/jobs/aimodels.js');
  addAi('a1', { vendor: 'openai', importance: 10, title: 'Introducing GPT-6' });
  addAi('a2', { vendor: 'openai', importance: 9, title: 'GPT-6 system card' });
  addAi('a3', { vendor: 'anthropic', importance: 9, title: 'Claude Code gets background agents' });
  addAi('a4', { vendor: 'google', importance: 7, title: 'Gemini in Sheets' });
  addAi('a5', { vendor: 'mistral', importance: 10, ago: 3 * 86400000, title: 'Old news' });
  assert.equal(await detectAiAlerts(), 2);
  const list = (await api('GET', '/api/notifications?since=0')).body.notifications;
  assert.deepEqual(list.map(n => [n.title, n.kind, n.ref, n.url]).sort(), [
    ['Anthropic: Claude Code gets background agents', 'ai', 'ai:anthropic', '#/ai'],
    ['OpenAI: Introducing GPT-6', 'ai', 'ai:openai', '#/ai']
  ]);
  assert.equal(db.get('SELECT COUNT(*) n FROM ai_updates WHERE alerted = 0').n, 1, 'only the 3-day-old item stays unmarked');
  // a later OpenAI post within 12 h does not ping again
  addAi('a6', { vendor: 'openai', importance: 10, title: 'GPT-6 now in the API' });
  assert.equal(await detectAiAlerts(), 0);
  // switched off: items are marked, nothing is raised, and switching on later doesn't replay them
  setSetting('alerts', { ai: false });
  addAi('a7', { vendor: 'xai', importance: 10, title: 'Grok 6' });
  assert.equal(await detectAiAlerts(), 0);
  setSetting('alerts', { ai: true });
  assert.equal(await detectAiAlerts(), 0);
});

test('glance: briefing, world and AI in short strings for the widget and the morning notification', async () => {
  const { localDate } = await import('../src/lib/time.js');
  let g = (await api('GET', '/api/glance')).body;
  assert.equal(g.briefing, null);
  assert.equal(g.briefingTime, '08:00');
  assert.equal(g.instant, false);
  const spoken = { greeting: 'Morning, Kevin!', overview: 'Busy morning, free afternoon.', topics: [{ label: 'First up', say: 'Lesson at 9:15.', tone: 'bright', refs: ['ev:1'] }] };
  db.run('INSERT OR REPLACE INTO briefings (date, created_at, model, headline, sections, focus, spoken) VALUES (?, ?, ?, ?, ?, ?, ?)',
    localDate(), Date.now(), 'test', 'School until noon, then the N26 interview.', '[]', j.str(['Prep N26', 'Gym']), j.str(spoken));
  db.run('INSERT OR REPLACE INTO news_digests (slot, created_at, regions, top, elections) VALUES (?, ?, ?, ?, ?)',
    'glance', Date.now(), '{}', j.str([{ headline: 'EU agrees gas price cap', country: 'Belgium', region: 'europe', brief: 'long' }]), '[]');
  g = (await api('GET', '/api/glance')).body;
  assert.equal(g.briefing.headline, 'School until noon, then the N26 interview.');
  assert.equal(g.briefing.overview, 'Busy morning, free afternoon.');
  assert.deepEqual(g.briefing.points, [{ label: 'First up', say: 'Lesson at 9:15.' }]);
  assert.deepEqual(g.briefing.focus, ['Prep N26', 'Gym']);
  assert.deepEqual(g.world.top, [{ headline: 'EU agrees gas price cap', country: 'Belgium', region: 'europe' }]);
  assert.ok(Array.isArray(g.ai.top));
});

test('push: a paired device registers its FCM token; FCM gets a content-free "check" ping', async () => {
  assert.equal((await api('POST', '/api/push/register', { token: 'fcm-1' })).status, 400, 'master token has no device row');
  const dev = (await api('POST', '/api/devices/pair', { name: 'Pixel', platform: 'android' })).body;
  const r = await api('POST', '/api/push/register', { token: 'fcm-1' }, dev.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.instant, false, 'no service account yet');
  assert.equal(db.get('SELECT push_token FROM devices WHERE id = ?', dev.id).push_token, 'fcm-1');

  const { setFcmCredentials } = await import('../src/notify/fcm.js');
  const { notify } = await import('../src/notify/index.js');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  setFcmCredentials({ project_id: 'agentic-test', client_email: 'push@agentic-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.test/token' });
  const realFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url) === 'https://oauth2.test/token') return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
    return calls.filter(c => c.url.includes('fcm.googleapis.com')).length === 1 ? Response.json({ name: 'm/1' }) : new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 });
  };
  try {
    const id = await notify({ title: 'Breaking', body: 'Secret headline', kind: 'breaking' });
    const [tok, send] = calls;
    // the JWT is signed with the service-account key
    const jwt = new URLSearchParams(tok.opts.body).get('assertion').split('.');
    assert.ok(createVerify('RSA-SHA256').update(jwt[0] + '.' + jwt[1]).verify(publicKey, jwt[2], 'base64url'));
    assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/agentic-test/messages:send');
    assert.equal(send.opts.headers.Authorization, 'Bearer ya29.test');
    const msg = JSON.parse(send.opts.body).message;
    assert.deepEqual(msg, { token: 'fcm-1', data: { type: 'check', id: String(id), kind: 'breaking' }, android: { priority: 'HIGH', ttl: '3600s' } });
    assert.ok(!send.opts.body.includes('Secret headline'), 'no content goes through Google');
    // FCM says the token is gone: it is dropped
    await notify({ title: 'Breaking', body: 'Second', kind: 'breaking' });
    assert.equal(db.get('SELECT push_token FROM devices WHERE id = ?', dev.id).push_token, null);
  } finally { globalThis.fetch = realFetch; setFcmCredentials(null); }
});

test('day plan: Fuxam titles shortened to the subject, rooms kept short', async () => {
  const { lessonTitle, roomOf } = await import('../src/jobs/glance.js');
  assert.deepEqual(lessonTitle('[LU] OS: Explore – Introduction to Software Engineering (OS_01) - Practice Session (Group 2) '),
    { tag: 'LU', title: 'Introduction to Software Engineering', detail: 'Practice Session · Group 2' });
  assert.deepEqual(lessonTitle('[Workshop] OS: Explore – Workshops (Track 1)'), { tag: 'Workshop', title: 'Workshops', detail: 'Track 1' });
  assert.deepEqual(lessonTitle('[LU] OS: STS Essentials - Group 1'), { tag: 'LU', title: 'STS Essentials', detail: 'Group 1' });
  assert.deepEqual(lessonTitle('Mathe'), { tag: '', title: 'Mathe', detail: '' });
  assert.equal(roomOf('Ris'), 'Ris');
  assert.equal(roomOf('Raum 2.04, Campus Nord'), '2.04');
  assert.equal(roomOf('https://meet.google.com/abc-defg-hij'), 'Online');
  assert.equal(roomOf(null, 'https://zoom.us/j/1'), 'Online');
  assert.equal(roomOf(null, null), '');
});

test('day plan: lessons with rooms, meetings and plan blocks in time order; done and untimed blocks left out', async () => {
  const { dayPlan } = await import('../src/jobs/glance.js');
  const { zonedInstant } = await import('../src/lib/time.js');
  const date = '2026-10-08', at = t => zonedInstant(date, t).getTime();
  const ev = (id, kind, title, from, to, location = null) => db.run(`INSERT OR REPLACE INTO calendar_events (id, connection_id, kind, title, start, end, all_day, location, updated_at)
    VALUES (?, 'c1', ?, ?, ?, ?, 0, ?, ?)`, id, kind, title, new Date(at(from)).toISOString(), new Date(at(to)).toISOString(), location, Date.now());
  ev('l1', 'lesson', '[LU] OS: STS Essentials - Group 1', '09:00', '10:45', 'Ris');
  ev('m1', 'meeting', 'N26 interview', '14:00', '15:00', 'https://meet.google.com/x');
  db.run(`INSERT OR REPLACE INTO docs (user_id, key, value, updated_at, deleted, rev) VALUES (1, ?, ?, ?, 0, 1)`, 'dayplan:' + date,
    j.str([{ id: 'b1', label: 'Lunch with Ana', time: '12:00' }, { id: 'b2', label: 'Prep N26 case', time: '13:00' }, { id: 'b3', label: 'Old', time: '08:00', done: true }, { id: 'b4', label: 'Someday' }]), Date.now());
  const items = dayPlan(date);
  assert.deepEqual(items.map(i => [i.kind, i.title, i.room]), [
    ['lesson', 'STS Essentials', 'Ris'], ['plan', 'Lunch with Ana', ''], ['plan', 'Prep N26 case', ''], ['meeting', 'N26 interview', 'Online']]);
  assert.equal(items[0].start, at('09:00'));
  assert.equal(items[0].end, at('10:45'));
  assert.equal(items[1].end, at('13:00'), 'a block runs until the next one');
  assert.equal(items[2].end, at('14:00'), 'the last block gets an hour');
  const g = (await api('GET', '/api/glance')).body;
  assert.ok(Array.isArray(g.day.today.items) && Array.isArray(g.day.tomorrow.items));
});
