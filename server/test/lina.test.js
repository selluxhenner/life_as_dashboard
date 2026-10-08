// Lina's quick spoken turns against a fake Claude API: what is sent (fast model, no thinking, the snapshot), and that a
// change is done in one model call while lookups and failures still get a second one. Run: npm test (inside server/)
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-lina-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-lina-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.OPENAI_API_KEY = 'sk-test';                  // speech-to-text
process.env.ELEVENLABS_API_KEY = 'xi-test';              // the voice
process.env.ELEVENLABS_API_URL = 'https://eleven.test';

/* ---------- fake upstream APIs (installed before the SDK captures fetch) ---------- */
let heard = '', script = [];
const calls = [], tts = [];
const realFetch = globalThis.fetch;

function sse(model, content, stopReason) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { id: 'msg_' + calls.length, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
  content.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    out += ev('content_block_stop', { index });
  });
  out += ev('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
  out += ev('message_stop', {});
  return new Response(out, { headers: { 'content-type': 'text/event-stream' } });
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/')) {
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (!body.stream) {                                   // the cache warm-up (max_tokens 0)
      return new Response(JSON.stringify({ id: 'msg_warm', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: 'max_tokens', stop_sequence: null, usage: { input_tokens: 5, cache_creation_input_tokens: 4000, output_tokens: 0 } }), { headers: { 'content-type': 'application/json' } });
    }
    const next = script.shift();
    assert.ok(next, 'unexpected extra model call');
    const content = next(body);
    return sse(body.model, content, content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
  }
  if (u.endsWith('/v1/audio/transcriptions')) return new Response(JSON.stringify({ text: heard }), { headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://eleven.test/')) {
    tts.push({ path: new URL(u).pathname, body: JSON.parse(opts.body) });
    return new Response(Buffer.from('ID3-lina'));
  }
  return realFetch(url, opts);
};

let app, db, setSetting, localDate, addDays;
before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate();
  db = dbm.db;
  ({ app } = await import('../src/app.js'));
  ({ setSetting } = await import('../src/settings.js'));
  ({ localDate, addDays } = await import('../src/lib/time.js'));
});
beforeEach(() => { calls.length = 0; tts.length = 0; script = []; setSetting('lina', { people: [], quick: true }); });

