// Hub: the other machines at a glance. Paired devices, the agent box's reports, and the server actions Hermes
// wants to run and waits for a yes on (GET /api/hub/state, POST /api/approvals/:id/approve|reject).
import { h } from '../core/dom.js';
import { fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, empty, chip } from '../components/ui.js';
import { api, errorText } from '../core/api.js';
import { remote, refresh } from '../core/remote.js';
import { icon } from '../core/icons.js';
import { toast } from '../core/fx.js';
import { serverPulse } from './ops.js';

// Workbench on the home PC, reachable inside the tailnet only (tailscale serve on port 3917)
const WORKBENCH_URL = 'https://kev-pc.tailb66bb7.ts.net';
const PLATFORM = { android: 'Phone', windows: 'Windows', macos: 'Mac', linux: 'Server', web: 'Browser' };

/* Admin pages and tools. A link without url shows as "later" (Elaria's admin is not live yet). */
const ADMIN = [
  { label: 'SwissEduSolution', sub: 'Platform customers (signs in via auth.swissedusolution.cloud)', url: 'https://admin.swissedusolution.cloud/platform/customers' },
  { label: 'nextup', sub: 'admin.sellux.ch', url: 'https://admin.sellux.ch/login' },
  { label: 'School Companion', sub: 'admin.schoolcompanion.ch', url: 'https://admin.schoolcompanion.ch/dashboard' },
  { label: 'Elaria', sub: 'Admin not set up yet', url: null }
];
const TOOLS = [
  { label: 'Workbench', sub: 'Home PC · Tailscale only', url: WORKBENCH_URL },
  { label: 'Hermes dashboard', sub: 'agent-box · Tailscale only', url: 'https://agent-box.tailb66bb7.ts.net' },
  { label: 'Hub board', sub: 'GitHub project: what is next', url: 'https://github.com/users/selluxhenner/projects/2' }
];

export const githubData = () => remote('github', '/api/hub/github', 10 * 60000);
export const hubState = () => remote('hub', '/api/hub/state', 60000);
export const pendingApprovalCount = () => (((hubState().data || {}).approvals) || []).length;

const expiresIn = at => {
  const min = Math.max(1, Math.round((at - Date.now()) / 60000));
  return 'expires in ' + (min >= 60 ? Math.round(min / 60) + ' h' : min + ' min');
};

function approvals(items, connected) {
  const decide = async (a, ok) => {
    try {
      await api.post(`/api/approvals/${a.id}/${ok ? 'approve' : 'reject'}`);
      toast(ok ? 'Approved' : 'Rejected', ok ? 'pulse' : 'ink-3');
    } catch (e) { toast(errorText(e), 'flare'); }
    refresh('hub', '/api/hub/state');
  };
  return panel({ title: 'Hermes asks', readout: items.length ? h('span', h('b', String(items.length)), ' pending') : '' },
    !connected ? empty('Not connected', 'Pair this device in Settings to see what the agent box wants to do.')
      : items.length ? h('div.approvals', items.map(a => h('article.approval',
          h('div.ap-head', chip(a.verb, 'warn'), h('span.data.muted', expiresIn(a.expiresAt))),
          h('div.ap-summary', a.reason),
          a.args.length ? h('pre.ap-preview', a.args.join(' ')) : null,
          h('div.input-row', h('button.btn.primary', { type: 'button', onclick: () => decide(a, true) }, 'Approve'),
            h('button.btn.ghost', { type: 'button', onclick: () => decide(a, false) }, 'Reject')))))
      : empty('All clear', 'Hermes asks here, and on Telegram, before it restarts or deploys anything.'));
}

function devices(list) {
  return panel({ title: 'Devices', readout: h('span', h('b', String(list.filter(d => d.online).length)), ' of ' + list.length + ' online') },
    list.length ? h('div.rows', list.map(d => h('div.row',
      h('span', { class: 'status-dot ' + (d.online ? 'done' : 'idle') }),
      h('div.grow', h('div.title', d.name + (d.current ? ' · this device' : '')),
        h('div.sub', [PLATFORM[d.platform] || d.platform || 'Device', d.scope === 'ops' ? 'agent' : null, d.lastSeenAt ? 'seen ' + fmt.ago(d.lastSeenAt) : 'never seen'].filter(Boolean).join(' · '))),
      d.online ? chip('online', 'ok') : chip('offline', null, 'plain'))))
      : empty('No devices', 'Paired devices show up here.'));
}

const linkRows = list => h('div.rows', list.map(l => l.url
  ? h('a.row', { href: l.url, target: '_blank', rel: 'noopener' }, h('div.grow', h('div.title', l.label), h('div.sub', l.sub)), icon('ext'))
  : h('div.row.later', h('div.grow', h('div.title', l.label), h('div.sub', l.sub)), chip('later', null, 'plain'))));

const search = (a, q) => 'https://github.com/search?type=pullrequests&q=' + encodeURIComponent(q + ' ' + (a.kind === 'org' ? 'org:' : 'user:') + a.login);

function github() {
  const { data, error } = githubData();
  const list = (data && data.accounts) || [];
  return panel({ title: 'GitHub', readout: data ? 'updated ' + fmt.ago(data.at) : '' },
    !list.length ? empty(error ? 'Could not load GitHub' : 'Loading', error ? errorText(error) : null)
      : h('div.rows', list.map(a => {
          const head = h('div.title', a.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.label) : a.label, a.login ? h('span.dim', ' · ' + a.login) : null);
          if (!a.configured) return h('div.row.later', h('div.grow', head, h('div.sub', 'Needs a login and read-only token on the server')), chip('later', null, 'plain'));
          if (a.error) return h('div.row', h('div.grow', head, h('div.sub', a.error)), chip('no access', 'alert'));
          const newest = a.recent[0];
          return h('div.row.gh-account',
            h('div.grow', head,
              h('div.sub', [a.repos + ' repos', a.contributions30d != null ? a.contributions30d + ' contributions in 30 days' : null,
                newest ? 'last push ' + newest.name + ' ' + fmt.ago(newest.pushedAt) : null].filter(Boolean).join(' · '))),
            h('a.chip' + (a.openPrs ? '.signal' : ''), { href: search(a, 'is:pr is:open'), target: '_blank', rel: 'noopener', title: 'Open pull requests' }, a.openPrs + ' PRs'),
            h('a.chip.plain', { href: search(a, 'is:issue is:open').replace('pullrequests', 'issues'), target: '_blank', rel: 'noopener', title: 'Open issues' }, a.openIssues + ' issues'));
        })));
}

export default {
  id: 'hub',
  render(root) {
    const { data, connected } = hubState();
    const s = data || { devices: [], approvals: [] };
    root.append(h('div.view.hub',
      viewHead('Hub', 'Your devices, the agent box and the server in one place. Hermes only changes the server after you approve it here or on Telegram.',
        h('a.btn.ghost', { href: WORKBENCH_URL, target: '_blank', rel: 'noopener', title: 'Needs Tailscale on this device' }, icon('agent'), 'Open Workbench')),
      h('div.grid.g-2',
        h('div.stack', approvals(s.approvals, connected), devices(s.devices),
          panel({ title: 'Admin pages' }, linkRows(ADMIN)),
          panel({ title: 'Tools' }, linkRows(TOOLS))),
        h('div.stack', serverPulse(), github()))));
  }
};
