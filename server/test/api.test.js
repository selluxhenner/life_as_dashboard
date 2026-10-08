// In-process API tests against a throwaway database. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-data-'));       // voice audio cache
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

test('sync accepts tasks made from captures and skips a bad todo instead of failing the batch', async () => {
  const now = Date.now();
  const good = { id: 'cap_task_1', title: 'Call dentist', source: 'capture', updatedAt: now };
  const bad = { id: 'bad_todo_1', title: 'Weird', priority: 'urgent', updatedAt: now };
  const r = await api('POST', '/api/sync', { since: 0, upserts: [bad, good] });
  assert.equal(r.status, 200);
  assert.ok(r.body.todos.some(t => t.id === 'cap_task_1' && t.source === 'capture'));
  assert.ok(!r.body.todos.some(t => t.id === 'bad_todo_1'));
  assert.deepEqual(r.body.rejected.map(x => x.id), ['bad_todo_1']);
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
  assert.equal(policyFor('send_invite', ['read', 'internal', 'outward']), 'queue');   // Lina's meeting invitations
  assert.equal(policyFor('schedule_meeting', ['read', 'internal', 'outward']), 'run');
  assert.equal(policyFor('cancel_event', ['read', 'internal', 'outward']), 'queue');      // cancelling always asks
  assert.equal(policyFor('update_event', ['read', 'internal', 'outward']), 'queue');      // guests get emailed
  assert.equal(policyFor('move_event', ['read', 'internal']), 'run');
  assert.equal(policyFor('delete_todo', ['read', 'internal']), 'run');
});

