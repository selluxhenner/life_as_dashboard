// GitHub stats for the Hub tab: per account or org the repo count, open PRs and issues, contributions in the last
// 30 days (people only) and the repos pushed most recently. One GraphQL call per account, cached for 10 minutes.
// Tokens only ever go to the GitHub API; the apps get numbers and links.
import { config } from '../config.js';

const CACHE_MS = 10 * 60000;

/* The accounts on the Hub tab. kind decides the search qualifier (user: / org:) and whether contributions exist. */
export function accounts() {
  const { token, elaria } = config.github;
  return [
    { key: 'personal', label: 'Personal', login: 'selluxhenner', kind: 'user', token },
    { key: 'nextup', label: 'nextup', login: 'nextup-de', kind: 'org', token },
    { key: 'ses', label: 'SwissEduSolution', login: 'SwissEduSolution-GmbH', kind: 'org', token },
    { key: 'elaria', label: 'Elaria', login: elaria.login, kind: 'user', token: elaria.token }
  ];
}

const QUERY = `query($login: String!, $prs: String!, $issues: String!, $user: Boolean!, $from: DateTime!) {
  owner: repositoryOwner(login: $login) {
    url
    repositories(first: 5, orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      nodes { name url pushedAt isPrivate }
    }
  }
  person: user(login: $login) @include(if: $user) { contributionsCollection(from: $from) { contributionCalendar { totalContributions } } }
  prs: search(query: $prs, type: ISSUE) { issueCount }
  issues: search(query: $issues, type: ISSUE) { issueCount }
}`;

async function fetchAccount(a) {
  const q = (a.kind === 'org' ? 'org:' : 'user:') + a.login;
  const res = await fetch(config.github.api + '/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json', 'User-Agent': 'agentic-os-hub' },
    body: JSON.stringify({ query: QUERY, variables: { login: a.login, prs: `is:pr is:open archived:false ${q}`, issues: `is:issue is:open archived:false ${q}`,
      user: a.kind === 'user', from: new Date(Date.now() - 30 * 86400000).toISOString() } }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('GitHub ' + res.status);
  const { data, errors } = await res.json();
  if (!data || !data.owner) throw new Error((errors && errors[0] && errors[0].message) || 'no access');
  return {
    repos: data.owner.repositories.totalCount,
    openPrs: data.prs.issueCount,
    openIssues: data.issues.issueCount,
    contributions30d: data.person ? data.person.contributionsCollection.contributionCalendar.totalContributions : null,
    recent: data.owner.repositories.nodes.map(r => ({ name: r.name, url: r.url, pushedAt: Date.parse(r.pushedAt), private: r.isPrivate }))
  };
}

let cache = { at: 0, data: null };

/** Stats for every account. An account without a login or token comes back as configured: false. */
export async function githubStats({ fresh = false } = {}) {
  if (!fresh && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const list = await Promise.all(accounts().map(async a => {
    const base = { key: a.key, label: a.label, login: a.login || null, kind: a.kind, url: a.login ? 'https://github.com/' + a.login : null };
    if (!a.login || !a.token) return { ...base, configured: false };
    try { return { ...base, configured: true, ...(await fetchAccount(a)) }; }
    catch (e) { return { ...base, configured: true, error: e.message.slice(0, 120) }; }
  }));
  cache = { at: Date.now(), data: { accounts: list, at: Date.now() } };
  return cache.data;
}

export const resetGithubCache = () => { cache = { at: 0, data: null }; };
