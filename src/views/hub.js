// Hub: the other machines at a glance. Paired devices, the agent box's reports, the server actions Hermes wants to
// run and waits for a yes on (GET /api/hub/state, POST /api/approvals/:id/approve|reject), and the agent tasks Lina
// handed out (GET /api/tasks, POST /api/tasks/:id/cancel).
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
import { linaFeed, openInDeck } from './lina.js';
import { WORKBENCH_URL } from './workbench.js';

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

/* Agent tasks: what Lina (or you) handed to Hermes, Workbench or the server, from the ask to the result. A task waiting
   for your OK is decided right here; its approval is left out of "Hermes asks" so it doesn't show twice. */
const TASK_STATUS = {
  awaiting_approval: ['needs your OK', 'warn', '', ''], queued: ['queued', null, 'plain', ''], running: ['running', 'signal', 'live', 'running'],
  done: ['done', 'ok', '', 'done'], failed: ['failed', 'alert', '', 'error'], cancelled: ['cancelled', null, 'plain', ''],
  rejected: ['rejected', null, 'plain', ''], expired: ['expired', null, 'plain', '']
};
const WHO = { hermes: 'Hermes', workbench: 'Workbench', server: 'Server' };
const OPEN = ['awaiting_approval', 'queued', 'running'];
// where a task came from; lina-watch: Lina proposed it herself after an ops report or a service going down
const SOURCE = { 'lina-watch': 'proposed by Lina', voice: 'by voice', chat: 'from chat', phone: 'by phone', app: 'from the app' };
export const tasksData = () => remote('tasks', '/api/tasks?limit=8', 60000);

function agentTasks(connected) {
  const { data } = tasksData();
  const list = (data && data.tasks) || [];
  const reload = () => { refresh('tasks', '/api/tasks?limit=8'); refresh('hub', '/api/hub/state'); };
  const act = async (path, done) => {
    try { await api.post(path); toast(done, 'pulse'); } catch (e) { toast(errorText(e), 'flare'); }
    reload();
  };
  const open = list.filter(t => OPEN.includes(t.status)).length;
  const card = t => {
    const [label, tone, cls, dot] = TASK_STATUS[t.status] || [t.status, null, 'plain', ''];
    const last = t.result || (t.progress.length ? t.progress[t.progress.length - 1].note : null);
    const link = t.links.pr || t.links.url;
    const what = t.kind === 'server-op' ? [t.params.verb, ...(t.params.args || [])].join(' ') : t.kind === 'job' ? 'job ' + t.params.job
      : `${t.params.agent === 'codex' ? 'Codex' : 'Claude'} in ${t.params.project}${t.links.device ? ' on ' + t.links.device : ''}`;
    return h('article.task' + (t.status === 'awaiting_approval' ? '.approval' : ''),
      h('div.ap-head', h('span.row-lead', h('span', { class: 'status-dot ' + dot }), h('b', t.title)), chip(t.stale ? 'no news for 2 h' : label, t.stale ? 'warn' : tone, cls)),
      h('div.task-sub', [WHO[t.target] || t.target, what, SOURCE[t.source] || t.source, fmt.ago(t.finishedAt || t.updatedAt)].filter(Boolean).join(' · ')),
      last ? h('div.task-result', last) : null,
      link ? h('a.task-link', { href: link, target: '_blank', rel: 'noopener' }, t.links.pr ? 'Pull request' : 'Open', icon('ext')) : null,
      t.status === 'awaiting_approval' && t.approvalId ? h('div.input-row',
        h('button.btn.primary', { type: 'button', onclick: () => act(`/api/approvals/${t.approvalId}/approve`, 'Approved') }, 'Approve'),
        h('button.btn.ghost', { type: 'button', onclick: () => act(`/api/tasks/${t.id}/cancel`, 'Cancelled') }, 'Reject'))
        : OPEN.includes(t.status) ? h('div.input-row', h('button.btn.sm.ghost', { type: 'button', onclick: () => act(`/api/tasks/${t.id}/cancel`, 'Cancelled') }, 'Cancel')) : null);
  };
  return panel({ title: 'Agent tasks', readout: open ? h('span', h('b', String(open)), ' open') : '' },
    !connected ? empty('Not connected', 'Pair this device in Settings to follow what Lina handed to the agents.')
      : list.length ? h('div.approvals', list.map(card))
      : empty('No tasks yet', 'Ask Lina to have something done: "restart the shop container", "fix the failing tests in nextup", "run the briefing now".'));
}

