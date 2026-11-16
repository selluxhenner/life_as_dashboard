// Lina's deck: the first screen. Lina is the big thing in the middle, inside the day dial. Around her, without frames,
// float what she can reach: Up next (top left), Obsidian (top right), Workbench (bottom left) and what just came in
// (bottom right). Light lines run from her to each; while she thinks they shimmer, and the one she is using right now
// (her tools) carries a pulse. No subtitles: she just answers. Her last words can be opened with the Text button.
// Tap her or press Space and talk; talking over her interrupts her; "danke" ends the conversation.
// The stage (dial, orb) is built once and kept, because the store re-renders views many times a second.
import { h } from '../core/dom.js';
import { state, save } from '../core/store.js';
import { fmt, todayKey } from '../core/dates.js';
import { createChronosphere, replayIntro } from '../components/chronosphere.js';
import { linaOrb, wakeOrb, introOrb } from '../components/lina-orb.js';
import { agendaFor } from '../core/agenda.js';
import { remote, refresh } from '../core/remote.js';
import { api } from '../core/api.js';
import { speak, isSpeaking } from '../voice/tts.js';
import { icon } from '../core/icons.js';
import { go, routeList, render as routerRender, currentRoute } from '../core/router.js';
import { isPhone } from '../core/platform.js';
import { talk, toggleTalk, cancelTalk, askLina, setTalk, listenNow, canTalk } from '../voice/talk.js';
import { apiConfig } from '../core/api.js';
import { greetingFor } from '../voice/greeting.js';

const FEED = '/api/lina/feed?limit=30';
const POLL_MS = 15000;
const WORKBENCH_URL = 'https://desktop-oe7cumo.tailb66bb7.ts.net';

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

/* Which of her tools reach which satellite. */
const REACH = {
  vault: ['search_vault', 'read_note', 'write_vault_note', 'vault_recent', 'add_note'],
  workbench: ['workbench_status', 'start_task', 'task_status', 'cancel_task'],
  next: ['get_today', 'get_calendar', 'list_todos', 'create_todo', 'update_todo', 'complete_todo', 'delete_todo', 'add_calendar_block', 'move_event', 'get_briefing', 'list_habits', 'check_habit', 'schedule_meeting'],
  live: ['get_updates', 'get_news'],
  hermes: ['ask_hermes', 'hermes_answers', 'task_status'],
  server: ['status_report']
};
/* Left of her: what's next, Hermes, Workbench. Right: Obsidian, the server, what just came in. */
/* Places around her, most prominent first: top left, top right, middle left, middle right, bottom left, bottom right.
   The most important box takes the first free place; what matters least drops out when there is no room. */
const SLOTS = 6;
const isLeft = slot => slot % 2 === 1;
const SOURCE = { hermes: 'Hermes', workbench: 'Workbench', agents: 'Agents', server: 'Server', news: 'News', briefing: 'Briefing', calendar: 'Calendar', jobs: 'Jobs' };
const sourceName = s => SOURCE[s] || s.charAt(0).toUpperCase() + s.slice(1);

export const linaFeed = () => remote('linaFeed', FEED, POLL_MS);
const showText = () => (state.settings.voice || {}).showText === true;
const announceOn = () => (state.settings.voice || {}).announce !== false;
const setVoice = patch => { state.settings.voice = { ...(state.settings.voice || {}), ...patch }; save(); };

let deck = null;
let poll = 0, seenTop = 0, freshUntil = new Map(), announcedTop = null, linkRaf = 0;

