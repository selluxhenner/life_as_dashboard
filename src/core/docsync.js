// Document sync: everything that isn't a todo or a job (those have their own tables).
// The state is cut into small documents ("dayplan:2026-10-05", "habit:<id>", "capture:<id>", "settings", …).
// Changes are found by fingerprinting each document, so no view has to report its edits.
// Last write wins per document; a document that disappears is sent as a tombstone.
// Pure functions of the state (no DOM, no network) — covered by tests/docsync.test.js.

/* Date-keyed maps synced one day (or week) per document. */
const DAY_MAPS = ['dayplan', 'weekplan', 'weekFocus', 'reflections', 'routines', 'focus'];
/* Settings that follow you between devices. Sound and motion stay per device. */
const SHARED_SETTINGS = ['theme', 'home', 'briefingTime', 'flags', 'voice'];

const VALID_KEY = /^[\w:.-]{1,120}$/;   // what the server accepts; odd legacy ids just stay local

export function units(state) {
  const out = new Map();
  const put = (k, v) => { if (VALID_KEY.test(k)) out.set(k, v); };
  for (const map of DAY_MAPS) for (const [k, v] of Object.entries(state[map] || {})) put(map + ':' + k, v);
  for (const hb of state.habits || []) put('habit:' + hb.id, hb);
  for (const c of state.captures || []) put('capture:' + c.id, c);
  put('goals', state.ziele);
  put('fitness', state.fitness);
  put('profile', { name: state.name });
  const s = {};
  for (const k of SHARED_SETTINGS) if (state.settings[k] !== undefined) s[k] = state.settings[k];
  put('settings', s);
  return out;
}

/* Writes one document into the state (value undefined = delete). */
export function applyUnit(state, key, value) {
  const i = key.indexOf(':');
  const kind = i === -1 ? key : key.slice(0, i), id = i === -1 ? '' : key.slice(i + 1);
  if (DAY_MAPS.includes(kind)) {
    if (!state[kind]) state[kind] = {};
    if (value === undefined) delete state[kind][id]; else state[kind][id] = value;
  } else if (kind === 'habit' || kind === 'capture') {
    const list = kind === 'habit' ? state.habits : state.captures;
    const at = list.findIndex(x => x.id === id);
    if (value === undefined) { if (at !== -1) list.splice(at, 1); }
    else if (at === -1) { if (kind === 'capture') list.unshift(value); else list.push(value); }
    else list[at] = value;
  } else if (value === undefined) {
    // singletons are never deleted
  } else if (kind === 'goals') state.ziele = value;
  else if (kind === 'fitness') state.fitness = value;
  else if (kind === 'profile') { if (value.name) state.name = value.name; }
  else if (kind === 'settings') Object.assign(state.settings, value);
}

/* FNV-1a, enough to notice that a document changed. */
export function fingerprint(value) {
  const s = JSON.stringify(value) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/* Marks every document that changed since the last scan as dirty. Returns the number found. */
export function scan(state, now = Date.now()) {
  const known = state.sync.docs, dirty = state.sync.docsDirty;
  const cur = units(state);
  let n = 0;
  for (const [k, v] of cur) {
    const f = fingerprint(v);
    if (!known[k] || known[k].del || known[k].f !== f) {
      known[k] = { f, at: Math.max(now, (known[k]?.at || 0) + 1) };
      dirty[k] = true; n++;
    }
  }
  for (const k of Object.keys(known)) {
    if (!cur.has(k) && !known[k].del) { known[k] = { f: 0, at: Math.max(now, known[k].at + 1), del: true }; dirty[k] = true; n++; }
  }
  return n;
}

/* Documents to upload: [{key, value, updatedAt, deleted}] */
export function outbox(state, limit = 200) {
  const cur = units(state);
  return Object.keys(state.sync.docsDirty).slice(0, limit).map(k => {
    const m = state.sync.docs[k];
    return m.del ? { key: k, updatedAt: m.at, deleted: true } : { key: k, value: cur.get(k), updatedAt: m.at };
  });
}

/* After a successful upload: clear what was sent, unless it changed again meanwhile. */
export function acknowledge(state, sent) {
  for (const d of sent) if (state.sync.docs[d.key]?.at === d.updatedAt) delete state.sync.docsDirty[d.key];
}

/* Takes documents from the server. Newer local edits win. Returns true if the state changed. */
export function receive(state, remote) {
  const known = state.sync.docs, dirty = state.sync.docsDirty;
  let changed = false;
  for (const r of remote) {
    const m = known[r.key];
    if (m && m.at >= r.updatedAt) continue;                 // ours is as new or newer (incl. our own echo)
    applyUnit(state, r.key, r.deleted ? undefined : r.value);
    known[r.key] = r.deleted ? { f: 0, at: r.updatedAt, del: true } : { f: fingerprint(r.value), at: r.updatedAt };
    delete dirty[r.key];
    changed = true;
  }
  return changed;
}

/*
 * First sync of a device that already has data: the server copy wins, but nothing is lost or doubled.
 * - habits with the same name are one habit (ticks from both are kept)
 * - plan blocks / week to-dos of the same day are combined
 * - routines and reflections keep fields only this device filled in
 * Everything only this device has is uploaded afterwards by scan().
 */
export function firstMerge(state, remote) {
  const live = structuredClone(remote.filter(r => !r.deleted));
  const serverPrint = new Map(live.map(r => [r.key, fingerprint(r.value)]));   // before any combining
  const byKey = new Map(live.map(r => [r.key, r.value]));
  const sameLabel = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

  // habits: local duplicates (by name) fold into the server's habit
  const remoteHabits = live.filter(r => r.key.startsWith('habit:')).map(r => r.value);
  state.habits = state.habits.filter(hb => {
    if (byKey.has('habit:' + hb.id)) { byKey.get('habit:' + hb.id).history = { ...hb.history, ...byKey.get('habit:' + hb.id).history }; return true; }
    const twin = remoteHabits.find(r => sameLabel(r.label, hb.label));
    if (!twin) return true;
    twin.history = { ...hb.history, ...twin.history };
    return false;
  });

  const merged = [];
  for (const r of live) {
    const [kind, id] = [r.key.split(':')[0], r.key.slice(r.key.indexOf(':') + 1)];
    let value = r.value;
    if ((kind === 'dayplan' || kind === 'weekplan') && Array.isArray(state[kind]?.[id])) {
      const extra = state[kind][id].filter(b => !value.some(x => x.id === b.id || (sameLabel(x.label, b.label) && (x.time || '') === (b.time || ''))));
      if (extra.length) { value = [...value, ...extra]; merged.push(r.key); }
    } else if ((kind === 'routines' || kind === 'reflections') && state[kind]?.[id]) {
      const local = state[kind][id], out = { ...value };
      for (const [k, v] of Object.entries(local)) if ((out[k] == null || out[k] === '' || out[k] === false) && v != null && v !== '' && v !== false) { out[k] = v; merged.push(r.key); }
      value = out;
    } else if (kind === 'focus' && typeof state.focus?.[id] === 'number') {
      if (state.focus[id] > value) { value = state.focus[id]; merged.push(r.key); }
    }
    applyUnit(state, r.key, value);
    state.sync.docs[r.key] = { f: serverPrint.get(r.key), at: r.updatedAt };
  }
  // combined documents differ from the server copy, so scan() uploads them
  return [...new Set(merged)];
}
