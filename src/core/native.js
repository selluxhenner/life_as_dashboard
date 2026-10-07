// Android: the native side (android/app/src/main/java/com/kevinschmid/lifeos/pulse) shows notifications while the app
// is closed — the morning briefing at its time, breaking world news, major AI news — and feeds the home-screen widget,
// the Quick Settings tile and the lock-screen card. This module hands it the server and device token, opens the page a
// notification points to, and reports whether alerts can actually arrive (Settings › Notifications).
import { registerPlugin } from '@capacitor/core';
import { platform } from './platform.js';
import { apiConfig } from './api.js';
import { onSyncStatus } from './sync.js';

export const native = platform.isCapacitor ? registerPlugin('AgenticNative') : null;

const ASKED = 'agenticNotifyAsked';
let handedOver = null;                 // "url\ntoken" last given to the native side
const actions = {};
const statusListeners = new Set();
export let nativeStatus = null;

function setStatus(st) {
  if (!st) return st;
  nativeStatus = st;
  statusListeners.forEach(fn => fn(st));
  return st;
}
export function onNativeStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }

/** Calls a plugin method and keeps the status it returns. */
export async function nativeCall(method, args) {
  if (!native) return null;
  return setStatus(await native[method](args));
}

/** Give the native side the current server + token (or switch it off after Disconnect). Asks for the
    notification permission once, right after the first connect. */
export async function syncNative(force = false) {
  if (!native) return null;
  const cfg = apiConfig();
  const key = cfg ? cfg.url + '\n' + cfg.token : '';
  if (key === handedOver && !force) return nativeStatus;
  handedOver = key;
  try {
    let st = setStatus(cfg ? await native.configure({ url: cfg.url, token: cfg.token }) : await native.disable());
    if (cfg && st.notifications === 'prompt' && localStorage.getItem(ASKED) !== '1') {
      localStorage.setItem(ASKED, '1');
      st = setStatus(await native.requestNotifications());
    }
    return st;
  } catch { handedOver = null; return null; }
}

/** What "?do=listen" / "?do=ask" on a notification or shortcut does (registered by main.js). */
export function onNativeAction(name, fn) { actions[name] = fn; }

/** Ask the native side to check the server now (the app does this every minute while it is open). */
export function nativeCheck() { if (native && apiConfig()) native.checkNow().then(setStatus).catch(() => {}); }

export function initNative() {
  if (!native) return;
  native.addListener('route', ({ route, action }) => {
    if (route && location.hash !== '#/' + route) location.hash = '#/' + route;
    if (action && actions[action]) setTimeout(() => actions[action](), 350);    // after the page has rendered
  });
  syncNative();
  onSyncStatus(() => syncNative());
}