/* Live voice: while the deck is open, Lina says new updates out loud (not news or the briefing), at most two at a
   time, only when she isn't talking with Kevin. Toggle at the top. */
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
  const chrono = createChronosphere({ lat: state.settings.home.lat, lon: state.settings.home.lon, size: 760 });
  const orb = linaOrb();
  const time = h('div.lina-clock-time.data');
  const core = h('button.lina-core', { type: 'button', 'aria-label': 'Talk to Lina', onclick: () => toggleTalk() }, orb);
  const dial = h('div.lina-dial', chrono.el, core);
  const links = h('svg.lina-links', { 'aria-hidden': 'true' });
  const sats = Object.fromEntries(['next', 'hermes', 'workbench', 'vault', 'server', 'live'].map(k => [k, h('section.sat.' + k)]));
  const textBtn = h('button.lina-textbtn', { type: 'button', onclick: () => setVoice({ showText: !showText() }) });
  const transcript = h('div.lina-transcript', { 'aria-live': 'polite' });
  const cmds = h('nav.lina-cmds', { 'aria-label': 'Ask Lina' }, COMMANDS.map(c => h('button.cmd', { type: 'button', onclick: () => askLina(c.ask) }, c.label)));
  const liveVoice = h('button.live-voice', { type: 'button', title: 'Lina says new updates out loud while this screen is open', onclick: () => setVoice({ announce: !announceOn() }) });
  const focusTitle = h('span.focus-title');
  const focusRoot = h('div.lina-focus-view');
  const focusBar = h('div.lina-focus-bar', h('button.focus-back', { type: 'button', onclick: () => closeFocus(), title: 'Back to the overview (Esc)' }, icon('left'), 'Overview'), focusTitle);
  const space = h('div.lina-space', links, ...Object.values(sats),
    h('div.lina-center', dial, h('div.lina-under', time, textBtn), transcript),
    h('div.lina-focus', focusBar, focusRoot));
  const el = h('div.view.lina.intro',
    h('header.lina-top', h('div.lina-hello', h('span.lina-name', 'LINA'), h('span.dim', fmt.long(new Date()))), liveVoice),
    space,
    h('footer.lina-bottom', cmds));
  return { el, chrono, dial, time, liveVoice, sats, links, space, core, textBtn, transcript, focusRoot, focusTitle };
}

/* The entrance: on the first open and on Ctrl+R only. Updates never replay it. */
function playIntro(fresh) {
  if (!fresh) {
    replayIntro();
    deck.chrono.destroy();
    deck.chrono = createChronosphere({ lat: state.settings.home.lat, lon: state.settings.home.lon, size: 760 });
    deck.dial.replaceChildren(deck.chrono.el, deck.core);
  }
  deck.el.classList.remove('intro');
  void deck.el.offsetWidth;                         // restart the CSS entrance
  deck.el.classList.add('intro');
  introOrb();
  clearTimeout(deck.introTimer);
  deck.introTimer = setTimeout(() => deck && deck.el.classList.remove('intro'), 2400);
}

/* ---------- the satellites: plain text around her, shown only when there is something to show ---------- */

/* A box's name opens its page (or Obsidian itself); the lines inside open what they are. */
const satHead = (name, sub, onclick, title = 'Open') => h('button.sat-head', { type: 'button', onclick, title }, h('span.sat-name', name), sub ? h('span.sat-sub', sub) : null);
const VAULT = 'obsidian_vault';
const openNote = path => { location.href = 'obsidian://open?vault=' + encodeURIComponent(VAULT) + (path ? '&file=' + encodeURIComponent(path.replace(/\.md$/i, '')) : ''); };
/* How many lines a box shows: more when the window is taller (a bigger screen, a maximised window). */
const rowsFor = () => (innerHeight >= 1150 ? 6 : innerHeight >= 980 ? 5 : innerHeight >= 820 ? 4 : 3);

