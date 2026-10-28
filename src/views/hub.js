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

export default {
  id: 'hub',
  render(root) {
    const { data, connected } = hubState();
    const s = data || { devices: [], approvals: [] };
    root.append(h('div.view.hub',
      viewHead('Hub', 'Your devices, the agent box and the server in one place. Hermes only changes the server after you approve it here or on Telegram.',
        h('a.btn.ghost', { href: WORKBENCH_URL, target: '_blank', rel: 'noopener', title: 'Needs Tailscale on this device' }, icon('agent'), 'Open Workbench')),
      h('div.grid.g-2',
        h('div.stack', approvals(s.approvals, connected), devices(s.devices)),
        h('div.stack', serverPulse()))));
  }
};
