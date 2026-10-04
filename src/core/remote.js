// Stale-while-revalidate cache for server data shown in views (news, inbox, AI models …).
// remote('news', '/api/news/digest/latest', 10*60e3) returns the cached value immediately
// and refreshes in the background; the active view re-renders when fresh data arrives.
import { notify } from './store.js';
import { apiConfig, api } from './api.js';

const PREFIX = 'agenticCache:';
const mem = {};
const inflight = {};

function readCache(key) {
  if (mem[key]) return mem[key];
  try { const v = JSON.parse(localStorage.getItem(PREFIX + key) || 'null'); if (v) mem[key] = v; return v; } catch { return null; }
}

export function remote(key, path, maxAge = 5 * 60000) {
  const c = readCache(key);
  if (apiConfig() && (!c || Date.now() - c.at > maxAge) && !inflight[key]) refresh(key, path);
  return { data: c ? c.data : null, at: c ? c.at : 0, loading: !!inflight[key], error: c ? c.error : null, connected: !!apiConfig() };
}

export async function refresh(key, path) {
  if (!apiConfig()) return;
  inflight[key] = true;
  try {
    const data = await api.get(path);
    mem[key] = { data, at: Date.now() };
    try { localStorage.setItem(PREFIX + key, JSON.stringify(mem[key])); } catch { /* quota */ }
  } catch (e) {
    mem[key] = { ...(readCache(key) || { data: null }), at: Date.now(), error: e };
  } finally {
    delete inflight[key];
    notify();
  }
}

export function invalidate(key) { delete mem[key]; localStorage.removeItem(PREFIX + key); }
