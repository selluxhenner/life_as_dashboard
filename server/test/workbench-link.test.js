// Workbench link: computers connect out, one picture, Kevin's answers go back at most once and only for what he saw.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-wbl-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-wbl-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, db, link, tools, pc, mac, phone, ops;
before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate(); db = dbm.db;
  ({ app } = await import('../src/app.js'));
  link = await import('../src/workbench/link.js');
  tools = (await import('../src/agent/tools.js')).TOOLS;
  phone = (await api('POST', '/api/devices/pair', { name: 'Phone', platform: 'android' })).body.token;
  ops = (await api('POST', '/api/devices/pair', { name: 'agent-box', platform: 'linux', scope: 'ops' })).body.token;
});

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}
const pair = async name => {
  const r = await api('POST', '/api/workbench/links', { name }, phone);
  assert.equal(r.status, 201);
  const { u, t } = JSON.parse(Buffer.from(r.body.code.slice('aos1.'.length), 'base64url'));
  assert.equal(u, 'http://test.local');
  return { id: r.body.id, token: t };
};
const approve = (over = {}) => ({ key: 'approve-PLR', rev: 'r1', kind: 'plan-approval', scope: 'orch', title: 'PLR · Planner', detail: 'Five tasks.', level: 'ask', push: true, plan: 'PLR',
  options: [{ id: 'approve', label: 'Approve plan', style: 'primary', yes: true, confirm: 'orch starts it.' }], ...over });
const waits = (over = {}) => ({ key: 'waiting-s1', rev: 'r1', kind: 'session-waiting', scope: 'machine', title: 'fix login waits for you', detail: 'Which API?', level: 'ask', push: true,
  options: [{ id: 'reply', label: 'Answer', text: 'required' }], ...over });
const host = (id, short, over = {}) => ({ id, short, total: 7, working: 3, now: 43, hour: 60, day: 71, lanes: [{ id: short + '/a', project: 'nextup', task: 'IN3-Z1', title: 'x' }], lost: [], trend: [], ...over });
const snap = (machine, over = {}) => ({ v: 1, machine: { id: machine, platform: 'windows', version: '1.0' }, orch: { configured: true, paused: false }, hosts: [], plans: [], items: [], sessions: [], events: [], cards: [], ...over });
const put = (c, s) => api('PUT', '/api/workbench-link/snapshot', s, c.token);
const control = async () => (await api('GET', '/api/workbench/control', undefined, phone)).body;
const take = async (c, wait = 0) => (await api('GET', '/api/workbench-link/decisions?wait=' + wait, undefined, c.token)).body.decisions;

test('pairing: only the apps pair, and a Workbench token opens nothing but the link', async () => {
  assert.equal((await api('POST', '/api/workbench/links', { name: 'x' }, ops)).status, 403);
  assert.equal((await api('POST', '/api/workbench/links', { name: ' ' }, phone)).status, 400);
  pc = await pair('PC'); mac = await pair('MacBook');
  for (const [m, p] of [['GET', '/api/todos'], ['GET', '/api/workbench/control'], ['GET', '/api/approvals'], ['GET', '/api/hub/state'], ['GET', '/api/lina/feed'], ['GET', '/api/tasks/queue'],
    ['POST', '/api/lina/events'], ['POST', '/api/ops/report'], ['GET', '/api/devices'], ['POST', '/api/workbench/links'], ['POST', '/api/workbench/items/wbk_1/decide']]) {
    const r = await api(m, p, m === 'POST' ? {} : undefined, pc.token);
    assert.equal(r.status, 403, `${m} ${p} answered ${r.status}`);
  }
  for (const t of [phone, ops, 'test-master-token']) assert.equal((await api('PUT', '/api/workbench-link/snapshot', snap('x'), t)).status, 403);
  assert.equal((await api('PUT', '/api/workbench-link/snapshot', snap('x'), null)).status, 401);
});

test('a snapshot is cleaned: unknown kinds stay, bad links and oversized parts go', async () => {
  assert.equal((await put(pc, { v: 2, machine: { id: 'kev-pc' } })).status, 400);
  assert.equal((await put(pc, { v: 1 })).status, 400);
  const r = await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc')], cards: [{ id: 'accounts', title: 'Accounts', rows: [{ label: 'Claude', value: '44 %', percent: 144, tone: 'loud', href: 'javascript:alert(1)' }] }],
    items: [{ key: 'escalated-X-A1', rev: 'q', kind: 'escalated', title: 'X'.repeat(900), detail: 'd', href: 'javascript:alert(1)', brandNew: 1, options: [{ id: 'merge', label: 'Merge' }, { id: 'rework', label: 'Back with a note', text: 'required' }, { label: 'no id' }] },
      { key: 'no-rev', title: 't' }, 'junk'] }));
  assert.equal(r.status, 200);
  const c = await control();
  const i = c.items.find(x => x.kind === 'escalated');
  assert.equal(i.title.length, 200);
  assert.equal(i.href, null);
  assert.deepEqual(i.options.map(o => o.id), ['merge', 'rework']);
  assert.equal(c.items.length, 1);
  assert.deepEqual(c.cards[0].rows[0], { label: 'Claude', value: '44 %', tone: null, percent: 100, href: null });
});