function nextSat(s) {
  const tk = todayKey();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const rows = rowsFor();
  const upcoming = agendaFor(tk).filter(i => !i.allDay && i.start != null && (i.end ?? i.start + 60) > nowMin).slice(0, rows);
  const focus = s && s.todos ? s.todos.focus.slice(0, rows) : [];
  if (!upcoming.length && !focus.length && !(s && s.next)) return null;
  return [
    satHead('Up next', s && s.todos ? s.todos.open + ' open tasks' : null, () => openInDeck('today')),
    ...upcoming.map(a => h('button.sat-line', { type: 'button', onclick: () => openInDeck('calendar') }, h('span.sat-time.data', a.time || ''), h('span', a.title))),
    !upcoming.length && s && s.next ? h('div.sat-line', h('span.sat-time.data', new Date(s.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), h('span', s.next.title)) : null,
    ...focus.map(t => h('button.sat-line.todo', { type: 'button', onclick: () => openInDeck('today') }, h('span', { class: 'status-dot ' + (t.due && t.due < tk ? 'error' : t.high ? 'running' : 'idle') }), h('span', t.title)))
  ];
}

function vaultSat(v) {
  if (!v) return null;
  if (!v.connected || !v.recent.length) return [satHead('Obsidian', null, () => openNote(null), 'Open Obsidian'), h('div.sat-line.sat-dim', 'Not linked to the server yet')];
  return [
    satHead('Obsidian', v.notes + ' notes', () => openNote(null), 'Open Obsidian'),
    ...v.recent.slice(0, rowsFor()).map(n => h('button.sat-line.note', { type: 'button', title: 'Open in Obsidian', onclick: () => openNote(n.path) },
      h('span', n.title), h('span.sat-dim', fmt.ago(n.at))))
  ];
}

const WB_DOT = { running: 'running', active: 'running', working: 'running', busy: 'running', waiting: 'running', 'needs-input': 'running', done: 'done', completed: 'done', failed: 'error', error: 'error' };
function workbenchSat(w) {
  if (!w || !w.configured || (!w.sessions.length && !(w.plans && w.plans.length))) return null;
  return [
    satHead('Workbench', w.reachable ? w.active + ' active' : 'not reachable', () => window.open(WORKBENCH_URL, '_blank', 'noopener'), 'Open Workbench'),
    ...(w.plans || []).slice(0, 3).map(p => h('div.sat-plan', h('div.sat-line', h('span', p.title), h('span.sat-dim.data', p.total ? `${p.done}/${p.total}` : '')),
      h('div.plan-bar', h('i', { style: { width: (p.total ? Math.round((p.done / p.total) * 100) : 0) + '%' } })))),
    ...(w.attention || []).slice(0, 2).map(a => h('div.sat-line', h('span.status-dot.running'), h('span', a.title))),
    ...w.sessions.slice(0, Math.max(2, rowsFor() - 1)).map(x => h('div.sat-line', h('span', { class: 'status-dot ' + (WB_DOT[x.status] || 'idle') }), h('span', x.title || x.project))),
    h('a.sat-link', { href: WORKBENCH_URL, target: '_blank', rel: 'noopener', title: 'Needs Tailscale' }, 'Open', icon('ext'))
  ];
}

function liveSat(data) {
  const list = ((data && data.events) || []).filter(e => Date.now() - e.at < 2 * 86400000).slice(0, rowsFor());
  if (!list.length) return null;
  const top = list[0].id;
  if (seenTop && top > seenTop) list.filter(e => e.id > seenTop).forEach(e => freshUntil.set(e.id, Date.now() + 12000));
  seenTop = Math.max(seenTop, top);
  return [
    satHead('Just in', data.unread ? data.unread + ' new' : null, () => openInDeck('hub')),
    ...list.map(e => h('div.sat-event' + ((freshUntil.get(e.id) || 0) > Date.now() ? '.fresh' : ''), { dataset: { level: e.level } },
      h('div.sat-dim', sourceName(e.source) + ' · ' + fmt.ago(e.at)), h('div', e.title)))
  ];
}

function hermesSat(s) {
  if (!s) return null;
  const hm = s.hermes;
  const waiting = s.tasks.open + s.approvals;
  const recent = hm.lastAnswer && hm.lastAnswer.at && Date.now() - hm.lastAnswer.at < 86400000;
  if (hm.online && !hm.openAsks && !recent && !waiting) return null;   // nothing to say: Hermes stays out of the way
  return [
    satHead('Hermes', hm.online ? 'online' : hm.lastSeenAt ? 'seen ' + fmt.ago(hm.lastSeenAt) : 'offline', () => openInDeck('hub')),
    !hm.online ? h('div.sat-line', h('span.status-dot.error'), h('span', 'The agent box is not checking in')) : null,
    hm.openAsks ? h('div.sat-line', h('span.status-dot.running'), h('span', hm.openAsks + (hm.openAsks === 1 ? ' question' : ' questions') + ' with Hermes')) : null,
    waiting ? h('button.sat-line', { type: 'button', onclick: () => openInDeck('hub') }, h('span', [s.tasks.open ? s.tasks.open + (s.tasks.open === 1 ? ' task' : ' tasks') + ' running or waiting' : null, s.approvals ? s.approvals + ' waiting for your OK' : null].filter(Boolean).join(' · '))) : null,
    recent ? h('div.sat-event', h('div.sat-dim', 'Answered ' + fmt.ago(hm.lastAnswer.at)), h('div', hm.lastAnswer.answer.slice(0, 140))) : null
  ];
}

function serverSat(s) {
  if (!s || !s.server || s.server.status === 'ok') return null;
  return [
    satHead('Server', s.server.status === 'fail' ? 'needs attention' : 'warning', () => openInDeck('hub')),
    h('div.sat-event', { dataset: { level: s.server.status === 'fail' ? 'alert' : 'warn' } }, h('div.sat-dim', fmt.ago(s.server.at)), h('div', s.server.summary))
  ];
}

function systems(s, connected, error) {
  if (!connected) return [h('button.sys', { type: 'button', onclick: () => go('settings') }, h('span.status-dot.idle'), 'Pair this device to wake Lina')];
  if (!s) return error ? [h('span.sys', h('span.status-dot.error'), /not found|404/i.test(error.msg || '') ? 'Server needs the Lina update' : 'Server not reachable')] : [];
  const item = (label, ok, sub, onclick) => h(onclick ? 'button.sys' : 'span.sys', onclick ? { type: 'button', onclick } : {},
    h('span', { class: 'status-dot ' + (ok === true ? 'done' : ok === false ? 'error' : 'idle') }), label, sub ? h('span.dim', sub) : null);
  return [
    item('Hermes', s.hermes.online, s.hermes.online ? 'online' : 'offline', () => openInDeck('hub')),
    s.workbench.configured ? item('Workbench', s.workbench.reachable, s.workbench.reachable ? s.workbench.active + ' active' : 'unreachable') : null,
    s.vault.connected ? item('Obsidian', true, null) : null,
    s.server ? item('Server', s.server.status === 'ok', s.server.status === 'ok' ? null : s.server.status) : null,
    s.tasks.open || s.approvals ? item('Waiting', null, [s.tasks.open ? s.tasks.open + ' tasks' : null, s.approvals ? s.approvals + ' OKs' : null].filter(Boolean).join(' · '), () => openInDeck('hub')) : null
  ].filter(Boolean);
}

/* ---------- a new layout: the boxes glide to their new places ----------
   A different window size (another screen, maximised, a resize) can change how many lines fit and where the boxes
   sit. When that happens they move there instead of jumping, and the lines follow. */
let layoutSig = '', followUntil = 0, resizeTimer = 0, lastRects = new Map();
const layoutNow = () => (innerWidth <= 860 ? 'one' : innerWidth <= 1100 ? 'two' : 'space') + ':' + rowsFor() + ':' + (focus || '') + ':' +
  Object.entries(deck.sats).map(([k, el]) => (el.hidden ? '' : k + el.dataset.slot)).join(',');
/* Where every box was after the last paint: a resize has already moved them by the time it is reported. */
const remember = () => { if (deck) lastRects = new Map([...Object.values(deck.sats), deck.dial].filter(el => !el.hidden).map(el => [el, el.getBoundingClientRect()])); };
function glide(change, before = null) {
  const els = [...Object.values(deck.sats).filter(el => !el.hidden), deck.dial];
  before = before || new Map(els.map(el => [el, el.getBoundingClientRect()]));
  change();
  if (!deck || !deck.el.isConnected || typeof Element.prototype.animate !== 'function') return;
  for (const el of [...Object.values(deck.sats), deck.dial]) {
    if (el.hidden) continue;
    const a = before.get(el), b = el.getBoundingClientRect();
    if (!a) { el.animate([{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 500, easing: 'ease-out' }); continue; }
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) + Math.abs(dy) < 2) continue;
    el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: 700, easing: 'cubic-bezier(.2,.9,.25,1.12)' });
  }
  followUntil = performance.now() + 760;
  scheduleLinks();
  setTimeout(remember, 760);
}
function onResize() {
  scheduleLinks();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (deck && deck.el.isConnected) glide(paint, lastRects); }, 140);
}

