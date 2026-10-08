import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/views.css';
import './styles/features.css';
import './styles/responsive.css';

import { h, $ } from './core/dom.js';
import { icon } from './core/icons.js';
import { state, save, subscribe } from './core/store.js';
import { initRouter, onRoute, routeList, go, currentRoute, render, holdRenders } from './core/router.js';
import { initSync, onSyncStatus, syncStatus } from './core/sync.js';
import { initCal } from './core/calendar-sync.js';
import { applyTheme, onTheme } from './core/theme.js';
import { platform, windowAction, onMaximized, launchReady, onShellEvent } from './core/platform.js';
import { todayKey, fmt } from './core/dates.js';
import { createBackdrop } from './components/backdrop.js';
import { weatherNow, conditionOf } from './core/weather.js';
import { initPalette, openPalette } from './components/palette.js';
import { mountLaunch, playLaunch, playClose } from './components/launch.js';
import { replayIntro } from './components/chronosphere.js';
import { settle, forgivePenalties, pointsOn, totalPoints, rankView } from './features/points/points.js';
import { remote } from './core/remote.js';
import { newsData, digestStories } from './views/news.js';
import { pendingActions } from './views/assistant.js';
import { autoReadBriefing, listenNow } from './views/briefing-panel.js';
import { talk, toggleTalk } from './voice/talk.js';
import { mountVoicePill } from './components/voice-pill.js';
import COUNTRIES from './assets/country-centroids.json';

import home from './views/home.js';
import today from './views/today.js';
import calendar from './views/calendar.js';
import inbox from './views/inbox.js';
import news from './views/news.js';
import ai from './views/ai-models.js';
import jobs from './views/jobs.js';
import goals from './views/goals.js';
import assistant from './views/assistant.js';
import settings from './views/settings.js';
import lab from './views/lab.js';
import captures from './views/captures.js';
import { unsorted, settleCaptures, takeCaptures } from './features/capture/captures.js';
import { initNotifications } from './core/notifications.js';
import { initNative, onNativeAction, nativeCaptures, nativeTakeCaptures } from './core/native.js';

const ROUTES = [
  { id: 'home', label: 'Home', short: 'Overview', icon: 'home', view: home, dock: true, key: 'G H' },
  { id: 'captures', label: 'Captures', short: 'Notes', icon: 'capture', view: captures, dock: true, key: 'G N' },
  { id: 'today', label: 'Today', icon: 'today', view: today, dock: true, key: 'G T' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', view: calendar, dock: true, key: 'G C' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', view: inbox, key: 'G I' },
  { id: 'news', label: 'World', icon: 'globe', view: news, key: 'G W' },
  // AI and Jobs open from their cards on Home; still reachable with Ctrl K and G A / G J
  { id: 'ai', label: 'AI', icon: 'spark', view: ai, key: 'G A', nav: false },
  { id: 'jobs', label: 'Job hunt', icon: 'briefcase', view: jobs, key: 'G J', nav: false },
  { id: 'goals', label: 'Goals', icon: 'target', view: goals },
  { id: 'rank', label: 'Rank', icon: 'rank', view: rankView, hidden: () => !pointsOn() },
  { id: 'assistant', label: 'Agent', icon: 'agent', view: assistant, key: 'G .' },
  { id: 'settings', label: 'Settings', icon: 'settings', view: settings, bottom: true },
  { id: 'lab', label: 'Design lab', icon: 'spark', view: lab, hidden: () => location.hash !== '#/lab' }
];

/* ---------- shell ---------- */
const mark = () => h('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' },
  h('circle', { cx: 16, cy: 16, r: 13, fill: 'none', stroke: 'var(--seam-strong)' }),
  h('path', { d: 'M16 3a13 13 0 0 1 0 26', fill: 'none', stroke: 'var(--signal)', 'stroke-width': 1.6 }),
  h('circle', { cx: 16, cy: 16, r: 3.2, fill: 'var(--signal)' }));

