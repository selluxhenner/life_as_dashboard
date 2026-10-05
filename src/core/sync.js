// Sync with the server: todos (POST /api/sync), jobs (/api/jobs/sync) and every other part of the state
// as documents (/api/docs/sync, see docsync.js). Last-writer-wins on updatedAt; tombstones for deletes.
import { state, persist, notify, onSave } from './store.js';
import { apiConfig, apiFetch, setApiConfig } from './api.js';
import { scan, outbox, acknowledge, receive, firstMerge } from './docsync.js';
import { applyTheme } from './theme.js';

const SYNC_BATCH = 200;
const TOMBSTONE_TTL = 30 * 86400000;
let timer = null, busy = false;

export const syncStatus = { state: 'off', msg: '', latency: null };
const statusListeners = new Set();
export function onSyncStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
function setStatus(st, msg = '') {
  syncStatus.state = st; syncStatus.msg = msg;
  statusListeners.forEach(fn => fn(syncStatus));
}

export function scheduleSync(delay = 800) {
  if (!apiConfig()) return;
  clearTimeout(timer);
  timer = setTimeout(runSync, delay);
}

export function mergeRemote(todos) {
  let changed = false;
  const byId = Object.fromEntries(state.tasks.map(t => [t.id, t]));
  for (const r of todos) {
    const local = byId[r.id];
    if (!local) { if (!r.deleted) { state.tasks.push(r); changed = true; } continue; }
    if (state.sync.dirty[r.id] && local.updatedAt > r.updatedAt) continue;
    if (local.updatedAt !== r.updatedAt || local.deleted !== r.deleted) changed = true;
    Object.assign(local, r);
    delete state.sync.dirty[r.id];
  }
  const cutoff = Date.now() - TOMBSTONE_TTL;
  state.tasks = state.tasks.filter(t => !(t.deleted && !state.sync.dirty[t.id] && t.updatedAt < cutoff));
  return changed;
}

/* Job hunt entries: same idea as todos, separate cursor. The agent on the server can add roles too. */
async function syncJobs(cfg) {
  const dirty = state.sync.jobsDirty || {};
  const ids = Object.keys(dirty).slice(0, SYNC_BATCH);
  const sent = {};
  const upserts = ids.map(id => state.jobs.find(j => j.id === id)).filter(Boolean).map(j => { sent[j.id] = j.updatedAt; return structuredClone(j); });
  const res = await apiFetch(cfg, '/api/jobs/sync', { since: state.sync.jobsCursor || 0, upserts });
  for (const id of ids) { const j = state.jobs.find(x => x.id === id); if (!j || j.updatedAt === sent[id]) delete dirty[id]; }
  let changed = false;
  for (const r of res.jobs || []) {
    const local = state.jobs.find(j => j.id === r.id);
    if (!local) { if (!r.deleted) { state.jobs.push(r); changed = true; } continue; }
    if (dirty[r.id] && local.updatedAt > r.updatedAt) continue;
    if (local.updatedAt !== r.updatedAt) { Object.assign(local, r); changed = true; }
  }
  state.sync.jobsDirty = dirty;
  state.sync.jobsCursor = res.cursor;
  return changed;
}

/* Plan blocks, habits, captures, goals, routines, reflections, week planner, weight, shared settings. */
async function syncDocs(cfg) {
  const s = state.sync;
  let changed = false;
  if (!s.docs || !s.docsReady) {
    // first sync of this device: take what the server has, combine, then upload what only this device has
    s.docs = {}; s.docsDirty = {};
    let since = 0;
    const all = [];
    for (;;) {
      const r = await apiFetch(cfg, '/api/docs/sync', { since, upserts: [] });
      all.push(...(r.docs || [])); since = r.cursor;
      if (!r.more) break;
    }
    firstMerge(state, all);
    s.docsCursor = since; s.docsReady = true;
    changed = all.length > 0;
  }
  scan(state);
  for (let round = 0; round < 20; round++) {
    const sent = outbox(state);
    const r = await apiFetch(cfg, '/api/docs/sync', { since: s.docsCursor, upserts: sent });
    acknowledge(state, sent);
    if (receive(state, r.docs || [])) changed = true;
    s.docsCursor = r.cursor;
    if (!r.more && !Object.keys(s.docsDirty).length) break;
  }
  if (changed) applyTheme(state.settings.theme);
  return changed;
}

export async function runSync() {
  const cfg = apiConfig();
  if (!cfg) { setStatus('off'); return; }
  if (busy) { scheduleSync(1500); return; }
  busy = true;
  setStatus('busy');
  const ids = Object.keys(state.sync.dirty).slice(0, SYNC_BATCH);
  const sent = {};
  const upserts = [];
  for (const id of ids) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) { delete state.sync.dirty[id]; continue; }
    sent[id] = t.updatedAt;
    upserts.push(structuredClone(t));
  }
  const t0 = performance.now();
  try {
    const res = await apiFetch(cfg, '/api/sync', { since: state.sync.cursor, upserts });
    syncStatus.latency = Math.round(performance.now() - t0);
    for (const id of Object.keys(sent)) {
      const t = state.tasks.find(x => x.id === id);
      if (!t || t.updatedAt === sent[id]) delete state.sync.dirty[id];
    }
    // a server without /api/docs yet (not redeployed) must not break todo and job sync
    const docs = await syncDocs(cfg).catch(e => { if (e && e.kind === 'server' && /not found|404/i.test(e.msg)) return false; throw e; });
    const changed = mergeRemote(res.todos || []) | await syncJobs(cfg) | docs;
    state.sync.cursor = res.cursor;
    state.sync.lastSync = Date.now();
    persist();
    busy = false;
    setStatus('ok');
    if (changed) notify();
    if (Object.keys(state.sync.dirty).length) scheduleSync(300);
  } catch (err) {
    busy = false;
    if (err && err.kind === 'auth') setStatus('auth');
    else if (err && err.kind === 'server') setStatus('error', err.msg);
    else setStatus('offline');
  }
}

/* First connect: pull server state, upload only local todos that don't exist there (by id or title). */
export async function connectSync(url, token) {
  const cfg = { url: url.trim(), token: token.trim() };
  setStatus('busy');
  const res = await apiFetch(cfg, '/api/sync', { since: 0, upserts: [] });
  const remote = res.todos || [];
  const remoteIds = new Set(remote.map(r => r.id));
  const remoteTitles = new Set(remote.filter(r => !r.deleted).map(r => r.title.trim().toLowerCase()));
  setApiConfig(cfg);
  state.sync = { cursor: 0, dirty: {}, lastSync: 0, jobsCursor: 0, jobsDirty: Object.fromEntries((state.jobs || []).map(j => [j.id, true])) };
  state.tasks = state.tasks.filter(t => {
    if (remoteIds.has(t.id)) return true;
    if (t.deleted || remoteTitles.has(t.title.trim().toLowerCase())) return false;
    state.sync.dirty[t.id] = true;
    return true;
  });
  mergeRemote(remote);
  state.sync.cursor = res.cursor;
  persist();
  await runSync();
  notify();
}

export function disconnectSync() {
  setApiConfig(null);
  state.sync = { cursor: 0, dirty: {}, lastSync: 0 };
  persist();
  setStatus('off');
}

export function initSync() {
  window.addEventListener('online', () => scheduleSync(0));
  window.addEventListener('focus', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(0); });
  setInterval(() => { if (!document.hidden) scheduleSync(0); }, 30000);
  onSave(() => scheduleSync(1500));               // any edit goes up a moment later
  setStatus(apiConfig() ? 'busy' : 'off');
  scheduleSync(0);
}
