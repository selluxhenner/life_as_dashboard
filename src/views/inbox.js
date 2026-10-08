import { h } from '../core/dom.js';
import { notify } from '../core/store.js';
import { fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, empty, chip, seg, btn, iconBtn } from '../components/ui.js';
import { remote, refresh } from '../core/remote.js';
import { errorText } from '../core/api.js';
import { go } from '../core/router.js';
import { icon } from '../core/icons.js';
import { isPhone, phoneQuery } from '../core/platform.js';

let account = 'all';
let slackTab = 'people';
let selectedId = null;      // the email shown in the reading pane
let phoneReading = false;   // phones show the list or the message, not both

phoneQuery.addEventListener('change', () => notify());
const WIDE = matchMedia('(min-width: 1500px)');
WIDE.addEventListener('change', () => notify());

export const emailData = () => remote('email', '/api/inbox/email', 3 * 60000);
export const slackData = () => remote('slack', '/api/inbox/slack', 3 * 60000);
const messageData = id => remote('mail:' + id, '/api/inbox/email/' + encodeURIComponent(id), 10 * 60000);

const initials = s => (s || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');
const when = ms => {
  const d = new Date(ms), now = new Date();
  return d.toDateString() === now.toDateString() ? fmt.time(d) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const fullWhen = ms => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function emailRow(m, color) {
  const pick = () => { selectedId = m.id; phoneReading = isPhone(); notify(); };
  return h('button.mail' + (m.unread ? '.unread' : '') + (m.id === selectedId && !isPhone() ? '.selected' : ''), {
    type: 'button', style: { '--c': color || 'var(--signal)' }, 'aria-current': m.id === selectedId ? 'true' : null, onclick: pick
  },
    h('span.avatar', initials(m.fromName || m.fromAddr)),
    h('div.mail-body',
      h('div.mail-top', h('span.mail-from', m.fromName || m.fromAddr), h('span.mail-when.data', when(m.receivedAt))),
      h('div.mail-subj', m.subject || '(no subject)'),
      h('div.mail-snip', m.aiSummary || m.snippet || '')),
    m.aiPriority === 'high' ? chip('important', 'alert') : null);
}

/* Links in plain-text mail become clickable; everything else stays text (never HTML from the mail). */
function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g)) {
    out.push(text.slice(last, m.index));
    out.push(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0].length > 70 ? m[0].slice(0, 67) + '…' : m[0]));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function reader(m, color) {
  if (!m) return panel({ cls: 'mail-reader' }, empty('Pick a message', 'It opens here.'));
  const full = messageData(m.id);
  const d = full.data;
  const back = isPhone() ? iconBtn('left', 'Back to the list', () => { phoneReading = false; notify(); }, 'sm ghost') : null;
  return panel({ cls: 'mail-reader', style: { '--c': color || 'var(--signal)' } },
    h('header.reader-head',
      back,
      h('div.grow',
        h('h2.reader-subj', m.subject || '(no subject)'),
        h('div.reader-from',
          h('span.avatar', initials(m.fromName || m.fromAddr)),
          h('div', h('div', h('b', m.fromName || m.fromAddr), m.fromName && m.fromAddr !== m.fromName ? h('span.muted', ' <' + m.fromAddr + '>') : null),
            h('div.reader-meta', fullWhen(m.receivedAt), ' · to ', d && d.to ? d.to.replace(/<[^>]+>/g, '').trim() : m.account)))),
      h('a.btn.sm', { href: m.link || '#', target: '_blank', rel: 'noopener' }, 'Open in Gmail', icon('ext'))),
    m.aiSummary ? h('div.reader-summary', h('span.micro', 'Summary'), h('p', m.aiSummary)) : null,
    d ? h('div.reader-body', linkify(d.body || '(This message has no text.)'), d.truncated ? h('p.hint', 'The message is longer. Open it in Gmail to read the rest.') : null)
      : full.error ? h('div.reader-body', h('p.hint', errorText(full.error)), h('p', m.snippet || ''))
      : h('div.reader-body.loading', h('p', m.snippet || ''), h('p.hint', 'Loading the full message…')));
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
  return (data && data.emails || []).filter(m => m.unread).slice(0, 3);
}

