// Lina's deck: the first screen. Lina in the middle beside the clock, what reaches her streaming in on the left
// (Workbench, Hermes, agent tasks, Kevin's own apps), and on the right what she can work with: Obsidian, Workbench,
// today's focus. Tap the orb or press Space and talk; she can be interrupted by just talking over her. The chips and the
// field ask her by text and she answers out loud, then listens for a follow-up.
// The stage (clock, orb) is built once and kept, because the store re-renders views many times a second while she
// streams; only the text and the side columns are rebuilt.
import { h } from '../core/dom.js';
import { state, save } from '../core/store.js';
import { fmt, todayKey } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { chip, empty } from '../components/ui.js';
import { createChronosphere } from '../components/chronosphere.js';
import { linaOrb, wakeOrb } from '../components/lina-orb.js';
import { agendaFor } from '../core/agenda.js';
import { remote, refresh } from '../core/remote.js';
import { api } from '../core/api.js';
import { speak, isSpeaking } from '../voice/tts.js';
import { icon } from '../core/icons.js';
import { go } from '../core/router.js';
import { isPhone } from '../core/platform.js';
import { talk, toggleTalk, cancelTalk, askLina, canTalk } from '../voice/talk.js';

const FEED = '/api/lina/feed?limit=30';
const POLL_MS = 15000;
const WORKBENCH_URL = 'https://kev-pc.tailb66bb7.ts.net';

/* What a tap on a chip asks. Spoken answers, so the wording asks for short ones. */
export const COMMANDS = [
  { label: 'Morning briefing', ask: 'Give me my morning briefing: the day, what matters, anything new.' },
  { label: 'My day', ask: 'What do I have to do today? Tasks and appointments, most important first.' },
  { label: 'Sort my tasks', ask: 'Sort my open tasks: what should I do first today, what can wait? Suggest the order and set priorities if it helps.' },
  { label: 'What’s new?', ask: 'What’s new? Catch me up on the updates.' },
  { label: 'Obsidian', ask: 'Check my Obsidian vault: what changed lately, and where did I leave off?' },
  { label: 'Workbench', ask: 'Where does Workbench stand: which sessions are running or done, and where are the plans?' },
  { label: 'Hermes', ask: 'How are the servers? Ask Hermes for the current status if needed.' }
];

const SOURCE = {
  hermes: ['Hermes', 'server'], workbench: ['Workbench', 'agent'], agents: ['Agents', 'agent'], server: ['Server', 'server'],
  news: ['News', 'globe'], briefing: ['Briefing', 'journal'], calendar: ['Calendar', 'calendar'], jobs: ['Jobs', 'briefcase']
};
const sourceOf = s => SOURCE[s] || [s.charAt(0).toUpperCase() + s.slice(1), 'bolt'];
const STATE_LABEL = { idle: 'Tap or press Space to talk', listening: 'Listening — just talk', thinking: 'Thinking…', speaking: 'Speaking — talk over me to interrupt' };

export const linaFeed = () => remote('linaFeed', FEED, POLL_MS);

let deck = null;      // {el, chrono, heard, reply, label, left, right, …}: kept between renders
let poll = 0, seenTop = 0, freshUntil = new Map();
let announcedTop = null;   // newest entry id when the deck opened: only what comes after is announced

/* Live voice: while the deck is open, Lina says new updates out loud (not news or the briefing, which have their own
   buttons), at most two at a time, and only when she isn't talking with Kevin. Toggle in the deck's header. */
const announceOn = () => (state.settings.voice || {}).announce !== false;
const QUIET_SOURCES = ['news', 'briefing'];
function announce(events) {
  const top = events[0] ? events[0].id : 0;
  if (announcedTop === null) { announcedTop = top; return; }
  if (top <= announcedTop) return;
  const fresh = events.filter(e => e.id > announcedTop && !e.told && !QUIET_SOURCES.includes(e.source)).reverse();
  announcedTop = top;
  if (!fresh.length || !announceOn() || talk.state !== 'idle' || isSpeaking() || document.visibilityState !== 'visible') return;
  const said = fresh.slice(-2);
  const line = (fresh.length > 2 ? `${fresh.length} updates. ` : '') + said.map(e => e.title.replace(/^(\w+) · /, '$1: ')).join('. ') + '.';
  speak(line, null, { what: 'talk', lang: 'en' });
  api.post('/api/lina/feed/told', { ids: fresh.map(e => e.id) }).catch(() => {});
}