function navLinks(filter, short = false) {
  return routeList().filter(r => r.id !== 'lab' && r.nav !== false).filter(filter).map(r =>
    h('a', { href: '#/' + r.id, dataset: { route: r.id }, title: r.label }, icon(r.icon), h('span', short && r.short || r.label)));
}

const clockEl = h('span.clock.data');
const weatherEl = h('span.hide-m.weather');
const syncBtn = h('button.sync', { type: 'button', onclick: () => go('settings') });
const pointsEl = h('span.hide-m');
const crumb = h('span.crumb');
/* The voice agent from anywhere. On Home it knows the briefing, on World the news digest. */
const talkContext = () => ({ home: 'briefing', news: 'world' })[currentRoute() && currentRoute().id] || null;
const talkBtn = h('button.talk', { type: 'button', 'aria-label': 'Talk to the assistant', title: 'Talk to the assistant', onclick: () => toggleTalk(talkContext()) }, icon('mic'));
const paintTalk = () => talkBtn.setAttribute('aria-pressed', String(talk.state === 'listening'));
const rail = h('nav.rail', { 'aria-label': 'Main' });
// picking a page from More puts the dock back (after the tap, so the link still navigates)
const dock = h('nav.dock', { 'aria-label': 'Main', onclick: e => { if (more && e.target.closest('a')) setTimeout(() => showMore(false), 0); } });
let moreBtn = null, more = false;

