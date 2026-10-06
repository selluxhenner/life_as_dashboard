// Hash router: #/home, #/calendar … Re-renders the active view when the store changes,
// but never while the user is typing in it (the render is deferred until focus leaves).
import { subscribe } from './store.js';
import { setPanelIntro } from '../components/panel.js';
import { clear } from './dom.js';
import { scrollRoot } from './platform.js';

let routes = [];
let current = null;
let root = null;
let pending = false;
let held = false, stale = false, holdTimer = 0;
const listeners = new Set();

export function onRoute(fn) { listeners.add(fn); }
export function routeList() { return routes.filter(r => !r.hidden || !r.hidden()); }
export function currentRoute() { return current; }
export function go(id) { if (location.hash !== '#/' + id) location.hash = '#/' + id; else render(true); }

function editing() {
  const a = document.activeElement;
  return a && root.contains(a) && a.matches('input, textarea, select, [contenteditable]') && a.type !== 'checkbox';
}

/* Identify the focused field so it can be found again after a rebuild. */
function fieldKey(el) {
  return el.id ? '#' + CSS.escape(el.id)
    : el.getAttribute('aria-label') ? `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(el.getAttribute('aria-label'))}"]`
    : el.getAttribute('placeholder') ? `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(el.getAttribute('placeholder'))}"]`
    : null;
}

export function render(intro = false) {
  if (!current) return;
  let restore = null;
  if (!intro && editing()) {
    const a = document.activeElement;
    const key = fieldKey(a);
    // Selects and fields without a stable key can't be restored: wait until focus leaves.
    if (!key || a.tagName === 'SELECT' || root.querySelectorAll(key).length !== 1) { pending = true; return; }
    restore = { key, value: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  pending = false;
  setPanelIntro(intro);
  const y = scrollRoot().scrollTop;
  if (current.view.unmount) current.view.unmount();   // views release timers before every rebuild
  clear(root);
  current.view.render(root);
  setPanelIntro(false);
  if (!intro) scrollRoot().scrollTop = y;
  if (restore) {
    const el = root.querySelector(restore.key);
    if (el) {
      el.value = restore.value;
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(restore.s, restore.e); } catch { /* number/date inputs */ }
    }
  }
}

function resolve() {
  const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'home';
  const next = routes.find(r => r.id === id && (!r.hidden || !r.hidden())) || routes[0];
  if (current && current !== next && current.view.unmount) current.view.unmount();
  current = next;
  document.title = next.label + ' · Agentic OS';
  render(true);
  scrollRoot().scrollTop = 0;
  listeners.forEach(fn => fn(next));
}

/* While the launch animation plays, store changes (a sync landing, weather, news) wait instead of rebuilding
   the view under its intro. They render once when the hold ends: after ms, or holdRenders(0). */
export function holdRenders(ms) {
  clearTimeout(holdTimer);
  held = ms > 0;
  if (held) holdTimer = setTimeout(() => holdRenders(0), ms);
  else if (stale) { stale = false; render(); }
}

export function initRouter(rootEl, routeTable) {
  root = rootEl;
  routes = routeTable;
  window.addEventListener('hashchange', () => { stale = false; holdRenders(0); resolve(); });   // navigating renders anyway
  root.addEventListener('focusout', () => setTimeout(() => { if (pending && !editing()) render(); }, 0));
  subscribe(() => { if (held) stale = true; else render(); });
  resolve();
}
