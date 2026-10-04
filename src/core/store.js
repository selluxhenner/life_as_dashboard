// Single app state in localStorage + a tiny pub/sub so the active view re-renders on change.
import { STORE_KEY, OLD_STORE_KEYS, migrate, freshState } from './migrations.js';

const BACKUP_KEY = STORE_KEY + '_backup_v1';

function read(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function load() {
  const raw = localStorage.getItem(STORE_KEY);
  // Keep one untouched copy of the pre-v2 state, in case a migration ever needs to be redone.
  if (raw && !localStorage.getItem(BACKUP_KEY)) {
    try { localStorage.setItem(BACKUP_KEY, raw); } catch { /* quota: not fatal */ }
  }
  const s = read(STORE_KEY) || OLD_STORE_KEYS.map(read).find(Boolean);
  return s ? migrate(s) : migrate(freshState());
}

export const state = load();

const listeners = new Set();
let queued = false;
let saveHooks = [];

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onSave(fn) { saveHooks.push(fn); }

export function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.error('save failed', e); }
}

/* save(): persist now, notify listeners once per frame. */
export function save() {
  persist();
  saveHooks.forEach(fn => fn());
  notify();
}

export function notify() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; listeners.forEach(fn => fn()); });
}