async function api(method, path, body) {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-master-token' }, body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}
const turn = (text, query = '') => {
  heard = text;
  return app.fetch(new Request('http://test.local/api/voice/turn' + query, {
    method: 'POST', headers: { Authorization: 'Bearer test-master-token', 'Content-Type': 'audio/wav' }, body: new Uint8Array(8000)
  })).then(r => r.json());
};
const modelCalls = () => calls.filter(c => c.stream);
const systemText = body => body.system.map(b => b.text).join('\n');

test('a spoken change is one fast model call: Haiku, no thinking, everything Lina needs in the prompt', async () => {
  const gym = (await api('POST', '/api/todos', { title: 'Gym', due: localDate() })).body;
  const tomorrow = addDays(localDate(), 1);
  script.push(body => [
    { type: 'text', text: 'Added “Buy milk” for tomorrow.' },
    { type: 'tool_use', id: 'tu_1', name: 'create_todo', input: { title: 'Buy milk', due: tomorrow } }
  ]);
  const r = await turn('Hey Lina, add buy milk for tomorrow', '?wake=1');

  assert.equal(r.reply, 'Added “Buy milk” for tomorrow.');
  assert.equal(r.heard, 'add buy milk for tomorrow');
  assert.deepEqual(r.tools.map(t => [t.name, t.status]), [['create_todo', 'done']]);
  assert.equal(modelCalls().length, 1);                                  // no second call just to confirm
  const todo = db.get("SELECT * FROM todos WHERE title = 'Buy milk'");
  assert.equal(todo.due, tomorrow);
  assert.equal(todo.source, 'voice');

  const [req] = modelCalls();
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.deepEqual(req.thinking, { type: 'disabled' });
  assert.equal(req.output_config.effort, 'low');
  assert.equal(req.fallbacks, undefined);                               // Haiku 5.5 has no server-side fallback
  assert.deepEqual(req.cache_control, { type: 'ephemeral' });
  assert.ok(req.tools.some(t => t.name === 'check_habit'));
  const sys = systemText(req);
  assert.match(sys, new RegExp(`${gym.id} \\| Gym \\| due ${localDate()}`));   // ids at hand: no list_todos first
  assert.match(sys, new RegExp(`${tomorrow} \\(tomorrow\\)`));

  // the warm-up ran while the speech was transcribed, with the same cached prefix
  const warm = calls.find(c => !c.stream);
  assert.equal(warm.max_tokens, 0);
  assert.deepEqual(warm.system, req.system.slice(0, 2));
  assert.deepEqual(warm.tools, req.tools);
  assert.deepEqual(warm.thinking, req.thinking);
  assert.equal(warm.cache_control, undefined);

  // the reply is spoken with ElevenLabs Flash
  assert.equal(tts.length, 1);
  assert.match(tts[0].path, /^\/v1\/text-to-speech\//);
  assert.equal(tts[0].body.model_id, 'eleven_flash_v2_5');
  assert.equal(Buffer.from(r.audio, 'base64').toString(), 'ID3-lina');
});

test('habits and notes by voice land in the synced documents the app reads', async () => {
  const t = Date.now();
  await api('POST', '/api/docs/sync', { since: 0, upserts: [{ key: 'habit:id_read', value: { id: 'id_read', label: 'Read 20 pages', icon: '◆', history: {}, mode: 'daily', createdAt: localDate() }, updatedAt: t }] });
  const cursor = (await api('POST', '/api/docs/sync', { since: 0, upserts: [] })).body.cursor;

  script.push(body => {
    assert.match(systemText(body), /id_read \| Read 20 pages \| daily/);
    return [
      { type: 'text', text: 'Ticked off reading and noted your idea.' },
      { type: 'tool_use', id: 'tu_h', name: 'check_habit', input: { id: 'id_read' } },
      { type: 'tool_use', id: 'tu_n', name: 'add_note', input: { title: 'Idea', body: 'A widget for the gym plan' } },
      { type: 'tool_use', id: 'tu_a', name: 'add_habit', input: { label: 'Stretch', mode: 'weekly', target: 4 } }
    ];
  });
  const r = await turn('I read today, note the idea a widget for the gym plan, and add stretching four times a week');
  assert.equal(r.reply, 'Ticked off reading and noted your idea.');
  assert.equal(modelCalls().length, 1);

  const docs = (await api('POST', '/api/docs/sync', { since: cursor, upserts: [] })).body.docs;
  const read = docs.find(d => d.key === 'habit:id_read');
  assert.equal(read.value.history[localDate()], true);
  const note = docs.find(d => d.key.startsWith('capture:'));
  assert.equal(note.value.type, 'note');
  assert.equal(note.value.text, 'Idea: A widget for the gym plan');
  const stretch = docs.find(d => d.key.startsWith('habit:') && d.value.label === 'Stretch');
  assert.deepEqual([stretch.value.mode, stretch.value.target], ['weekly', 4]);

  script.push(() => [
    { type: 'text', text: 'Deleted the habit “Stretch”.' },
    { type: 'tool_use', id: 'tu_d', name: 'delete_habit', input: { id: stretch.value.id, label: 'Stretch' } }
  ]);
  await turn('delete the stretching habit');
  const after = (await api('POST', '/api/docs/sync', { since: 0, upserts: [] })).body.docs.find(d => d.key === stretch.key);
  assert.equal(after.deleted, true);
});

test('a lookup or a failed change still gets the second call, and its answer is what Lina says', async () => {
  script.push(() => [{ type: 'tool_use', id: 'tu_s', name: 'search_emails', input: { unread_only: true } }]);
  script.push(body => {
    const last = body.messages.at(-1);
    assert.equal(last.content[0].type, 'tool_result');
    return [{ type: 'text', text: 'No unread emails.' }];
  });
  assert.equal((await turn('any new emails?')).reply, 'No unread emails.');
  assert.equal(modelCalls().length, 2);

  calls.length = 0;
  script.push(() => [
    { type: 'text', text: 'Deleted it.' },
    { type: 'tool_use', id: 'tu_x', name: 'delete_todo', input: { id: 'no-such-todo' } }
  ]);
  script.push(body => {
    assert.equal(body.messages.at(-1).content[0].is_error, true);
    return [{ type: 'text', text: 'I couldn’t find that task.' }];
  });
  assert.equal((await turn('delete the dentist task')).reply, 'I couldn’t find that task.');
  assert.equal(modelCalls().length, 2);
});

test('a follow-up turn sends the recent exchange, and quick mode can be switched off', async () => {
  const first = await (script.push(() => [{ type: 'text', text: 'Hi!' }]), turn('hello'));
  script.push(body => {
    assert.deepEqual(body.messages.map(m => m.role), ['user', 'assistant', 'user']);
    return [{ type: 'text', text: 'Sure.' }];
  });
  await turn('and now?', '?conversationId=' + first.conversationId);

  setSetting('lina', { people: [], quick: false });
  calls.length = 0;
  script.push(body => {
    assert.equal(body.model, 'claude-sonnet-5-5');
    assert.equal(body.fallbacks, 'default');
    assert.doesNotMatch(systemText(body), /Open todos/);
    return [{ type: 'text', text: 'Okay, adding it.' }, { type: 'tool_use', id: 'tu_q', name: 'create_todo', input: { title: 'Call mom' } }];
  });
  script.push(() => [{ type: 'text', text: 'Added “Call mom”.' }]);
  const r = await turn('add call mom');
  assert.equal(r.reply, 'Added “Call mom”.');
  assert.equal(modelCalls().length, 2);                                  // the thorough path confirms after the fact
  assert.equal(tts.at(-1).path, '/v1/text-to-dialogue');                // and speaks with the chosen model
});

test('settled: only finished changes skip the second call; anything waiting needs the question already asked', async () => {
  const { settled } = await import('../src/agent/runner.js');
  const ok = { content: '{}', result: { ok: true } };
  assert.equal(settled([{ name: 'create_todo' }], [ok], 'Added it.'), true);
  assert.equal(settled([{ name: 'create_todo' }], [ok], ''), false);                          // nothing said yet
  assert.equal(settled([{ name: 'list_todos' }], [ok], 'Let me look.'), false);               // a lookup needs its answer
  assert.equal(settled([{ name: 'create_todo' }], [{ ...ok, isError: true }], 'Added it.'), false);
  assert.equal(settled([{ name: 'draft_email' }], [{ content: '', queued: true }], 'Drafted it.'), false);
  assert.equal(settled([{ name: 'draft_email' }], [{ content: '', queued: true }], 'Shall I send it?'), true);
  const moved = { content: '', result: { ok: true, waiting: 'Guests would be emailed' } };
  assert.equal(settled([{ name: 'move_event' }], [moved], 'Moved it to 4.'), false);
  assert.equal(settled([{ name: 'move_event' }], [moved], 'Max is on it too: shall I tell him?'), true);
  const meeting = { content: '', result: { ok: true, invitation: "queued for Kevin's approval (act_1), NOT sent yet" } };
  assert.equal(settled([{ name: 'schedule_meeting' }], [meeting], 'It is on your calendar for 3.'), false);
  assert.equal(settled([{ name: 'schedule_meeting' }], [meeting], 'It is on your calendar for 3. Shall I send Max the invite?'), true);
});

test('recentHistory starts at something Kevin said, drops thinking and shortens old tool results', async () => {
  const { recentHistory } = await import('../src/agent/runner.js');
  const user = text => ({ role: 'user', content: [{ type: 'text', text }] });
  const history = [
    user('old question'),
    { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'tool_use', id: 't1', name: 'get_today', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000) }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'y' }, { type: 'text', text: 'Busy day.' }] }
  ];
  const all = recentHistory(history);
  assert.deepEqual(all.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.ok(all.every(m => m.content.every(b => b.type !== 'thinking')));
  assert.ok(all[2].content[0].content.length < 2100);
  // cut in the middle of a tool exchange: start at the next thing Kevin said instead
  assert.deepEqual(recentHistory([...history, user('next')], 3), [user('next')]);
});

test('notes from background jobs stay out of the Capture inbox; /voice/warm answers at once', async () => {
  const { TOOLS } = await import('../src/agent/tools.js');
  const before = db.get("SELECT COUNT(*) n FROM docs WHERE key LIKE 'capture:%'").n;
  TOOLS.add_note.run({ title: 'Prep: Stand-up', body: 'Nothing new' }, { trigger: 'meeting-prep', source: 'agent' });
  assert.equal(db.get("SELECT COUNT(*) n FROM docs WHERE key LIKE 'capture:%'").n, before);
  assert.equal((await api('POST', '/api/voice/warm')).status, 200);
});
