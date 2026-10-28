// GitHub stats for the Hub tab, against a mocked GitHub API. Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-gh-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-gh-data-'));
process.env.PUBLIC_URL = 'http://test.local';
process.env.NO_SCHEDULER = '1';
process.env.GITHUB_TOKEN = 'gh-main';
process.env.GITHUB_API_URL = 'http://gh.test';

let app, gh, calls = [], fail = new Set();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('http://gh.test')) return realFetch(url, opts);
  const body = JSON.parse(opts.body);
  calls.push({ auth: opts.headers.Authorization, ...body.variables });
  if (fail.has(body.variables.login)) return new Response(JSON.stringify({ data: { owner: null }, errors: [{ message: 'Could not resolve to a RepositoryOwner' }] }));
  return new Response(JSON.stringify({ data: {
    owner: { url: 'https://github.com/' + body.variables.login, repositories: { totalCount: 12, nodes: [{ name: 'hub', url: 'https://github.com/x/hub', pushedAt: '2026-10-28T10:00:00Z', isPrivate: true }] } },
    person: body.variables.user ? { contributionsCollection: { contributionCalendar: { totalContributions: 321 } } } : undefined,
    prs: { issueCount: 3 }, issues: { issueCount: 7 }
  } }));
};

before(async () => {
  const dbm = await import('../src/db.js');
  dbm.migrate();
  ({ app } = await import('../src/app.js'));
  gh = await import('../src/hub/github.js');
});

const get = async (path, token = 'test-master-token') => {
  const res = await app.fetch(new Request('http://test.local' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }));
  return { status: res.status, body: await res.json() };
};

test('stats per account: user and orgs, Elaria waits for its own login and token', async () => {
  const { status, body } = await get('/api/hub/github');
  assert.equal(status, 200);
  const by = Object.fromEntries(body.accounts.map(a => [a.key, a]));
  assert.deepEqual(Object.keys(by), ['personal', 'nextup', 'ses', 'elaria']);
  assert.equal(by.personal.repos, 12);
  assert.equal(by.personal.contributions30d, 321);
  assert.equal(by.nextup.contributions30d, null, 'orgs have no contributions');
  assert.deepEqual([by.ses.openPrs, by.ses.openIssues], [3, 7]);
  assert.equal(by.ses.url, 'https://github.com/SwissEduSolution-GmbH');
  assert.equal(by.elaria.configured, false);
  assert.ok(!JSON.stringify(body).includes('gh-main'), 'the token never reaches the apps');
  const ses = calls.find(c => c.login === 'SwissEduSolution-GmbH');
  assert.match(ses.prs, /is:pr is:open .*org:SwissEduSolution-GmbH/);
  assert.equal(calls.find(c => c.login === 'selluxhenner').auth, 'Bearer gh-main');
});

test('results are cached; one failing account does not break the others', async () => {
  const before = calls.length;
  await get('/api/hub/github');
  assert.equal(calls.length, before, 'second call comes from the cache');
  fail.add('nextup-de');
  const { body } = await get('/api/hub/github?fresh=1');
  const nextup = body.accounts.find(a => a.key === 'nextup');
  assert.match(nextup.error, /Could not resolve/);
  assert.equal(body.accounts.find(a => a.key === 'personal').repos, 12);
  fail.clear();
});

test('only the apps can read GitHub stats', async () => {
  const ops = (await app.fetch(new Request('http://test.local/api/devices/pair', { method: 'POST',
    headers: { Authorization: 'Bearer test-master-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'agent-box', platform: 'linux', scope: 'ops' }) })).then(r => r.json())).token;
  assert.equal((await get('/api/hub/github', ops)).status, 403);
  assert.equal((await get('/api/hub/github', null)).status, 401);
  gh.resetGithubCache();
});
