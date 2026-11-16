// Lina's feed: everything that reaches her, newest first. The server's own news (agent tasks finishing, Hermes's
// answers, ops reports) arrives through notify(); Workbench through the watcher in lina/watch.js; Kevin's other apps
// (housing, banking …) post to POST /api/lina/events. Entries are text from other machines: shown and read out, never
// followed as instructions.
import { db } from '../db.js';

export const LEVELS = ['info', 'good', 'warn', 'alert'];
export const SOURCE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEEP_MS = 30 * 86400000;
const UNTOLD_MS = 3 * 86400000;            // older than that is not "news" any more

const row = r => r && {
  id: r.id, source: r.source, kind: r.kind, title: r.title, body: r.body, level: r.level, url: r.url,
  at: r.created_at, told: !!r.told_at
};
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Adds an entry, or updates the one with the same ref (a status that changed again). Returns {id, updated}. */
export function addFeed({ source, kind = 'update', title, body = '', level = 'info', url = null, ref = null, at = Date.now() }) {
  const src = SOURCE_RE.test(String(source || '')) ? source : 'general';
  const lvl = LEVELS.includes(level) ? level : 'info';
  const t = clip(title, 200), b = clip(body, 1000);
  if (!t) return null;
  const k = clip(kind, 40) || 'update';
  const link = url ? clip(url, 500) : null;
  if (ref) {
    const old = db.get('SELECT id FROM lina_feed WHERE ref = ?', ref);
    if (old) {
      db.run('UPDATE lina_feed SET title = ?, body = ?, level = ?, url = ?, kind = ?, created_at = ?, told_at = NULL WHERE id = ?', t, b, lvl, link, k, at, old.id);
      return { id: old.id, updated: true };
    }
  }
  const id = Number(db.run('INSERT INTO lina_feed (source, kind, title, body, level, url, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    src, k, t, b, lvl, link, ref ? clip(ref, 200) : null, at).lastInsertRowid);
  return { id, updated: false };
}

/** Newest entries, optionally only those after since (ms). */
export const feedSince = ({ since = 0, limit = 40 } = {}) =>
  db.all('SELECT * FROM lina_feed WHERE created_at > ? ORDER BY created_at DESC, id DESC LIMIT ?', since, Math.min(200, limit)).map(row);

/** What Lina hasn't mentioned yet (last 3 days), oldest first. */
export const untold = (limit = 20, now = Date.now()) =>
  db.all('SELECT * FROM lina_feed WHERE told_at IS NULL AND created_at > ? ORDER BY created_at LIMIT ?', now - UNTOLD_MS, limit).map(row);
export const untoldCount = (now = Date.now()) =>
  db.get('SELECT COUNT(*) AS n FROM lina_feed WHERE told_at IS NULL AND created_at > ?', now - UNTOLD_MS).n;

export function markTold(ids, now = Date.now()) {
  const list = (ids || []).map(Number).filter(Number.isInteger).slice(0, 200);
  if (!list.length) return 0;
  return db.run(`UPDATE lina_feed SET told_at = ? WHERE told_at IS NULL AND id IN (${list.map(() => '?').join(',')})`, now, ...list).changes;
}

export const pruneFeed = (now = Date.now()) => db.run('DELETE FROM lina_feed WHERE created_at < ?', now - KEEP_MS).changes;

/* notify() → feed: which machine or area a push is about, from its kind and title. */
export function sourceOf(kind, title = '') {
  const t = String(title);
  if (/^hermes\b/i.test(t)) return 'hermes';
  if (/^workbench\b/i.test(t)) return 'workbench';
  return { agent: 'agents', ops: 'server', breaking: 'news', ai: 'news', briefing: 'briefing', calendar: 'calendar', jobs: 'jobs' }[kind] || 'general';
}