function build() {
  const chrono = createChronosphere({ lat: state.settings.home.lat, lon: state.settings.home.lon, size: 320, compact: true });
  const orb = linaOrb();
  const label = h('div.lina-state');
  const heard = h('div.lina-heard');
  const reply = h('div.lina-reply');
  const input = h('input.field.lina-ask', {
    placeholder: 'Ask Lina anything…', 'aria-label': 'Ask Lina',
    onkeydown: e => { if (e.key === 'Enter' && input.value.trim()) { const v = input.value; input.value = ''; input.blur(); askLina(v); } }
  });
  const orbBtn = h('button.lina-orb-btn', { type: 'button', 'aria-label': 'Talk to Lina', onclick: () => talkNow() }, orb);
  const chips = h('div.lina-chips', COMMANDS.map(c => h('button.chip-btn', { type: 'button', onclick: () => askLina(c.ask) }, c.label)));
  const systems = h('div.lina-systems');
  const liveVoice = h('button.sys.live-voice', { type: 'button', title: 'Lina says new updates out loud while this screen is open',
    onclick: () => { state.settings.voice = { ...(state.settings.voice || {}), announce: !announceOn() }; save(); } });
  const left = h('div.lina-col.left');
  const right = h('div.lina-col.right');
  const stage = h('section.lina-stage',
    h('div.lina-clock', chrono.el),
    h('div.lina-core', orbBtn, label),
    h('div.lina-words', heard, reply));
  const el = h('div.view.lina',
    h('header.lina-top', h('div.lina-hello', h('span.lina-name', 'LINA'), h('span.dim', fmt.long(new Date()))), systems, liveVoice),
    h('div.lina-grid', left, h('div.lina-center', stage, h('div.lina-command', input), chips), right));
  return { el, chrono, label, heard, reply, systems, left, right, input, liveVoice };
}

function talkNow() {
  if (!canTalk() && talk.state === 'idle') { toggleTalk(); return; }   // says why it can't
  toggleTalk();
}

/* ---------- the columns ---------- */

function feedPanel(data) {
  const list = (data && data.events) || [];
  const top = list[0] ? list[0].id : 0;
  if (seenTop && top > seenTop) list.filter(e => e.id > seenTop).forEach(e => freshUntil.set(e.id, Date.now() + 10000));
  if (top) seenTop = Math.max(seenTop, top);
  const unread = data ? data.unread : 0;
  return panel({ title: 'Live', readout: unread ? h('span', h('b', String(unread)), ' new for Lina') : 'streaming' },
    list.length ? h('div.feed', list.slice(0, 14).map(e => {
      const [name, ic] = sourceOf(e.source);
      const fresh = (freshUntil.get(e.id) || 0) > Date.now();
      return h('article.feed-item' + (fresh ? '.fresh' : ''), { dataset: { level: e.level } },
        h('span.feed-ic', icon(ic)),
        h('div.grow',
          h('div.feed-head', h('span.feed-src', name), h('span.data.muted', fmt.ago(e.at))),
          h('div.feed-title', e.title),
          e.body ? h('div.feed-body', e.body) : null));
    }))
      : empty('Quiet for now', 'Workbench sessions, Hermes, agent tasks and your apps report here. Apps post to /api/lina/events.'),
    h('div.input-row', { style: { marginTop: '10px' } },
      h('button.btn.sm', { type: 'button', onclick: () => askLina('What’s new? Catch me up on the updates.') }, icon('volume'), 'Catch me up')));
}

