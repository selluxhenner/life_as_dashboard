// Agent tasks: Lina hands work to Hermes / Workbench / the server, Kevin approves once, the worker reports back.
// Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-tasks-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-tasks-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';

let app, db, serverRun, hermes, runner, phone;
before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate(); db = dbm.db;
  ({ app } = await import('../src/app.js'));
  ({ serverRun } = await import('../src/routes/tasks.js'));
  hermes = (await api('POST', '/api/devices/pair', { name: 'agent-box', platform: 'linux', scope: 'ops' })).body.token;
  runner = (await api('POST', '/api/devices/pair', { name: 'main-server', platform: 'linux', scope: 'ops' })).body.token;
  phone = (await api('POST', '/api/devices/pair', { name: 'Phone', platform: 'android' })).body.token;
});

async function api(method, path, body, token = 'test-master-token') {
  const res = await app.fetch(new Request('http://test.local' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}
const restart = (extra = {}) => api('POST', '/api/tasks', {
  kind: 'server-op', title: 'Restart the shop container', reason: 'Shop answers 502 since 09:10',
  params: { verb: 'restart-container', args: ['shop'] }, ...extra
}, phone);
const queue = async () => (await api('GET', '/api/tasks/queue', undefined, hermes)).body.tasks.map(t => t.id);

test('write verb: one approval, Hermes runs it with that approval and reports back', async () => {
  const t = (await restart()).body;
  assert.equal(t.status, 'awaiting_approval');
  assert.equal(t.target, 'hermes');
  assert.match(t.approvalId, /^apr_/);

  // an ordinary approval: same verb and args agent-ops.sh checks, pushed to the phone with Approve/Reject
  const a = (await api('GET', '/api/approvals/' + t.approvalId, undefined, phone)).body;
  assert.deepEqual([a.verb, a.args, a.reason, a.source, a.status], ['restart-container', ['shop'], 'Shop answers 502 since 09:10', 'lina', 'pending']);
  assert.ok(db.get('SELECT id FROM notifications WHERE ref = ?', 'approval:' + t.approvalId));
  assert.ok(!(await queue()).includes(t.id), 'not ready before Kevin says yes');
  assert.equal((await api('POST', `/api/tasks/${t.id}/start`, undefined, hermes)).status, 409);

  assert.equal((await api('POST', `/api/approvals/${t.approvalId}/approve`, undefined, phone)).status, 200);
  assert.equal((await api('GET', '/api/tasks/' + t.id, undefined, phone)).body.status, 'queued');
  const q = (await api('GET', '/api/tasks/queue', undefined, hermes)).body.tasks;
  assert.deepEqual(q.map(x => [x.id, x.approvalId, x.params.verb]), [[t.id, t.approvalId, 'restart-container']]);

  const s = await api('POST', `/api/tasks/${t.id}/start`, undefined, hermes);
  assert.equal(s.body.status, 'running');
  assert.equal((await api('POST', `/api/tasks/${t.id}/start`, undefined, hermes)).status, 409, 'starts once');
  assert.ok(!(await queue()).includes(t.id));

  // the main server's agent-ops.sh burns the approval when it runs the verb: no second prompt for Kevin
  assert.equal((await api('POST', `/api/approvals/${t.approvalId}/consume`, undefined, runner)).status, 200);
  assert.equal((await api('POST', `/api/tasks/${t.id}/progress`, { note: 'Container restarted, waiting for health' }, hermes)).status, 200);
  const f = await api('POST', `/api/tasks/${t.id}/finish`, { status: 'done', result: 'shop is Up, health 200', links: { url: 'https://shop.example.ch' } }, hermes);
  assert.equal(f.status, 200);
  assert.deepEqual([f.body.status, f.body.result, f.body.links.url, f.body.progress.length], ['done', 'shop is Up, health 200', 'https://shop.example.ch', 1]);
  assert.equal((await api('POST', `/api/tasks/${t.id}/finish`, { status: 'failed', result: 'again' }, hermes)).status, 409);

  const n = db.get('SELECT title, body, kind FROM notifications WHERE ref = ?', 'task:' + t.id);
  assert.deepEqual([n.title, n.body, n.kind], ['Hermes · done: Restart the shop container', 'shop is Up, health 200', 'agent']);
});

test('read verbs need no approval and are queued straight away', async () => {
  const t = (await api('POST', '/api/tasks', { kind: 'server-op', title: 'Check docker on the main server', params: { verb: 'docker' } }, phone)).body;
  assert.deepEqual([t.status, t.approvalId, t.params.args], ['queued', null, []]);
  assert.ok((await queue()).includes(t.id));
});

test('rejected or expired: never ready, never startable', async () => {
  const t = (await restart()).body;
  await api('POST', `/api/approvals/${t.approvalId}/reject`, undefined, phone);
  assert.equal((await api('GET', '/api/tasks/' + t.id, undefined, phone)).body.status, 'rejected');
  assert.ok(!(await queue()).includes(t.id));
  assert.equal((await api('POST', `/api/tasks/${t.id}/start`, undefined, hermes)).status, 409);

  const e = (await restart()).body;
  db.run('UPDATE approvals SET expires_at = ? WHERE id = ?', Date.now() - 1, e.approvalId);
  assert.equal((await api('GET', '/api/tasks/' + e.id, undefined, phone)).body.status, 'expired');
  assert.equal((await api('POST', `/api/tasks/${e.id}/cancel`, undefined, phone)).status, 409, 'already over');
});

test('cancel withdraws the approval, even one that already came through', async () => {
  const pending = (await restart()).body;
  assert.equal((await api('POST', `/api/tasks/${pending.id}/cancel`, undefined, phone)).body.status, 'cancelled');
  assert.equal((await api('GET', '/api/approvals/' + pending.approvalId, undefined, phone)).body.status, 'rejected', 'phone card goes away');

  const approved = (await restart()).body;
  await api('POST', `/api/approvals/${approved.approvalId}/approve`, undefined, phone);
  await api('POST', `/api/tasks/${approved.id}/cancel`, undefined, phone);
  assert.equal((await api('POST', `/api/approvals/${approved.approvalId}/consume`, undefined, runner)).status, 409, 'its id no longer runs the verb');
  assert.equal((await api('POST', `/api/tasks/${approved.id}/start`, undefined, hermes)).status, 409);

  const running = (await api('POST', '/api/tasks', { kind: 'server-op', title: 'Look at the web logs', params: { verb: 'web' } }, phone)).body;
  await api('POST', `/api/tasks/${running.id}/start`, undefined, hermes);
  await api('POST', `/api/tasks/${running.id}/cancel`, undefined, phone);
  assert.equal((await api('POST', `/api/tasks/${running.id}/progress`, { note: 'still going' }, hermes)).status, 409, 'worker learns to stop');
});

test('scopes: apps create and cancel, Hermes works only his own tasks', async () => {
  const body = { kind: 'server-op', title: 'Check pm2', params: { verb: 'pm2' } };
  assert.equal((await api('POST', '/api/tasks', body, hermes)).status, 403, 'an agent cannot hand itself work');
  assert.equal((await api('GET', '/api/tasks', undefined, hermes)).status, 403);
  assert.equal((await api('GET', '/api/tasks/queue', undefined, phone)).status, 403);
  assert.equal((await api('GET', '/api/tasks', undefined, null)).status, 401);

  const t = (await api('POST', '/api/tasks', body, phone)).body;
  assert.equal((await api('POST', `/api/tasks/${t.id}/start`, undefined, phone)).status, 403);
  assert.equal((await api('POST', `/api/tasks/${t.id}/cancel`, undefined, hermes)).status, 403);
  await api('POST', `/api/tasks/${t.id}/start`, undefined, hermes);
  assert.equal((await api('POST', `/api/tasks/${t.id}/finish`, { status: 'done', result: 'x' }, runner)).status, 403, 'only the worker that started it');

  const code = (await api('POST', '/api/tasks', { kind: 'coding', title: 'Fix the failing sync test', params: { project: 'life-os', prompt: 'Make server/test/api.test.js pass again' } }, phone)).body;
  // the box relays coding tasks to Workbench, so its token may read them; Hermes's own queue never lists them
  assert.equal((await api('GET', '/api/tasks/' + code.id, undefined, hermes)).status, 200);
  const job = (await api('POST', '/api/tasks', { kind: 'job', title: 'Refresh the calendar', params: { job: 'calendar' } }, phone)).body;
  assert.equal((await api('GET', '/api/tasks/' + job.id, undefined, hermes)).status, 404, 'server jobs are nobody else’s');
  assert.equal((await api('GET', '/api/tasks/queue?target=server', undefined, hermes)).status, 400);
});

test('coding tasks: one approval, then the Workbench queue, never the Hermes queue', async () => {
  const t = (await api('POST', '/api/tasks', { kind: 'coding', title: 'Add CSV export', params: { project: 'nextup', prompt: 'Add a CSV export to the stats page', agent: 'codex', profile: 'cheap' } }, phone)).body;
  assert.deepEqual([t.target, t.status, t.params.agent, t.params.profile], ['workbench', 'awaiting_approval', 'codex', 'cheap']);
  const a = (await api('GET', '/api/approvals/' + t.approvalId, undefined, phone)).body;
  assert.deepEqual([a.verb, a.args], ['coding-session', ['nextup', 'codex']]);
  const wbQueue = async () => (await api('GET', '/api/tasks/queue?target=workbench', undefined, hermes)).body.tasks.map(x => x.id);
  assert.ok(!(await wbQueue()).includes(t.id), 'not before the OK');
  await api('POST', `/api/approvals/${t.approvalId}/approve`, undefined, phone);
  assert.equal((await api('GET', '/api/tasks/' + t.id, undefined, phone)).body.status, 'queued');
  assert.ok(!(await queue()).includes(t.id));
  assert.ok((await wbQueue()).includes(t.id));

  // the relay starts it (that burns the approval: one OK, one session), reports the device and the PR
  assert.equal((await api('POST', `/api/tasks/${t.id}/start`, undefined, hermes)).body.status, 'running');
  assert.equal((await api('GET', '/api/approvals/' + t.approvalId, undefined, phone)).body.status, 'used');
  await api('POST', `/api/tasks/${t.id}/progress`, { note: 'Started on PC (desktop-oe7cumo) · branch ws/add-csv-export' }, hermes);
  const f = await api('POST', `/api/tasks/${t.id}/finish`, { status: 'done', result: 'done · 2 commits ahead of main', links: { pr: 'https://github.com/selluxhenner/nextup/pull/7', device: 'PC (desktop-oe7cumo)' } }, hermes);
  assert.deepEqual([f.status, f.body.links.device], [200, 'PC (desktop-oe7cumo)']);

  const bad = { kind: 'coding', title: 'Bad agent', params: { project: 'nextup', prompt: 'Something long enough', agent: 'gpt' } };
  assert.equal((await api('POST', '/api/tasks', bad, phone)).status, 400);
});

test('Lina decides approvals only in Kevin’s conversations: her tasks and Hermes’s own', async () => {
  const { TOOLS } = await import('../src/agent/tools.js');
  const t = (await api('POST', '/api/tasks', { kind: 'coding', title: 'Fix the sync test', params: { project: 'life-os', prompt: 'Make the sync test pass again' } }, phone)).body;
  await assert.rejects(async () => TOOLS.decide_approval.run({ id: t.id, decision: 'approve' }, { trigger: 'watch' }), /Only Kevin decides/);
  await assert.rejects(async () => TOOLS.decide_approval.run({ id: t.id, decision: 'approve' }, { trigger: 'meeting-prep' }), /Only Kevin decides/);
  const ok = TOOLS.decide_approval.run({ id: t.id, decision: 'approve' }, { trigger: 'chat' });
  assert.deepEqual([ok.id, ok.status], [t.id, 'queued']);
  assert.equal(db.get('SELECT decided_by FROM approvals WHERE id = ?', t.approvalId).decided_by, 'lina-chat');
  assert.throws(() => TOOLS.decide_approval.run({ id: t.id, decision: 'approve' }, { trigger: 'chat' }), /Task is queued/);

  const asked = (await api('POST', '/api/approvals', { verb: 'prune-docker', args: [], reason: 'disk at 91 %' }, hermes)).body;
  const { tasksContext } = await import('../src/agent/context.js');
  assert.match(tasksContext(), new RegExp(`${asked.id} \\| prune-docker \\| disk at 91 %`), 'Lina sees what Hermes waits for');
  const no = TOOLS.decide_approval.run({ id: asked.id, decision: 'reject' }, { trigger: 'voice' });
  assert.deepEqual([no.verb, no.status], ['prune-docker', 'rejected']);
});

test('validation: only real verbs, safe args, allowed jobs', async () => {
  const bad = [
    { kind: 'server-op', title: 'Wipe it', params: { verb: 'rm-rf' } },
    { kind: 'server-op', title: 'Sneaky args', params: { verb: 'restart-container', args: ['shop; reboot'] } },
    { kind: 'coding', title: 'No prompt', params: { project: 'life-os' } },
    { kind: 'coding', title: 'Bad project', params: { project: '../etc', prompt: 'something long enough' } },
    { kind: 'job', title: 'Clean up', params: { job: 'maintenance' } },
    { kind: 'launch-missiles', title: 'No', params: {} },
    { kind: 'job', title: '', params: { job: 'hub' } }
  ];
  for (const b of bad) assert.equal((await api('POST', '/api/tasks', b, phone)).status, 400, JSON.stringify(b));
});

test('server jobs run here without approval; only failures push', async () => {
  const t = (await api('POST', '/api/tasks', { kind: 'job', title: 'Refresh the calendar', params: { job: 'calendar' } }, phone)).body;
  assert.equal(t.target, 'server');
  assert.equal(t.approvalId, null);
  await serverRun(t.id);
  const done = (await api('GET', '/api/tasks/' + t.id, undefined, phone)).body;
  assert.ok(['done', 'failed'].includes(done.status), done.status);
  assert.match(done.result, /^calendar: /);
  assert.equal(done.worker, 'server');
  assert.ok(db.get("SELECT 1 AS x FROM job_runs WHERE job = 'calendar' AND slot = ?", 'task-' + t.id));
  if (done.status === 'done') assert.equal(db.get('SELECT id FROM notifications WHERE ref = ?', 'task:' + t.id), undefined);
});

test('hub state lists active tasks for the apps, not for ops tokens', async () => {
  const t = (await restart()).body;
  const mine = (await api('GET', '/api/hub/state', undefined, phone)).body;
  assert.ok(mine.tasks.some(x => x.id === t.id && x.status === 'awaiting_approval'));
  assert.ok(mine.tasks.every(x => ['awaiting_approval', 'queued', 'running'].includes(x.status)));
  assert.equal((await api('GET', '/api/hub/state', undefined, hermes)).body.tasks, undefined);
});

test('Lina: start_task only in Kevin’s conversations, task_status and cancel_task follow it', async () => {
  const { TOOLS } = await import('../src/agent/tools.js');
  assert.equal(TOOLS.start_task.risk, 'internal', 'the task’s own approval gates it, not a second queue');
  const input = { kind: 'server-op', title: 'Renew the shop certificate', params: { verb: 'renew-cert', args: ['shop.example.ch'] } };

  const r = await TOOLS.start_task.run(input, { trigger: 'voice' });
  assert.deepEqual([r.status, r.target], ['awaiting_approval', 'hermes']);
  assert.match(r.note, /OK/);
  const full = (await api('GET', '/api/tasks/' + r.id, undefined, phone)).body;
  assert.equal(full.source, 'voice');
  assert.equal(r.approvalId, undefined, 'Lina never sees approval ids');

  // a background run reads outside text (mail, Slack): it must not hand out work because of it
  await assert.rejects(TOOLS.start_task.run(input, { trigger: 'prep' }), /only started when Kevin asks/);
  await assert.rejects(TOOLS.start_task.run({ ...input, params: { verb: 'rm-rf' } }, { trigger: 'chat' }), /params\.verb/);

  const s = TOOLS.task_status.run({ id: r.id });
  assert.deepEqual([s.id, s.status], [r.id, 'awaiting_approval']);
  assert.ok(TOOLS.task_status.run({ active: true }).some(t => t.id === r.id));

  const c = TOOLS.cancel_task.run({ id: r.id });
  assert.equal(c.status, 'cancelled');
  assert.equal((await api('GET', '/api/approvals/' + full.approvalId, undefined, phone)).body.status, 'rejected');
  assert.throws(() => TOOLS.cancel_task.run({ id: r.id }), /cancelled/);
});
