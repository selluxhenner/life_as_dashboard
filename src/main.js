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
import { initRouter, onRoute, routeList, go, currentRoute } from './core/router.js';
import { initSync, onSyncStatus, syncStatus } from './core/sync.js';
import { initCal } from './core/calendar-sync.js';
import { applyTheme, onTheme } from './core/theme.js';
import { platform, windowAction } from './core/platform.js';
import { todayKey, fmt } from './core/dates.js';
import { createBackdrop } from './components/backdrop.js';
import { weatherNow, conditionOf } from './core/weather.js';
import { initPalette, openPalette } from './components/palette.js';
import { boot } from './components/boot.js';
import { settle, forgivePenalties, pointsOn, totalPoints, rankView } from './features/points/points.js';
import { remote } from './core/remote.js';
import { newsData, digestStories } from './views/news.js';
import { pendingActions } from './views/assistant.js';
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
import { unsorted } from './features/capture/captures.js';
import { initNotifications } from './core/notifications.js';

const ROUTES = [
  { id: 'home', label: 'Home', short: 'Overview', icon: 'home', view: home, dock: true, key: 'G H' },
  { id: 'captures', label: 'Captures', short: 'Notes', icon: 'capture', view: captures, dock: true, key: 'G N' },
  { id: 'today', label: 'Today', icon: 'today', view: today, dock: true, key: 'G T' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', view: calendar, key: 'G C' },
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
const rail = h('nav.rail', { 'aria-label': 'Main' });
const dock = h('nav.dock', { 'aria-label': 'Main' });

function buildNav() {
  rail.replaceChildren(h('div.mark', mark()), ...navLinks(r => !r.bottom), h('div.spacer'), ...navLinks(r => r.bottom));
  dock.replaceChildren(...navLinks(r => r.dock, true), h('button', { type: 'button', onclick: openSheet }, icon('more'), h('span', 'More')));
  markCurrent();
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
}
function openSheet() {
  const sheet = h('div.sheet', { onclick: e => { if (e.target === sheet || e.target.closest('a')) sheet.remove(); } },
    h('div.panel', h('nav', navLinks(r => !r.dock))));
  document.body.append(sheet);
  markCurrent();
}

function statusBar() {
  return h('header.status', { 'data-tauri-drag-region': '' },
    h('span.wordmark', 'AGENTIC', h('span', '/'), 'OS'),
    h('span.sep.hide-m'), crumb,
    h('span.push'),
    weatherEl, pointsEl,
    h('button.kbd.hide-m', { type: 'button', onclick: openPalette, title: 'Command palette' }, 'Ctrl K'),
    syncBtn,
    clockEl,
    h('div.win',
      h('button', { type: 'button', 'aria-label': 'Minimise', onclick: () => windowAction('min') }, icon('min')),
      h('button', { type: 'button', 'aria-label': 'Maximise', onclick: () => windowAction('max') }, icon('max')),
      h('button.close', { type: 'button', 'aria-label': 'Hide window', onclick: () => windowAction('close') }, icon('x'))));
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

/* ---------- boot ---------- */
async function start() {
  applyTheme(state.settings.theme);
  document.documentElement.dataset.motion = state.settings.motion;
  document.documentElement.classList.toggle('is-tauri', platform.isTauri);
  document.documentElement.classList.toggle('is-android', platform.isCapacitor);

  const firstToday = state.meta.lastOpened !== todayKey();
  state.meta.lastOpened = todayKey();

  const canvas = h('canvas#backdrop', { 'aria-hidden': 'true' });
  const main = h('main#main', { tabindex: -1 });
  document.body.prepend(canvas, h('div.vignette'), h('div.grain'));
  document.body.append(h('div.app', rail, statusBar(), main), dock);

  forgivePenalties();
  settle();
  save();

  await boot({ skip: !firstToday && sessionStorage.getItem('booted') === '1' });
  sessionStorage.setItem('booted', '1');
  backdrop = createBackdrop(canvas, { boot: true, home: { lat: state.settings.home.lat, lon: state.settings.home.lon, label: state.settings.home.city } });
  onTheme(() => { backdrop.refresh(); updatePings(); });

  initRouter(main, ROUTES);
  buildNav();
  onRoute(markCurrent);
  subscribe(() => { updatePings(); markCurrent(); if (pointsOn() !== !!routeList().find(r => r.id === 'rank')) buildNav(); paintStatus(); });
  onSyncStatus(paintSync);
  paintSync();
  paintStatus();
  setInterval(paintStatus, 1000);

  // day rollover
  let day = todayKey();
  const rollover = () => { if (todayKey() !== day) { day = todayKey(); settle(); save(); } };
  setInterval(rollover, 30000);
  window.addEventListener('focus', rollover);

  initSync();
  initCal();
  initPalette();
  initNotifications();
  updatePings();

  if ('serviceWorker' in navigator && platform.kind === 'web' && import.meta.env.PROD) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