function buildNav() {
  rail.replaceChildren(h('div.mark', mark()), ...navLinks(r => !r.bottom), h('div.spacer'), ...navLinks(r => r.bottom));
  buildDock();
  markCurrent();
}
/* The dock, or after More the other pages in its place, until a page is picked or the screen is touched anywhere else. */
function buildDock(swap = false) {
  moreBtn = more ? null : h('button', { type: 'button', onclick: () => showMore(true) }, icon('more'), h('span', 'More'));
  dock.replaceChildren(...navLinks(r => more ? !r.dock : r.dock, true), ...(moreBtn ? [moreBtn] : []));
  dock.setAttribute('aria-label', more ? 'More pages' : 'Main');
  dock.classList.toggle('swap', swap);
}
const touchedOutside = e => { if (!dock.contains(e.target)) showMore(false); };
function showMore(on) {
  if (more === on) return;
  more = on;
  buildDock(true);
  markCurrent();
  if (on) document.addEventListener('pointerdown', touchedOutside, true);
  else document.removeEventListener('pointerdown', touchedOutside, true);
}
function markCurrent() {
  const id = currentRoute() && currentRoute().id;
  document.querySelectorAll('[data-route]').forEach(a => { if (a.dataset.route === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  crumb.textContent = currentRoute() ? currentRoute().label : '';
  const badges = { assistant: ((pendingActions().data || {}).actions || []).length, captures: unsorted().length };
  for (const [id, n] of Object.entries(badges)) {
    document.querySelectorAll(`[data-route="${id}"] .badge`).forEach(b => b.remove());
    if (n) document.querySelectorAll(`[data-route="${id}"]`).forEach(a => a.append(h('span.badge' + (id === 'captures' ? '.soft' : ''), String(n))));
  }
  // More lights up like a tab while one of its pages is open
  if (moreBtn) moreBtn.classList.toggle('here', !!id && !currentRoute().dock);
}

/* Caption buttons drawn like Windows' own: 10px glyphs on 1px lines. */
const CAPTION = {
  min: 'M0 5.5h10',
  max: 'M.5.5h9v9h-9z',
  restore: 'M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z',
  close: 'M0 0l10 10M10 0 0 10'
};
const glyph = name => h('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, h('path', { d: CAPTION[name] }));
const capBtn = (cls, label, name, onclick) =>
  h('button' + cls, { type: 'button', tabindex: -1, 'aria-label': label, title: label, onclick }, glyph(name));
const maxBtn = capBtn('.max', 'Maximize', 'max', () => windowAction('max'));
function paintMaximized(on) {
  document.documentElement.classList.toggle('is-maximized', on);
  maxBtn.replaceChildren(glyph(on ? 'restore' : 'max'));
  maxBtn.title = on ? 'Restore down' : 'Maximize';
  maxBtn.setAttribute('aria-label', maxBtn.title);
}

function statusBar() {
  return h('header.status', { 'data-tauri-drag-region': 'deep' },
    h('span.wordmark', 'AGENTIC', h('span', '/'), 'OS'),
    h('span.sep.hide-m'), crumb,
    h('span.push'),
    weatherEl, pointsEl,
    h('button.kbd.hide-m', { type: 'button', onclick: openPalette, title: 'Command palette' }, 'Ctrl K'),
    talkBtn,
    syncBtn,
    clockEl,
    h('div.win',
      capBtn('.min', 'Minimize', 'min', () => windowAction('min')),
      maxBtn,
      capBtn('.close', 'Close', 'close', closeWindow)));
}

function paintStatus() {
  const now = new Date();
  clockEl.textContent = fmt.timeSec(now);
  const { lat, lon, city } = state.settings.home;
  const w = weatherNow(lat, lon, paintStatus);
  weatherEl.textContent = w ? `${Math.round(w.temp)}°C  ·  ${city}` : city;
  weatherEl.title = w ? `${conditionOf(w.code)}, ${w.temp.toFixed(1)} °C in ${city} · updated ${fmt.time(new Date(w.at))}` : 'Weather loads when online';
  pointsEl.textContent = pointsOn() ? `⬢ ${totalPoints()} pts` : '';
}
function paintSync(s = syncStatus) {
  const label = { off: 'local', busy: 'sync…', ok: 'synced' + (s.latency ? ' · ' + s.latency + 'ms' : ''), offline: 'offline', auth: 'pair again', error: 'sync error' }[s.state] || s.state;
  syncBtn.textContent = label;
  syncBtn.className = 'sync ' + s.state;
  syncBtn.title = s.msg || 'Server connection';
}

/* ---------- backdrop pings from the news digest ---------- */
let backdrop = null;
function updatePings() {
  if (!backdrop) return;
  const stories = digestStories(newsData().data);
  const pings = [];
  for (const s of stories) {
    const c = s.country_n3 && COUNTRIES[s.country_n3];
    const lon = s.lon ?? (c && c[0]), lat = s.lat ?? (c && c[1]);
    if (lon == null) continue;
    pings.push({ lon, lat, region: s.region, breaking: !!s.breaking, size: (s.significance || 5) / 6 });
  }
  backdrop.setPings(pings.slice(0, 24));
}

/* ---------- launch, close, reopen ----------
   The window opens on the launch cover (components/launch.js). Everything heavy (map, shell, fonts) is
   built underneath before it shows, the view renders on the handoff beat, and syncing starts once the
   cover is gone. Closing fades to the void and hides to the tray; opening it again replays the launch. */
let phase = 'open';            // closed (cover up) · opening · open · closing
let routerReady = false;
let mainEl = null;
const HOLD = 2600;             // ms store changes wait after the handoff (the clock's intro runs 2.4 s)

function showView() {
  // The rail and dock list the router's routes, so they are built once the router has them.
  if (!routerReady) { routerReady = true; initRouter(mainEl, ROUTES); buildNav(); }
  else { replayIntro(); render(true); }
}

async function openWindow() {
  if (phase !== 'closed') return;
  phase = 'opening';
  await playLaunch(() => {
    holdRenders(HOLD);
    showView();
    backdrop.play();
  });
  phase = 'open';
}

async function closeWindow() {
  if (!platform.isTauri || phase === 'closing' || phase === 'closed') return;
  phase = 'closing';
  await playClose();
  phase = 'closed';
  await windowAction('close');
}

/* Fonts are local files; wait for them (briefly) so no text re-flows during the reveal. */
function fontsReady() {
  const faces = ['400 15px "Space Grotesk Variable"', '400 13px "JetBrains Mono Variable"', '300 40px Doto', '700 40px Doto'];
  const loads = Promise.all(faces.map(f => document.fonts.load(f).catch(() => {})));
  return Promise.race([loads, new Promise(r => setTimeout(r, 1200))]);
}

/* Sync, calendar, reminders and the spoken briefing start after the launch, so their work and
   re-renders never land in the middle of it. */
let servicesStarted = false;
function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;
  initSync();
  initCal();
  initNotifications();
  // Android: notification taps, widget, tile and shortcuts can say "listen" (play the briefing) or "ask" (talk)
  onNativeAction('listen', listenNow);
  onNativeAction('ask', () => { if (talk.state === 'idle') toggleTalk(); });
  initNative();
  // the Capture widget types over the home screen; what has not reached the server yet is taken from the phone
  const takeWidgetCaptures = () => nativeTakeCaptures().then(takeCaptures);
  takeWidgetCaptures();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) takeWidgetCaptures(); });
  settleCaptures();
  nativeCaptures(unsorted().length);
  subscribe(() => { settleCaptures(); nativeCaptures(unsorted().length); });
  updatePings();
  // Spoken morning briefing (if switched on): now, and whenever the window comes back to front later in the morning.
  autoReadBriefing();
  window.addEventListener('focus', autoReadBriefing);
  document.addEventListener('visibilitychange', autoReadBriefing);
}