/* ---------- what matters now: the most important boxes take the best places ---------- */
function importance(key, s, data) {
  const now = Date.now();
  if (key === 'next') {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const soon = agendaFor(todayKey()).filter(i => !i.allDay && i.start != null && i.start >= nowMin).map(i => i.start - nowMin)[0];
    const overdue = s && s.todos ? s.todos.overdue : 0;
    return soon != null && soon <= 15 ? 98 : soon != null && soon <= 60 ? 80 : overdue ? 62 : soon != null && soon <= 180 ? 55 : 35;
  }
  if (key === 'server') return s && s.server ? (s.server.status === 'fail' ? 95 : 42) : 0;
  if (key === 'hermes') {
    if (!s) return 0;
    return s.approvals ? 88 : !s.hermes.online ? 72 : s.tasks.open ? 58 : s.hermes.openAsks ? 50 : 38;
  }
  if (key === 'workbench') {
    const w = s && s.workbench;
    if (!w) return 0;
    return w.attention && w.attention.length ? 76 : w.active ? 60 : 30;
  }
  if (key === 'live') {
    const fresh = ((data && data.events) || []).filter(e => now - e.at < 3600000);
    return fresh.some(e => e.level === 'alert') ? 90 : fresh.length ? 64 : data && data.unread ? 45 : 33;
  }
  if (key === 'vault') {
    const v = s && s.vault;
    return v && v.recent && v.recent[0] && now - v.recent[0].at < 3600000 ? 40 : 22;
  }
  return 0;
}

