// Hub registry: pulled from the hub repo, each service's health checked, state shown on the Hub tab. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-reg-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-reg-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';
process.env.GITHUB_TOKEN = 'gh-read';
process.env.GITHUB_API_URL = 'http://gh.test';

const PROJECTS = `projects:
  - id: life-os
    name: LIFE OS
    repo: selluxhenner/life_as_dashboard
    runs_on: [hetzner-main]
    health: http://up.test/api/health
  - id: workbench
    name: Workbench
    health: http://kev-pc:3917/health
  - id: broken
    name: Broken site
    health: http://down.test/
  - id: hub
    name: Hub
    health: null
`;
const DEVICES = `devices:
  - name: kev-laptop
    os: windows
    role: laptop
  - name: kev-mac
    os: macos
    status: planned
`;

let app, reg, githubCalls = [], failGithub = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://gh.test')) {
    githubCalls.push({ url, auth: opts.headers.Authorization });
    if (failGithub) return new Response('nope', { status: 404 });
    return new Response(url.includes('projects.yaml') ? PROJECTS : DEVICES);
  }
  if (url.startsWith('http://up.test')) return new Response('{"ok":true}');
  if (url.startsWith('http://down.test')) return new Response('bad gateway', { status: 502 });
  if (url.startsWith('http://kev-pc')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  return realFetch(url, opts);
};

before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate();
  ({ app } = await import('../src/app.js'));
  reg = await import('../src/hub/registry.js');
});

const api = async (method, path, token = 'test-master-token') => {
  const res = await app.fetch(new Request('http://test.local' + path, { method, headers: { Authorization: 'Bearer ' + token } }));
  return { status: res.status, body: await res.json() };
};

test('the registry is pulled from the hub repo and every service is checked', async () => {
  const r = await api('POST', '/api/hub/refresh');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.pulled, r.body.projects, r.body.up], [true, 4, 1]);
  assert.ok(githubCalls.some(c => c.url.includes('/repos/selluxhenner/hub/contents/projects.yaml?ref=main') && c.auth === 'Bearer gh-read'));
  const s = (await api('GET', '/api/hub/state')).body.registry;
  const by = Object.fromEntries(s.services.map(x => [x.id, x]));
  assert.equal(by['life-os'].status, 'up');
  assert.equal(by.broken.status, 'down');
  assert.equal(by.broken.code, 502);
  assert.equal(by.workbench.status, 'unreachable', 'tailnet-only hosts are unreachable from a server outside the tailnet');
  assert.equal(by.hub.status, 'none');
  assert.deepEqual(s.devices.map(d => [d.name, d.status]), [['kev-laptop', 'active'], ['kev-mac', 'planned']]);
  assert.ok(existsSync(join(process.env.DATA_DIR, 'hub-registry.json')), 'kept on disk for the next start');
});

test('when GitHub fails, the last registry stays and the error is shown', async () => {
  failGithub = true;
  const r = await api('POST', '/api/hub/refresh');
  assert.equal(r.body.pulled, false);
  assert.match(r.body.error, /GitHub 404/);
  const s = (await api('GET', '/api/hub/state')).body.registry;
  assert.equal(s.services.length, 4, 'services from the last good pull are still checked');
  assert.match(s.error, /GitHub 404/);
  failGithub = false;
});

test('a restart reads the registry from disk; only the apps can trigger a check', async () => {
  reg.resetRegistry();
  assert.equal(reg.registryState().services.length, 4);
  const ops = (await app.fetch(new Request('http://test.local/api/devices/pair', { method: 'POST',
    headers: { Authorization: 'Bearer test-master-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'agent-box', platform: 'linux', scope: 'ops' }) })).then(r => r.json())).token;
  assert.equal((await api('POST', '/api/hub/refresh', ops)).status, 403);
  assert.equal((await api('GET', '/api/hub/state', ops)).body.registry.services.length, 4, 'Hermes can read the service list');
});