test('two computers become one picture: an ask once, each with its lanes', async () => {
  await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc'), host('kev-mac', 'mac', { total: 6, working: 1 })], items: [approve()], plans: [{ id: 'PLR', title: 'Planner', state: 'active', done: 1, total: 5 }] }));
  await put(mac, snap('kev-mac', { machine: { id: 'kev-mac', platform: 'macos' }, hosts: [host('kev-mac', 'mac', { total: 6, working: 2 })], items: [approve(), waits()] }));
  const c = await control();
  assert.equal(c.lead, 'kev-pc');
  assert.equal(c.items.filter(i => i.key === 'approve-PLR').length, 1);
  assert.equal(c.items.find(i => i.key === 'approve-PLR').machineName, 'PC');
  assert.equal(c.items.find(i => i.key === 'waiting-s1').machineName, 'MacBook');
  assert.deepEqual(c.machines.map(m => [m.name, m.online, m.lanes.working, m.lanes.total]), [['PC', true, 3, 7], ['MacBook', true, 2, 6]]);
  assert.equal(c.plans[0].total, 5);
});

test('an ask about a lane goes to the computer that runs the lane', async () => {
  const stuck = { key: 'task-X-A1', rev: 'r', kind: 'task-blocked', scope: 'orch', host: 'mac', title: 'X-A1 is blocked', level: 'ask', options: [{ id: 'suggestion', label: 'Do as it proposes', yes: true }] };
  await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc'), host('kev-mac', 'mac')], items: [stuck] }));
  await put(mac, snap('kev-mac', { hosts: [host('kev-mac', 'mac')], items: [stuck] }));
  assert.equal((await control()).items[0].machineName, 'MacBook');
  db.run('UPDATE workbench_links SET seen_at = 1 WHERE device_id = ?', mac.id);
  const c = await control();
  assert.equal(c.items[0].machineName, 'PC', 'the Mac is off: the controller answers');
  assert.deepEqual(c.machines.map(m => [m.name, m.online, m.viaController]), [['PC', true, false], ['MacBook', false, true]]);
});

test('a decision is delivered once, reported once, and the ask is gone', async () => {
  await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc')], items: [approve({ rev: 'r2' })] }));
  await put(mac, snap('kev-mac', { hosts: [host('kev-mac', 'mac')] }));
  const item = (await control()).items.find(i => i.key === 'approve-PLR');
  const poll = take(pc, 5);                                   // Workbench is already waiting
  await new Promise(r => setTimeout(r, 20));
  assert.equal((await api('POST', `/api/workbench/items/${item.id}/decide`, { option: 'nope' }, phone)).status, 400);
  const d = await api('POST', `/api/workbench/items/${item.id}/decide`, { option: 'approve' }, phone);
  assert.equal(d.status, 200);
  assert.deepEqual((await poll).map(({ id, ...x }) => x), [{ key: 'approve-PLR', rev: 'r2', option: 'approve', text: null }]);
  assert.deepEqual(await take(pc), [], 'never twice');
  assert.equal((await api('POST', `/api/workbench/items/${item.id}/decide`, { option: 'approve' }, phone)).status, 409, 'already on its way');
  const id = d.body.decision.id;
  assert.equal((await api('POST', '/api/workbench-link/decisions/' + id, { ok: true }, mac.token)).status, 409, 'only the computer it went to');
  assert.equal((await api('POST', '/api/workbench-link/decisions/' + id, { ok: true, message: 'PLR approved' }, pc.token)).status, 200);
  assert.equal((await api('POST', '/api/workbench-link/decisions/' + id, { ok: false }, pc.token)).status, 409, 'once');
  const c = await control();
  assert.equal(c.items.some(i => i.key === 'approve-PLR'), false);
  assert.equal(c.decisions[0].status, 'done');
  assert.equal(db.get("SELECT level FROM lina_feed WHERE ref = ?", 'wbd:' + id).level, 'good');
});

test('an ask that changed after Kevin saw it is refused, and so is one of a computer that is off', async () => {
  await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc')], items: [approve({ key: 'grant-Y', rev: 'a', title: 'Y needs a.ts', scope: 'machine' })] }));
  const old = (await control()).items[0];
  await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc')], items: [approve({ key: 'grant-Y', rev: 'b', title: 'Y needs a.ts, auth.ts', scope: 'machine' })] }));
  const r = await api('POST', `/api/workbench/items/${old.id}/decide`, { option: 'approve' }, phone);
  assert.equal(r.status, 409);
  db.run('UPDATE workbench_links SET seen_at = 1 WHERE device_id = ?', pc.id);
  const now = (await control()).items[0];
  assert.match((await api('POST', `/api/workbench/items/${now.id}/decide`, { option: 'approve' }, phone)).body.error, /not connected/);
});