async function start() {
  applyTheme(state.settings.theme);
  document.documentElement.dataset.motion = state.settings.motion;
  document.documentElement.classList.toggle('is-tauri', platform.isTauri);
  document.documentElement.classList.toggle('is-android', platform.isCapacitor);

  state.meta.lastOpened = todayKey();

  // The launch plays on every cold start (and on every reopen from the tray); a reload in the same session skips it.
  const launch = sessionStorage.getItem('booted') !== '1';
  sessionStorage.setItem('booted', '1');

  const canvas = h('canvas#backdrop', { 'aria-hidden': 'true' });
  mainEl = h('main#main', { tabindex: -1 });
  document.body.prepend(canvas, h('div.vignette'), h('div.grain'));
  document.body.append(h('div.app', rail, statusBar(), mainEl), dock, mountVoicePill());
  if (launch) mountLaunch();

  forgivePenalties();
  settle();
  save();

  backdrop = createBackdrop(canvas, { boot: true, hold: launch, home: { lat: state.settings.home.lat, lon: state.settings.home.lon, label: state.settings.home.city } });
  onTheme(() => { backdrop.refresh(); updatePings(); });

  onRoute(() => { showMore(false); markCurrent(); });
  subscribe(() => { updatePings(); markCurrent(); if (pointsOn() !== !!routeList().find(r => r.id === 'rank')) buildNav(); paintStatus(); paintTalk(); });
  onSyncStatus(paintSync);
  paintSync();
  paintStatus();
  setInterval(paintStatus, 1000);

  // day rollover
  let day = todayKey();
  const rollover = () => { if (todayKey() !== day) { day = todayKey(); settle(); save(); } };
  setInterval(rollover, 30000);
  window.addEventListener('focus', rollover);

  initPalette();

  // Desktop window: maximize/restore glyph, buttons dim while the window is inactive, Alt+F4 closes like
  // the close button, and a window that was closed replays the launch when it is opened again.
  onMaximized(paintMaximized);
  window.addEventListener('blur', () => document.documentElement.classList.add('win-blurred'));
  window.addEventListener('focus', () => document.documentElement.classList.remove('win-blurred'));
  onShellEvent('os://close', closeWindow);
  onShellEvent('os://shown', openWindow);
  // The first click or key ends the render hold, so the user's own changes show at once.
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => holdRenders(0), { capture: true });

  if (!launch) {
    showView();
    backdrop.play();
    startServices();
    launchReady();
  } else {
    await fontsReady();
    phase = 'closed';
    if (await launchReady()) {
      await openWindow();
    } else {
      showView();   // autostart keeps the window in the tray: prepare the view; the launch plays when it opens
    }
    startServices();
  }

  if ('serviceWorker' in navigator && platform.kind === 'web' && import.meta.env.PROD) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