/* ---------- one page: a box (or Lina, by voice) opens a page right here; Lina gets small at the top ---------- */
let focus = null, focusView = null, focusShown = null;
const titleOf = id => (routeList().find(r => r.id === id) || {}).label || id;

/** Open a page inside the deck (Kalender, Inbox, Hub …). From another page, the deck comes back first. */
export function openInDeck(id) {
  if (!id || id === 'lina') return closeFocus();
  focus = id;
  if (!currentRoute() || currentRoute().id !== 'lina') go('lina'); else routerRender();
}
/** Back to the overview: Lina big in the middle. */
export function closeFocus(quiet = false) {
  if (!focus) return;
  focus = null;
  if (!quiet && deck && deck.el.isConnected) routerRender();
}
function paintFocus() {
  deck.el.dataset.focus = focus || '';
  if (focusView && focusView.unmount) focusView.unmount();
  if (!focus) { if (focusShown) { deck.focusRoot.replaceChildren(); focusShown = null; focusView = null; } return; }
  const route = routeList().find(r => r.id === focus);
  if (!route || route.id === 'lina') { focus = null; return paintFocus(); }
  focusView = route.view;
  deck.focusTitle.textContent = route.label;
  deck.focusRoot.replaceChildren();
  focusView.render(deck.focusRoot);
  focusShown = focus;
}