export default {
  id: 'inbox',
  render(root) {
    const e = emailData(), s = slackData();
    const accounts = (e.data && e.data.accounts) || [];
    const colorOf = Object.fromEntries(accounts.map(a => [a.account, a.color]));
    const emails = ((e.data && e.data.emails) || []).filter(m => account === 'all' || m.account === account);
    const unread = emails.filter(m => m.unread).length;
    if (!isPhone() && emails.length && !emails.some(m => m.id === selectedId)) selectedId = emails[0].id;
    const selected = emails.find(m => m.id === selectedId) || null;
    const sd = s.data || {};
    const people = [...(sd.dms || []), ...(sd.mentions || [])].sort((a, b) => b.ts - a.ts);
    const reload = () => { refresh('email', '/api/inbox/email?live=1'); refresh('slack', '/api/inbox/slack?live=1'); };
    const loading = e.loading || s.loading;
    // phones: a small refresh button next to the unread count instead of a row of its own
    const phoneRefresh = isPhone() && e.connected
      ? iconBtn('sync', loading ? 'Refreshing…' : 'Refresh', reload, 'sm ghost' + (loading ? ' spin' : ''))
      : null;

    const mailReady = e.connected && accounts.length && emails.length;
    const mailList = panel({ title: 'Email', cls: 'mail-list-panel', readout: h('span.mail-readout', h('b', String(unread)), ' unread', phoneRefresh),
      actions: accounts.length > 1 ? [seg([{ value: 'all', label: 'All' }, ...accounts.map(a => ({ value: a.account, label: a.account.split('@')[0] }))], account, v => { account = v; notify(); }, 'Account')] : null },
      !e.connected ? empty('Email needs the server', 'Connect this device in Settings, then add your Gmail accounts.', h('button.btn', { type: 'button', onclick: () => go('settings') }, 'Open settings'))
        : !accounts.length ? empty('No Gmail account connected', 'Add one or more Google accounts in Settings → Connections.', h('button.btn', { type: 'button', onclick: () => go('settings') }, 'Connect Gmail'))
        : emails.length ? h('div.mail-list', emails.slice(0, 40).map(m => emailRow(m, colorOf[m.account])))
        : empty('Inbox is quiet', 'Nothing new in the last three days.'));

    const slackPanel = panel({ title: 'Slack', cls: 'slack-panel', readout: sd.team || '',
      actions: [seg([{ value: 'people', label: 'Who messaged me' }, { value: 'channels', label: 'Channels' }], slackTab, v => { slackTab = v; notify(); }, 'Slack view')] },
      !s.connected ? empty('Slack needs the server', 'Connect this device first.')
        : !sd.connected ? empty('Slack is not connected', 'Paste a Slack user token in Settings → Connections.', h('button.btn', { type: 'button', onclick: () => go('settings') }, 'Connect Slack'))
        : slackTab === 'people'
          ? (people.length ? h('div.mail-list', people.slice(0, 30).map(slackRow)) : empty('No DMs or mentions', 'Nobody needs you right now.'))
          : ((sd.channels || []).length ? h('div.channel-list', sd.channels.map(c => h('div.channel',
              h('div.channel-head', h('span', '# ' + c.name), h('span.data.muted', String((c.messages || []).length))),
              h('div.mail-list', (c.messages || []).slice(0, 5).map(slackRow)))))
            : empty('No channels picked', 'Choose the channels to follow in Settings → Connections.')));

    const head = viewHead('Inbox', 'Every Gmail account and Slack in one place.', e.connected && !isPhone() ? btn(loading ? 'Refreshing…' : 'Refresh', reload, 'ghost', 'sync') : null);

    if (isPhone()) {
      // phone: the list, or one message full width with a back button
      root.append(h('div.view.inbox', phoneReading && selected ? reader(selected, colorOf[selected.account]) : [head, h('div.stack', mailList, slackPanel)]));
      return;
    }
    const readerPanel = mailReady ? reader(selected, selected && colorOf[selected.account]) : null;
    root.append(h('div.view.inbox.inbox-wide', head,
      WIDE.matches
        ? h('div.inbox-grid.three', mailList, readerPanel || h('div'), slackPanel)
        : [h('div.inbox-grid', mailList, readerPanel || h('div')), h('div', { style: { marginTop: '16px' } }, slackPanel)]));
  }
};
