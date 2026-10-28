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
import { linaApprovals, agentActivity, pendingActions } from './assistant.js';

// Workbench on the home PC, reachable inside the tailnet only (tailscale serve on port 3917)
const WORKBENCH_URL = 'https://kev-pc.tailb66bb7.ts.net';
const PLATFORM = { android: 'Phone', laptop: 'Laptop', desktop: 'Desktop', windows: 'Windows', macos: 'Mac', linux: 'Server', web: 'Browser' };

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
/* The Hub badge: Hermes's server actions plus Lina's invites and emails, everything waiting for a yes. */
export const pendingApprovalCount = () => (((hubState().data || {}).approvals) || []).length + (((pendingActions().data || {}).actions) || []).length;

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

/* Browsers are temporary (the server revokes them after two weeks idle): listed under the devices, not counted. */
function devices(list) {
  const kept = list.filter(d => !d.temporary), temp = list.filter(d => d.temporary);
  const row = d => h('div.row',
    h('span', { class: 'status-dot ' + (d.online ? 'done' : 'idle') }),
    h('div.grow', h('div.title', d.name + (d.current ? ' · this device' : '')),
      h('div.sub', [PLATFORM[d.platform] || d.platform || 'Device', d.scope === 'ops' ? 'agent' : null, d.lastSeenAt ? 'seen ' + fmt.ago(d.lastSeenAt) : 'never seen'].filter(Boolean).join(' · '))),
    d.online ? chip('online', 'ok') : chip('offline', null, 'plain'));
  return panel({ title: 'Devices', readout: h('span', h('b', String(kept.filter(d => d.online).length)), ' of ' + kept.length + ' online') },
    kept.length ? h('div.rows', kept.map(row)) : empty('No devices', 'Paired devices show up here.'),
    temp.length ? h('div', h('div.sub', { style: { margin: '12px 0 4px' } }, 'Temporary · browsers, removed after 2 weeks idle'), h('div.rows', temp.map(row))) : null);
}

const linkRows = list => h('div.rows', list.map(l => l.url
  ? h('a.row', { href: l.url, target: '_blank', rel: 'noopener' }, h('div.grow', h('div.title', l.label), h('div.sub', l.sub)), icon('ext'))
  : h('div.row.later', h('div.grow', h('div.title', l.label), h('div.sub', l.sub)), chip('later', null, 'plain'))));

const search = (a, q) => 'https://github.com/search?type=pullrequests&q=' + encodeURIComponent(q + ' ' + (a.kind === 'org' ? 'org:' : 'user:') + a.login);

/* Services from the hub registry (selluxhenner/hub), each with its last health check from the server. */
const SERVICE = { up: ['up', 'ok', 'done'], down: ['down', 'alert', 'error'], unreachable: ['no answer', 'warn', 'idle'], none: ['no check', null, 'idle'] };
function services(reg) {
  const list = (reg && reg.services) || [];
  const checked = list.filter(x => x.status !== 'none');
  const checkNow = async () => {
    try { const r = await api.post('/api/hub/refresh'); toast(r.error ? 'Registry: ' + r.error : `${r.up} of ${checked.length || r.projects} up`, r.error ? 'amber' : 'pulse'); }
    catch (e) { toast(errorText(e), 'flare'); }
    refresh('hub', '/api/hub/state');
  };
  return panel({ title: 'Services', readout: checked.length ? h('span', h('b', String(checked.filter(x => x.status === 'up').length)), ' of ' + checked.length + ' up') : '' },
    reg && reg.error ? h('div.hint', 'Registry: ' + reg.error) : null,
    list.length ? h('div.rows', list.map(x => {
      const [label, tone, dot] = SERVICE[x.status] || SERVICE.none;
      return h('div.row',
        h('span', { class: 'status-dot ' + dot }),
        h('div.grow', h('div.title', x.name),
          h('div.sub', [x.role, x.code ? 'HTTP ' + x.code : null, x.ms != null ? x.ms + ' ms' : null, x.checkedAt ? fmt.ago(x.checkedAt) : null].filter(Boolean).join(' · '))),
        chip(label, tone, tone ? '' : 'plain'));
    })) : empty('No registry yet', 'The server reads selluxhenner/hub every 15 minutes once its GitHub token is set.'),
    h('div.input-row', { style: { marginTop: '10px' } }, h('button.btn.sm.ghost', { type: 'button', onclick: checkNow }, icon('sync'), 'Check now')));
}

/* Questions Lina passed to Hermes ("Hey Lina, ask Hermes why …") and his answers. */
function hermesAsks() {
  const { data } = remote('hermesAsks', '/api/hermes/asks?limit=5', 2 * 60000);
  const list = (data && data.asks) || [];
  if (!list.length) return null;
  return panel({ title: 'Asked Hermes', readout: h('span', h('b', String(list.filter(a => a.status === 'open').length)), ' waiting') },
    h('div.rows', list.map(a => h('div.row.hermes-ask',
      h('div.grow', h('div.title', a.question),
        h('div.sub', a.answer || (a.pickedAt ? 'Hermes is on it…' : 'Waiting for Hermes to pick it up'))),
      h('span.data.muted', fmt.ago(a.answeredAt || a.createdAt))))));
}

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
    const lina = linaApprovals();
    root.append(h('div.view.hub',
      viewHead('Hub', 'Your devices, the agent box and the server in one place. Everything waiting for your yes is here: Hermes changes the server, Lina sends invites and emails only after you approve.',
        h('a.btn.ghost', { href: WORKBENCH_URL, target: '_blank', rel: 'noopener', title: 'Needs Tailscale on this device' }, icon('agent'), 'Open Workbench')),
      h('div.grid.g-2',
        h('div.stack', approvals(s.approvals, connected), lina, devices(s.devices),
          panel({ title: 'Admin pages' }, linkRows(ADMIN)),
          panel({ title: 'Tools' }, linkRows(TOOLS))),
        h('div.stack', services(s.registry), hermesAsks(), serverPulse(), github(), agentActivity()))));
  }
};