/* ---------- hello: when the app opens (or Ctrl+R) she greets Kevin, says what matters, and listens ---------- */
let greetTimer = 0;
function greetSoon() {
  clearTimeout(greetTimer);
  if (!apiConfig() || (state.settings.voice || {}).greet === false) return;
  // after the entrance, once the status is in (or after 4 s without it)
  const t0 = Date.now();
  const go = () => {
    const s = (linaFeed().data || {}).snapshot;
    if (!s && Date.now() - t0 < 4000) { greetTimer = setTimeout(go, 300); return; }
    if (!deck || !deck.el.isConnected || talk.state !== 'idle' || isSpeaking() || document.visibilityState !== 'visible') return;
    const line = greetingFor(s, agendaFor(todayKey()));
    setTalk({ state: 'speaking', heard: '', reply: line, tools: [] });
    speak(line, () => { if (talk.state === 'speaking' && talk.reply === line) { setTalk({ state: 'idle' }); if (canTalk()) listenNow(); } },
      { what: 'talk', lang: 'de', onBlocked: () => setTalk({ state: 'idle' }) });
  };
  greetTimer = setTimeout(go, 1700);
}

/* ---------- light lines from Lina to each satellite ---------- */

function drawLinks() {
  linkRaf = 0;
  if (!deck || !deck.el.isConnected) return;
  const box = deck.space.getBoundingClientRect();
  const o = deck.core.getBoundingClientRect();
  if (!box.width || !o.width) return;
  const cx = o.left + o.width / 2 - box.left, cy = o.top + o.height / 2 - box.top;
  const r0 = o.width * 0.3;                         // start just outside the sphere's orbits
  const used = new Set(talk.tools || []);
  const thinking = talk.state === 'thinking' || talk.state === 'speaking';
  deck.links.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  const parts = [];
  for (const [key, el] of Object.entries(deck.sats)) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    const tx = (isLeft(Number(el.dataset.slot)) ? r.right : r.left) - box.left;
    const ty = r.top + Math.min(r.height / 2, 28) - box.top;
    const dx = tx - cx, dy = ty - cy, len = Math.hypot(dx, dy) || 1;
    const sx = cx + (dx / len) * r0, sy = cy + (dy / len) * r0;
    // a gentle curve, bending away from the middle
    const mx = (sx + tx) / 2 + (dy / len) * 24, my = (sy + ty) / 2 - (dx / len) * 24;
    const active = REACH[key].some(t => used.has(t));
    el.classList.toggle('reached', active);
    const d = `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
    parts.push(h('path', { d, class: 'link' + (active ? ' active' : thinking ? ' shimmer' : '') }));
    if (active || thinking) parts.push(h('path', { d, class: 'pulse' + (active ? ' strong' : ''), pathLength: 100 }));
    parts.push(h('circle', { cx: tx, cy: ty, r: active ? 3.5 : 2, class: 'node' + (active ? ' active' : '') }));
  }
  deck.links.replaceChildren(...parts);
  if (performance.now() < followUntil) scheduleLinks();     // the boxes are still gliding
}
const scheduleLinks = () => { if (!linkRaf) linkRaf = requestAnimationFrame(drawLinks); };

function fill(el, content) {
  el.hidden = !content;
  if (content) el.replaceChildren(...content.filter(Boolean));
  else el.replaceChildren();
}

function paint() {
  const { data, connected, error } = linaFeed();
  const s = data && data.snapshot;
  deck.liveVoice.replaceChildren(icon('volume'), announceOn() ? 'Live voice' : 'Live voice off');
  const problem = systems(s, connected, error);    // only says something when Lina can't reach the server
  deck.liveVoice.title = problem.length && !s ? problem[0].textContent : 'Lina says new updates out loud while this screen is open';
  deck.liveVoice.setAttribute('aria-pressed', String(announceOn()));
  if (data && data.events) announce(data.events);
  const content = { next: nextSat(s), vault: vaultSat(s && s.vault), workbench: workbenchSat(s && s.workbench), live: liveSat(data), hermes: hermesSat(s), server: serverSat(s) };
  const ranked = Object.keys(content).filter(k => content[k]).sort((a, b) => importance(b, s, data) - importance(a, s, data));
  const room = innerHeight >= 760 ? SLOTS : 4;
  const shown = new Map(ranked.slice(0, room).map((k, i) => [k, i + 1]));
  for (const [k, el] of Object.entries(deck.sats)) {
    fill(el, shown.has(k) ? content[k] : null);
    el.dataset.slot = shown.get(k) || '';
    el.dataset.rank = shown.has(k) && shown.get(k) <= 2 ? 'top' : '';
  }
  paintFocus();
  deck.el.dataset.offline = !s && (!connected || error) ? (connected ? 'server' : 'pair') : '';

  const st = talk.state;
  deck.el.dataset.state = st;
  deck.time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // no subtitles: her last words only when Kevin opens them, and never while she listens or thinks
  const open = showText();
  deck.textBtn.replaceChildren(icon(open ? 'collapse' : 'expand'), open ? 'Hide text' : 'Text');
  deck.textBtn.hidden = !talk.reply && !talk.heard;
  const words = open && st !== 'listening' && st !== 'thinking' && (talk.heard || talk.reply);
  deck.transcript.hidden = !words;
  if (words) deck.transcript.replaceChildren(talk.heard ? h('div.lt-heard', '“' + talk.heard + '”') : '', talk.reply ? h('div.lt-reply', talk.reply) : '');

  const agenda = agendaFor(todayKey()).filter(i => !i.allDay && i.start != null);
  deck.chrono.update({ events: agenda.map(a => ({ start: a.start, end: a.end ?? a.start + 60, color: a.color, title: a.title, time: a.time })) });
  wakeOrb();
  scheduleLinks();
  layoutSig = layoutNow();
  if (performance.now() > followUntil) requestAnimationFrame(remember);
}

/* Space or Enter anywhere on the deck (outside a field) talks; Escape stops her. */
function onKey(e) {
  if (!deck || !deck.el.isConnected) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') { closeFocus(true); playIntro(false); greetSoon(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) toggleTalk(); }
  else if (e.key === 'Escape' && talk.state !== 'idle') { e.preventDefault(); cancelTalk(); }
  else if (e.key === 'Escape' && focus) { e.preventDefault(); closeFocus(); }
}

export default {
  id: 'lina',
  render(root) {
    let fresh = false;
    if (!deck) {
      deck = build();
      fresh = true;
      window.addEventListener('keydown', onKey);
      window.addEventListener('resize', onResize);
      matchMedia('(resolution: 1dppx), (resolution: 2dppx)').addEventListener?.('change', onResize);   // moved to another screen
    }
    root.append(deck.el);
    deck.el.classList.toggle('phone', isPhone());
    // a box that appears or goes, or more lines: glide into the new layout (not on the first paint)
    const shownBefore = layoutSig;
  // (also when the ranking moves a box to another place)
    if (!fresh && shownBefore) { glide(paint); } else paint();
    if (fresh) {
      playIntro(true);
      greetSoon();
      // the status may arrive while the entrance holds renders back: paint once it is over
      setTimeout(() => { if (deck && deck.el.isConnected) routerRender(); }, 2600);
    }
    if (!poll) poll = setInterval(() => { if (deck && deck.el.isConnected && document.visibilityState === 'visible') refresh('linaFeed', FEED); }, POLL_MS);
  },
  unmount() {
    // the router unmounts before every re-render too: only tear down once the deck is really gone
    setTimeout(() => {
      if (!deck || deck.el.isConnected) return;
      clearInterval(poll); poll = 0; announcedTop = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      deck.chrono.destroy();
      if (focusView && focusView.unmount) focusView.unmount();
      focusView = null; focusShown = null;
      deck = null;
    }, 0);
  }
};