test('Lina remembers people and queues invitations for approval', async () => {
  const { TOOLS, queueAction, people } = await import('../src/agent/tools.js');
  TOOLS.remember_person.run({ name: 'Max Muster', email: 'max@example.com', relation: 'business partner' });
  TOOLS.remember_person.run({ name: 'Max Muster', email: 'max@muster.ch', relation: 'Business Partner' });   // same relation: replaced
  assert.deepEqual(people().map(p => p.email), ['max@muster.ch']);
  assert.equal(TOOLS.find_person.run({ query: 'business partner' }).known[0].name, 'Max Muster');
  assert.equal(TOOLS.find_person.run({ query: 'my business partner' }).known.length, 1);
  const id = await queueAction({ runId: 'run_t', trigger: 'voice' }, 'send_invite',
    { connectionId: 'c', eventId: 'e', title: 'Meeting with Max', date: '2026-10-08', time: '15:00', guests: [{ email: 'max@muster.ch', name: 'Max' }] });
  const pending = (await api('GET', '/api/agent/actions?status=pending')).body.actions;
  assert.ok(pending.some(a => a.id === id && /Send the invite for “Meeting with Max”.*to Max/.test(a.summary)));
  assert.equal((await api('POST', '/api/agent/actions/' + id + '/reject')).body.ok, true);
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

test('docs sync: last write wins, tombstones, paging cursor', async () => {
  const t = Date.now();
  const a = await api('POST', '/api/docs/sync', { since: 0, upserts: [
    { key: 'dayplan:2026-10-05', value: [{ id: 'b1', time: '09:00', label: 'Deep work', done: false }], updatedAt: t },
    { key: 'habit:h1', value: { id: 'h1', label: 'Training', history: {} }, updatedAt: t }
  ] });
  assert.equal(a.status, 200);
  assert.equal(a.body.docs.length, 2);
  // an older write loses
  await api('POST', '/api/docs/sync', { since: a.body.cursor, upserts: [{ key: 'dayplan:2026-10-05', value: [], updatedAt: t - 1000 }] });
  const b = await api('POST', '/api/docs/sync', { since: 0, upserts: [] });
  assert.equal(b.body.docs.find(d => d.key === 'dayplan:2026-10-05').value[0].label, 'Deep work');
  // a delete is a tombstone other devices receive
  const c = await api('POST', '/api/docs/sync', { since: b.body.cursor, upserts: [{ key: 'habit:h1', deleted: true, updatedAt: t + 1 }] });
  assert.deepEqual(c.body.docs.map(d => [d.key, d.deleted]), [['habit:h1', true]]);
  assert.equal((await api('POST', '/api/docs/sync', { since: 0, upserts: [{ key: 'bad key!', value: 1, updatedAt: t }] })).status, 400);
});

test('voice: without keys the server says so, and spoken briefing/world audio are 404 until written', async () => {
  const info = await api('GET', '/api/voice/info');
  assert.equal(info.status, 200);
  assert.equal(info.body.tts, null);
  assert.equal(info.body.eleven, null);
  assert.equal((await api('GET', '/api/voice/briefing')).status, 404);
  assert.equal((await api('POST', '/api/voice/tts', { text: 'Hello' })).status, 503);
  assert.equal((await api('GET', '/api/voice/voices')).status, 503);
  const turn = await app.fetch(new Request('http://test.local/api/voice/turn', { method: 'POST', headers: { Authorization: 'Bearer test-master-token', 'Content-Type': 'audio/wav' }, body: new Uint8Array(4000) }));
  assert.equal(turn.status, 503);                                     // Lina can't hear without a speech-to-text key
  assert.deepEqual((await api('POST', '/api/briefing/spoken', {})).body, { briefing: null });
});

test('voice: a stored spoken briefing is returned and becomes the follow-up context', async () => {
  const { db, j } = await import('../src/db.js');
  const { localDate } = await import('../src/lib/time.js');
  const { briefingSpeech } = await import('../src/jobs/briefing.js');
  const spoken = { greeting: 'Good morning, Kevin.', topics: [{ label: 'First up', say: 'Your lesson starts at 9:15.', refs: ['ev:1'] }], words: 9, seconds: 3 };
  db.run('INSERT OR REPLACE INTO briefings (date, created_at, model, headline, sections, focus, spoken) VALUES (?, ?, ?, ?, ?, ?, ?)',
    localDate(), Date.now(), 'test', 'School day.', '[]', '[]', j.str(spoken));
  const b = await api('GET', '/api/briefing/today');
  assert.deepEqual(b.body.briefing.spoken, spoken);
  assert.equal(briefingSpeech(), 'Good morning, Kevin. Your lesson starts at 9:15.');
  // already has a spoken version: nothing is regenerated (no AI key needed)
  assert.deepEqual((await api('POST', '/api/briefing/spoken', {})).body.briefing.spoken, spoken);
  // audio needs a voice engine; without keys it is a clear 503, not a crash
  assert.equal((await api('GET', '/api/voice/briefing')).status, 503);
});

test('voice: engine choice follows the keys, settings can only pick a configured one', async () => {
  const { ttsEngine } = await import('../src/voice/speech.js');
  const { config } = await import('../src/config.js');
  const saved = { ...config };
  try {
    assert.equal(ttsEngine({ engine: 'auto' }), null);
    config.openaiKey = 'sk-test';
    assert.equal(ttsEngine({ engine: 'elevenlabs' }), 'openai');
    config.elevenKey = 'xi-test';
    assert.equal(ttsEngine({ engine: 'auto' }), 'elevenlabs');
    assert.equal(ttsEngine({ engine: 'openai' }), 'openai');
  } finally { Object.assign(config, saved); }
});

test('world: spoken summary falls back to the top headlines for older digests', async () => {
  const { db, j } = await import('../src/db.js');
  const { worldSpeech, worldScript } = await import('../src/jobs/news.js');
  db.run('INSERT OR REPLACE INTO news_digests (slot, created_at, regions, top, elections) VALUES (?, ?, ?, ?, ?)',
    'test-old', new Date('2026-10-06T05:00:00Z').getTime(), '{}', j.str([{ headline: 'EU agrees gas price cap' }, { headline: 'Japan holds snap election' }]), '[]');
  assert.equal(worldSpeech(), "Here's the world this morning. EU agrees gas price cap. Japan holds snap election.");
  db.run('UPDATE news_digests SET spoken = ? WHERE slot = ?', j.str([{ say: 'The EU agreed a cap on gas prices.' }]), 'test-old');
  assert.equal(worldSpeech(), "Here's the world this morning. The EU agreed a cap on gas prices.");
  // current digests: a one-line overview, the stories with a tone each, and what was left out
  db.run('UPDATE news_digests SET spoken = ? WHERE slot = ?', j.str({
    overview: 'Energy dominates the day.', overviewTone: 'serious', outro: 'Elsewhere it is quiet.',
    items: [{ say: 'The EU agreed a cap on gas prices.', tone: 'serious', region: 'europe', topic: 'economy' }]
  }), 'test-old');
  assert.equal(worldSpeech(), "Here's the world this morning. Energy dominates the day. The EU agreed a cap on gas prices. Elsewhere it is quiet.");
  assert.equal(worldScript(), "[Quick, lively, energetic pace, bright, upbeat] Here's the world this morning. [serious, steady] Energy dominates the day. "
    + '[serious, steady] The EU agreed a cap on gas prices. [relaxed, easy] Elsewhere it is quiet.');
  assert.equal((await api('GET', '/api/news/digest/latest')).body.digest.spoken.items.length, 1);
});

test('voice: audio keeps the CORS header (the apps play it cross-origin) and is cached on disk', async () => {
  const { config } = await import('../src/config.js');
  const realFetch = globalThis.fetch;
  let calls = 0;
  config.openaiKey = 'sk-test';
  globalThis.fetch = async (url, opts) => (String(url).startsWith('https://api.openai.com/') ? (calls++, new Response(Buffer.from('ID3-fake-mp3'))) : realFetch(url, opts));
  try {
    const text = 'CORS check ' + Date.now();
    const r = await api('POST', '/api/voice/tts', { text }, 'test-master-token', { Origin: 'http://tauri.localhost' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://tauri.localhost');
    assert.equal(r.text, 'ID3-fake-mp3');
    const again = await api('POST', '/api/voice/tts', { text });
    assert.equal(again.headers.get('x-voice-cached'), '1');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = realFetch; config.openaiKey = ''; }
});

test('briefing: bullets about events carry the end of the last one, so the card can cross them off', async () => {
  const { db, j } = await import('../src/db.js');
  const { localDate } = await import('../src/lib/time.js');
  const now = Date.now();
  db.run(`INSERT OR REPLACE INTO calendar_events (id, connection_id, kind, title, start, end, all_day, updated_at) VALUES (?, 'c', 'event', ?, ?, ?, 0, ?)`,
    'c:past', 'Stand-up', new Date(now - 3 * 3600000).toISOString(), new Date(now - 2 * 3600000).toISOString(), now);
  db.run(`INSERT OR REPLACE INTO calendar_events (id, connection_id, kind, title, start, end, all_day, updated_at) VALUES (?, 'c', 'event', ?, ?, ?, 0, ?)`,
    'c:later', 'Call', new Date(now + 3600000).toISOString(), new Date(now + 2 * 3600000).toISOString(), now);
  const sections = [{ id: 'schedule', title: 'Schedule', bullets: [
    { text: 'Stand-up, then the call.', refs: ['ev:c:past', 'ev:c:later'] },
    { text: 'Stand-up only.', refs: ['ev:c:past', 'mail:x'] },
    { text: 'Reply to Anna.', refs: ['mail:x'] },
    { text: 'Unknown event.', refs: ['ev:missing'] }
  ] }];
  db.run('INSERT OR REPLACE INTO briefings (date, created_at, model, headline, sections, focus) VALUES (?, ?, ?, ?, ?, ?)', localDate(), now, 'test', 'Day.', j.str(sections), '[]');
  const b = (await api('GET', '/api/briefing/today')).body.briefing;
  const [both, past, mail, unknown] = b.sections[0].bullets;
  assert.equal(both.until, new Date(now + 2 * 3600000).toISOString());   // the later event decides
  assert.ok(Date.parse(past.until) < now);
  assert.equal(mail.until, undefined);
  assert.equal(unknown.until, undefined);
});

test('Lina by voice: a false wake stays silent, a spoken yes/no decides only the action she asked about', async () => {
  const { config } = await import('../src/config.js');
  const { queueAction } = await import('../src/agent/tools.js');
  const realFetch = globalThis.fetch;
  let heard = '';
  config.openaiKey = 'sk-test';
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.endsWith('/v1/audio/transcriptions')) return new Response(JSON.stringify({ text: heard }), { headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/v1/audio/speech')) return new Response(Buffer.from('ID3-lina'));
    return realFetch(url, opts);
  };
  const turn = (query, text) => { heard = text; return app.fetch(new Request('http://test.local/api/voice/turn' + query, { method: 'POST', headers: { Authorization: 'Bearer test-master-token', 'Content-Type': 'audio/wav' }, body: new Uint8Array(8000) })).then(r => r.json()); };
  try {
    const wrong = await turn('?wake=1', 'Hey Linda, are you coming?');
    assert.equal(wrong.falseWake, true);
    assert.equal(wrong.audio, null);

    const ctx = { runId: 'run_voice', trigger: 'voice' };
    const email = await queueAction(ctx, 'draft_email', { to: 'max@muster.ch', subject: 'Offer', body: 'Hi Max' });
    const other = await queueAction(ctx, 'draft_email', { to: 'anna@example.com', subject: 'Other', body: 'x' });
    const no = await turn('?awaiting=' + email, 'Nein, lass es.');
    assert.equal(no.reply, 'Okay, ich lasse es.');
    assert.equal(no.lang, 'de');
    assert.equal(Buffer.from(no.audio, 'base64').toString(), 'ID3-lina');

    const email2 = await queueAction(ctx, 'draft_email', { to: 'max@muster.ch', subject: 'Offer', body: 'Hi Max' });
    const yes = await turn('?awaiting=' + email2, 'Yes, please.');
    assert.equal(yes.reply, 'The email is ready: open it in the app to send it.');
    const { db } = await import('../src/db.js');
    const status = id => db.get('SELECT status FROM agent_actions WHERE id = ?', id).status;
    assert.equal(status(email), 'rejected');
    assert.equal(status(email2), 'executed');
    assert.equal(status(other), 'pending');                            // nothing she didn't ask about
    await api('POST', '/api/agent/actions/' + other + '/reject');
  } finally { globalThis.fetch = realFetch; config.openaiKey = ''; }
});