/* Browsers are temporary (the server revokes them after two weeks idle): listed under the devices, not counted. */
function devices(list) {
  const kept = list.filter(d => !d.temporary), temp = list.filter(d => d.temporary);
  // an on-call token (agent-ops.sh on the main server) is quiet until it acts: not offline, and not counted as missing
  const idleOnCall = d => d.onCall && !d.online;
  const row = d => h('div.row',
    h('span', { class: 'status-dot ' + (d.online ? 'done' : 'idle') }),
    h('div.grow', h('div.title', d.name + (d.current ? ' · this device' : '')),
      h('div.sub', [PLATFORM[d.platform] || d.platform || 'Device', d.scope === 'ops' ? 'agent' : null,
        d.lastSeenAt ? (d.onCall ? 'used ' : 'seen ') + fmt.ago(d.lastSeenAt) : d.onCall ? 'not used yet' : 'never seen'].filter(Boolean).join(' · '))),
    d.online ? chip('online', 'ok') : idleOnCall(d) ? chip('on call', null, 'plain') : chip('offline', null, 'plain'));
  const counted = kept.filter(d => !idleOnCall(d));
  return panel({ title: 'Devices', readout: h('span', h('b', String(counted.filter(d => d.online).length)), ' of ' + counted.length + ' online') },
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

/* Everything waiting for Kevin's yes in one place. When nothing is, one quiet line instead of three empty panels. */
function needsYou(s, connected) {
  const hermesItems = s.approvals.filter(a => a.source !== 'lina');
  const linaItems = ((pendingActions().data || {}).actions) || [];
  const taskItems = (((tasksData().data || {}).tasks) || []).filter(t => t.status === 'awaiting_approval');
  if (!connected || hermesItems.length + linaItems.length + taskItems.length) {
    return [taskItems.length ? agentTasks(connected) : null, hermesItems.length || !connected ? approvals(hermesItems, connected) : null, linaItems.length ? linaApprovals() : null];
  }
  return [h('div.hub-clear', h('span.status-dot.done'), h('div.grow', h('b', 'Nothing waiting for your yes.'),
    h('span.dim', ' Lina’s invites and emails, Hermes’s server changes and agent tasks that need an OK show up here.')))];
}

function workbenchCard(w) {
  if (w && w.link) return panel({ title: 'Workbench', readout: w.link.needs ? h('span', h('b', String(w.link.needs)), w.link.needs === 1 ? ' needs you' : ' need you') : 'nothing open' },
    h('div.rows', w.link.machines.map(m => h('div.row', h('span', { class: 'status-dot ' + (m.online ? 'done' : 'idle') }),
      h('div.grow', h('div.title', m.name), h('div.sub', m.online ? `${m.working} of ${m.total} lanes busy` : 'not connected right now')),
      m.now == null ? null : h('span.data', m.now + ' %')))),
    h('div.input-row', { style: { marginTop: '10px' } }, h('button.btn.sm', { type: 'button', onclick: () => openInDeck('workbench') }, 'Open Workbench page')));
  if (!w || !w.configured) return null;
  const DOT = { running: 'running', active: 'running', working: 'running', waiting: 'running', done: 'done', completed: 'done', failed: 'error', error: 'error' };
  return panel({ title: 'Workbench', readout: w.reachable ? h('span', h('b', String(w.active)), ' active') : 'not reachable' },
    w.plans && w.plans.length ? h('div.lina-plans', w.plans.slice(0, 5).map(p => h('div.plan',
      h('div.plan-head', h('span.title', p.title), h('span.data.muted', p.total ? `${p.done}/${p.total}` : p.state || '')),
      h('div.plan-bar', h('i', { style: { width: (p.total ? Math.round((p.done / p.total) * 100) : 0) + '%' } }))))) : null,
    w.sessions.length ? h('div.rows', w.sessions.map(x => h('div.row',
      h('span', { class: 'status-dot ' + (DOT[x.status] || 'idle') }),
      h('div.grow', h('div.title', x.title || x.project), h('div.sub', [x.project, x.branch, x.status, x.lastActivityAt ? fmt.ago(x.lastActivityAt) : null].filter(Boolean).join(' · '))))))
      : empty('No sessions', w.error || null));
}

/* What reached Lina lately, the same feed as on her deck. */
function liveFeed(data) {
  const list = ((data && data.events) || []).slice(0, 8);
  if (!list.length) return null;
  return panel({ title: 'Live', readout: data.unread ? h('span', h('b', String(data.unread)), ' new for Lina') : '' },
    h('div.feed', list.map(e => h('article.feed-item', { dataset: { level: e.level } },
      h('div.grow', h('div.feed-head', h('span.feed-src', e.source), h('span.data.muted', fmt.ago(e.at))),
        h('div.feed-title', e.title), e.body ? h('div.feed-body', e.body) : null)))));
}

export default {
  id: 'hub',
  render(root) {
    const { data, connected } = hubState();
    const s = data || { devices: [], approvals: [] };
    const feed = linaFeed().data;
    const snap = feed && feed.snapshot;
    const reg = s.registry;
    const hasServices = reg && reg.services && reg.services.length;
    root.append(h('div.view.hub',
      viewHead('Hub', 'Your devices, the agent box and the server in one place, and everything that waits for your yes.',
        h('a.btn.ghost', { href: WORKBENCH_URL, target: '_blank', rel: 'noopener', title: 'Needs Tailscale on this device' }, icon('agent'), 'Open Workbench')),
      h('div.hub-needs', ...needsYou(s, connected).filter(Boolean)),
      h('div.grid.g-2',
        h('div.stack', serverPulse(), liveFeed(feed), workbenchCard(snap && snap.workbench), hermesAsks(), devices(s.devices)),
        h('div.stack', hasServices || (reg && reg.error) ? services(reg) : null, agentActivity(), github(),
          (((tasksData().data || {}).tasks) || []).some(t => t.status !== 'awaiting_approval') ? agentTasks(connected) : null,
          panel({ title: 'Admin pages' }, linkRows(ADMIN)),
          panel({ title: 'Tools' }, linkRows(TOOLS))))));
  }
};