test('an answer not picked up expires, one without a result is unknown, and neither is sent again', async () => {
  await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc')], items: [approve({ key: 'exp', rev: 'a' }), approve({ key: 'unk', rev: 'a' })] }));
  const [a, b] = (await control()).items;
  const now = Date.now();
  const d1 = link.decideItem(a.id, 'approve', { by: 'x' });
  db.run('UPDATE workbench_decisions SET expires_at = ? WHERE id = ?', now - 1, d1.id);
  assert.deepEqual(await take(pc), []);
  assert.equal((await control()).items.find(i => i.id === a.id).decision.status, 'expired');
  const d2 = link.decideItem(b.id, 'approve', { by: 'x' });
  assert.equal((await take(pc)).length, 1);
  db.run('UPDATE workbench_decisions SET sent_at = ? WHERE id = ?', now - 4 * 60000, d2.id);
  assert.equal((await control()).items.find(i => i.id === b.id).decision.status, 'unknown');
  assert.deepEqual(await take(pc), []);
});

test('a session answer needs words and carries them', async () => {
  await put(mac, snap('kev-mac', { hosts: [host('kev-mac', 'mac')], items: [waits({ rev: 'w' })] }));
  const i = (await control()).items.find(x => x.key === 'waiting-s1');
  assert.equal((await api('POST', `/api/workbench/items/${i.id}/decide`, { option: 'reply' }, phone)).status, 400);
  assert.equal((await api('POST', `/api/workbench/items/${i.id}/decide`, { option: 'reply', text: 'use the\nold API' }, phone)).status, 200);
  assert.equal((await take(mac))[0].text, 'use the old API');
});

test('a new ask pushes once, many at once push once together, events reach the feed once', async () => {
  const pushes = () => db.get("SELECT COUNT(*) AS n FROM notifications WHERE title LIKE 'Workbench%'").n;
  const before = pushes();
  const s = snap('kev-pc', { hosts: [host('kev-pc', 'pc')], items: [approve({ key: 'p1', rev: 'a', title: 'P1' })], events: [{ key: 'merged:Z-1', at: Date.now(), title: 'Z-1 merged', level: 'good' }] });
  await put(pc, s); await put(pc, s);
  assert.equal(pushes(), before + 1);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM lina_feed WHERE ref = 'wbe:merged:Z-1'").n, 1);
  db.run("UPDATE lina_feed SET told_at = 1 WHERE ref = 'wbe:merged:Z-1'");
  await put(mac, snap('kev-mac', { events: [{ key: 'merged:Z-1', at: Date.now(), title: 'Z-1 merged' }] }));
  assert.equal(db.get("SELECT told_at FROM lina_feed WHERE ref = 'wbe:merged:Z-1'").told_at, 1, 'the second computer does not make it new again');
  await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc')], items: Array.from({ length: 6 }, (_, n) => approve({ key: 'q' + n, rev: 'a', title: 'Q' + n })) }));
  assert.equal(pushes(), before + 2);
});

test('Lina: the decide tool checks first and waits for a yes; a yes on an ask she read out takes its yes option', async () => {
  await put(pc, snap('kev-pc', { hosts: [host('kev-pc', 'pc')], items: [approve({ key: 'lina', rev: 'a', title: 'ISS · Issues' })] }));
  const i = (await control()).items.find(x => x.key === 'lina');
  const t = tools.workbench_decide;
  assert.equal(t.risk, 'outward');
  assert.throws(() => t.check({ id: i.id, option: 'approve' }, { trigger: 'watch' }), /Only Kevin/);
  assert.throws(() => t.check({ id: 'wbk_0000000000000000', option: 'approve' }, { trigger: 'voice' }), /changed/);
  t.check({ id: i.id, option: 'approve' }, { trigger: 'voice' });
  assert.match(t.summary({ id: i.id, option: 'approve' }), /Approve plan · ISS · Issues/);
  const { runDirect } = await import('../src/agent/runner.js');
  const r = await runDirect([{ name: 'workbench_decide', input: { id: i.id, option: 'approve' } }]);
  assert.equal(r.results[0].queued, true);
  assert.deepEqual(await take(pc), [], 'nothing runs before the yes');
  assert.equal(link.yesOption(link.workbenchItem(i.id)).id, 'approve');
  assert.equal(link.yesOption({ options: [{ id: 'reply', yes: true, text: 'required' }] }), null);
  const brief = await tools.workbench_status.run({});
  assert.ok(brief.needs.some(n => n.id === i.id));
  assert.equal(brief.computers[0].lanes, '3 of 7 busy');
});

test('disconnecting a computer revokes its token and takes its asks away', async () => {
  assert.equal((await api('DELETE', '/api/workbench/links/' + mac.id, undefined, phone)).status, 200);
  assert.equal((await put(mac, snap('kev-mac'))).status, 401);
  assert.equal((await control()).machines.some(m => m.deviceId === mac.id), false);
  assert.equal((await api('DELETE', '/api/workbench/links/dev_nope', undefined, phone)).status, 404);
});