function nextPanel(s) {
  const tk = todayKey();
  const agenda = agendaFor(tk).filter(i => !i.allDay && i.start != null);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const upcoming = agenda.filter(a => (a.end ?? a.start + 60) > nowMin).slice(0, 3);
  return panel({ title: 'Up next', readout: s && s.todos ? h('span', h('b', String(s.todos.open)), ' open tasks') : '' },
    upcoming.length ? h('div.rows', upcoming.map(a => h('div.row',
      h('span.data.lina-time', a.time || ''), h('div.grow', h('div.title', a.title), a.sub ? h('div.sub', a.sub) : null))))
      : s && s.next ? h('div.rows', h('div.row', h('span.data.lina-time', new Date(s.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
          h('div.grow', h('div.title', s.next.title), h('div.sub', new Date(s.next.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + (s.next.location ? ' · ' + s.next.location : '')))))
      : empty('Nothing on the calendar', null),
    s && s.todos && s.todos.focus.length ? h('div.lina-focus',
      h('div.micro', 'Focus'),
      s.todos.focus.slice(0, 4).map(t => h('div.focus-item', h('span', { class: 'status-dot ' + (t.due && t.due < tk ? 'error' : t.high ? 'running' : 'idle') }),
        h('span.grow', t.title), t.due ? h('span.data.muted', t.due === tk ? 'today' : t.due < tk ? 'overdue' : t.due.slice(5)) : null))) : null);
}

function vaultPanel(v, waiting) {
  return panel({ title: 'Obsidian', readout: v && v.connected ? h('span', h('b', String(v.notes)), ' notes') : '' },
    !v ? empty(waiting || 'Loading', null)
      : !v.connected ? empty('Vault not connected', 'Set OBSIDIAN_VAULT on the server (Settings › Lina setup).')
      : h('div.rows', v.recent.map(n => h('button.row.lina-note', { type: 'button', title: 'Ask Lina about this note',
          onclick: () => askLina(`Open my note "${n.path}" and tell me briefly what's in it and where I left off.`) },
          icon('journal'), h('div.grow', h('div.title', n.title), h('div.sub', [n.folder, fmt.ago(n.at)].filter(Boolean).join(' · ')))))),
    v && v.connected ? h('div.input-row', { style: { marginTop: '10px' } },
      h('button.btn.sm', { type: 'button', onclick: () => askLina('What changed in my Obsidian vault lately? Then let’s continue where I left off.') }, icon('volume'), 'What’s new'),
      h('button.btn.sm.ghost', { type: 'button', onclick: () => { cancelTalk(); deck.input.focus(); deck.input.value = 'Add to my Obsidian note '; } }, icon('plus'), 'Write')) : null);
}

const WB_DOT = { running: 'running', active: 'running', working: 'running', busy: 'running', waiting: 'running', 'needs-input': 'running', done: 'done', completed: 'done', failed: 'error', error: 'error' };
function workbenchPanel(w, waiting) {
  return panel({ title: 'Workbench', readout: w && w.reachable ? h('span', h('b', String(w.active)), ' active') : '' },
    !w ? empty(waiting || 'Loading', null)
      : !w.configured ? empty('Not connected', 'Set WORKBENCH_URL and WORKBENCH_TOKEN on the server.')
      : h('div',
          !w.reachable ? h('div.hint', (w.error || 'Workbench is not reachable') + (w.sessions.length ? ' · last known sessions' : '')) : null,
          w.plans && w.plans.length ? h('div.lina-plans', w.plans.slice(0, 4).map(p => h('div.plan',
            h('div.plan-head', h('span.title', p.title), h('span.data.muted', p.total ? `${p.done}/${p.total}` : p.state || '')),
            h('div.plan-bar', h('i', { style: { width: (p.total ? Math.round((p.done / p.total) * 100) : 0) + '%' } })),
            p.next ? h('div.sub', p.next) : null))) : null,
          w.attention && w.attention.length ? h('div.lina-attn', w.attention.slice(0, 3).map(a => h('div.attn', icon('bolt'), a.title))) : null,
          w.sessions.length ? h('div.rows', w.sessions.slice(0, 5).map(s => h('div.row',
            h('span', { class: 'status-dot ' + (WB_DOT[s.status] || 'idle') }),
            h('div.grow', h('div.title', s.title || s.project), h('div.sub', [s.project, s.branch, s.status, s.lastActivityAt ? fmt.ago(s.lastActivityAt) : null].filter(Boolean).join(' · '))))))
            : empty('No sessions', null)),
    h('div.input-row', { style: { marginTop: '10px' } },
      h('button.btn.sm', { type: 'button', onclick: () => askLina('Where does Workbench stand: sessions and plans, and what are my to-dos there today?') }, icon('volume'), 'Status'),
      h('a.btn.sm.ghost', { href: WORKBENCH_URL, target: '_blank', rel: 'noopener', title: 'Needs Tailscale' }, icon('ext'), 'Open')));
}

function systems(s, connected, error) {
  if (!connected) return [h('button.sys', { type: 'button', onclick: () => go('settings') }, h('span.status-dot.idle'), 'Pair this device to wake Lina')];
  if (!s) return [h('span.sys', h('span', { class: 'status-dot ' + (error ? 'error' : 'idle') }), error ? (/not found|404/i.test(error.msg || '') ? 'Server needs the Lina update' : 'Server not reachable') : 'Connecting…')];
  const item = (label, ok, sub, onclick) => h(onclick ? 'button.sys' : 'span.sys', onclick ? { type: 'button', onclick } : {},
    h('span', { class: 'status-dot ' + (ok === true ? 'done' : ok === false ? 'error' : 'idle') }), label, sub ? h('span.dim', sub) : null);
  return [
    item('Hermes', s.hermes.online, s.hermes.online ? 'online' : s.hermes.lastSeenAt ? 'seen ' + fmt.ago(s.hermes.lastSeenAt) : 'offline', () => go('hub')),
    item('Workbench', s.workbench.configured ? s.workbench.reachable : null, !s.workbench.configured ? 'not set up' : s.workbench.reachable ? s.workbench.active + ' active' : 'unreachable'),
    item('Obsidian', s.vault.connected ? true : null, s.vault.connected ? s.vault.notes + ' notes' : 'not set up'),
    item('Server', s.server ? s.server.status === 'ok' : null, s.server ? s.server.status : 'no report'),
    s.tasks.open || s.approvals ? item('Waiting', null, [s.tasks.open ? s.tasks.open + ' tasks' : null, s.approvals ? s.approvals + ' approvals' : null].filter(Boolean).join(' · '), () => go('hub')) : null
  ].filter(Boolean);
}

function paint() {
  const { data, connected, error } = linaFeed();
  const s = data && data.snapshot;
  deck.systems.replaceChildren(...systems(s, connected, error));
  deck.liveVoice.replaceChildren(icon('volume'), announceOn() ? 'Live voice on' : 'Live voice off');
  deck.liveVoice.setAttribute('aria-pressed', String(announceOn()));
  if (data && data.events) announce(data.events);
  deck.left.replaceChildren(feedPanel(data), nextPanel(s));
  const waiting = !s && error ? 'Waiting for the server update' : null;
  deck.right.replaceChildren(vaultPanel(s && s.vault, waiting), workbenchPanel(s && s.workbench, waiting));
  const st = talk.state;
  deck.el.dataset.state = st;
  deck.label.textContent = STATE_LABEL[st] || '';
  deck.heard.textContent = talk.heard ? '“' + talk.heard + '”' : st === 'idle' ? 'Try: “Hey Lina, what’s new?” or tap a command below.' : '';
  deck.heard.classList.toggle('hint', !talk.heard);
  deck.reply.textContent = talk.reply || '';
  const tk = todayKey();
  const agenda = agendaFor(tk).filter(i => !i.allDay && i.start != null);
  deck.chrono.update({ events: agenda.map(a => ({ start: a.start, end: a.end ?? a.start + 60, color: a.color, title: a.title, time: a.time })) });
  wakeOrb();
}

/* Space or Enter anywhere on the deck (outside a field) talks; Escape stops her. */
function onKey(e) {
  if (!deck || !deck.el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) talkNow(); }
  else if (e.key === 'Escape' && talk.state !== 'idle') { e.preventDefault(); cancelTalk(); }
}

export default {
  id: 'lina',
  render(root) {
    if (!deck) { deck = build(); window.addEventListener('keydown', onKey); }
    root.append(deck.el);
    deck.el.classList.toggle('phone', isPhone());
    paint();
    if (!poll) poll = setInterval(() => { if (deck && deck.el.isConnected && document.visibilityState === 'visible') refresh('linaFeed', FEED); }, POLL_MS);
  },
  unmount() {
    // the router unmounts before every re-render too: only tear down once the deck is really gone
    setTimeout(() => {
      if (!deck || deck.el.isConnected) return;
      clearInterval(poll); poll = 0; announcedTop = null;
      window.removeEventListener('keydown', onKey);
      deck.chrono.destroy();
      deck = null;
    }, 0);
  }
};
