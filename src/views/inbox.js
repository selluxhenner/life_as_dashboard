import { h } from '../core/dom.js';
import { notify } from '../core/store.js';
import { fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, empty, chip, seg, btn } from '../components/ui.js';
import { remote, refresh } from '../core/remote.js';
import { api } from '../core/api.js';
import { go } from '../core/router.js';
import { icon } from '../core/icons.js';

let account = 'all';
let slackTab = 'people';

export const emailData = () => remote('email', '/api/inbox/email', 3 * 60000);
export const slackData = () => remote('slack', '/api/inbox/slack', 3 * 60000);

const initials = s => (s || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');
const when = ms => {
  const d = new Date(ms), now = new Date();
  return d.toDateString() === now.toDateString() ? fmt.time(d) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function emailRow(m, color) {
  return h('a.mail' + (m.unread ? '.unread' : ''), { href: m.link || '#', target: '_blank', rel: 'noopener', style: { '--c': color || 'var(--signal)' } },
    h('span.avatar', initials(m.fromName || m.fromAddr)),
    h('div.mail-body',
      h('div.mail-top', h('span.mail-from', m.fromName || m.fromAddr), h('span.mail-when.data', when(m.receivedAt))),
      h('div.mail-subj', m.subject || '(no subject)'),
      h('div.mail-snip', m.aiSummary || m.snippet || '')),
    m.aiPriority === 'high' ? chip('important', 'alert') : m.aiCategory ? chip(m.aiCategory, null, 'plain') : null);
}

function slackRow(m) {
  return h('a.slack-msg', { href: m.permalink || '#', target: '_blank', rel: 'noopener' },
    m.avatar ? h('img.avatar', { src: m.avatar, alt: '' }) : h('span.avatar', initials(m.userName)),
    h('div.mail-body',
      h('div.mail-top', h('span.mail-from', m.userName || 'Someone'), m.channelName ? h('span.muted', ' in #' + m.channelName) : null, h('span.mail-when.data', when(m.ts))),
      h('div.mail-snip.slack-text', m.text)));
}

export function inboxPreview() {
  const { data } = emailData();
  const emails = (data && data.emails || []).filter(m => m.unread).slice(0, 3);
  return emails;
}

export default {
  id: 'inbox',
  render(root) {
    const e = emailData(), s = slackData();
    const accounts = (e.data && e.data.accounts) || [];
    const colorOf = Object.fromEntries(accounts.map(a => [a.account, a.color]));
    const emails = ((e.data && e.data.emails) || []).filter(m => account === 'all' || m.account === account);
    const unread = emails.filter(m => m.unread).length;
    const sd = s.data || {};
    const people = [...(sd.dms || []), ...(sd.mentions || [])].sort((a, b) => b.ts - a.ts);
    const reload = () => { refresh('email', '/api/inbox/email?live=1'); refresh('slack', '/api/inbox/slack?live=1'); };

    const mailPanel = panel({ title: 'Email', readout: h('span', h('b', String(unread)), ' unread'),
      actions: accounts.length > 1 ? [seg([{ value: 'all', label: 'All' }, ...accounts.map(a => ({ value: a.account, label: a.account.split('@')[0] }))], account, v => { account = v; notify(); }, 'Account')] : null },
      !e.connected ? empty('Email needs the server', 'Pair this device, then add your Gmail accounts.', h('button.btn', { type: 'button', onclick: () => go('settings') }, 'Open settings'))
        : !accounts.length ? empty('No Gmail account connected', 'Add one or more Google accounts in Settings → Connections.', h('button.btn', { type: 'button', onclick: () => go('settings') }, 'Connect Gmail'))
        : emails.length ? h('div.mail-list', emails.slice(0, 40).map(m => emailRow(m, colorOf[m.account])))
        : empty('Inbox is quiet', 'Nothing new in the last three days.'));

    const slackPanel = panel({ title: 'Slack', readout: sd.team || '',
      actions: [seg([{ value: 'people', label: 'Who messaged me' }, { value: 'channels', label: 'Channels' }], slackTab, v => { slackTab = v; notify(); }, 'Slack view')] },
      !s.connected ? empty('Slack needs the server', 'Pair this device first.')
        : !sd.connected ? empty('Slack is not connected', 'Paste a Slack user token in Settings → Connections.', h('button.btn', { type: 'button', onclick: () => go('settings') }, 'Connect Slack'))
        : slackTab === 'people'
          ? (people.length ? h('div.mail-list', people.slice(0, 30).map(slackRow)) : empty('No DMs or mentions', 'Nobody needs you right now.'))
          : ((sd.channels || []).length ? h('div.channel-list', sd.channels.map(c => h('div.channel',
              h('div.channel-head', h('span', '# ' + c.name), h('span.data.muted', String((c.messages || []).length))),
              h('div.mail-list', (c.messages || []).slice(0, 5).map(slackRow)))))
            : empty('No channels picked', 'Choose the channels to follow in Settings → Connections.')));

    root.append(h('div.view.inbox',
      viewHead('Inbox', 'Every Gmail account and Slack in one place.', e.connected ? btn(e.loading || s.loading ? 'Refreshing…' : 'Refresh', reload, 'ghost', 'sync') : null),
      h('div.grid.g-2', mailPanel, slackPanel)));
  }
};
