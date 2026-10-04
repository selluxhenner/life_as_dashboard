// SQLite through Node's built-in driver (no native addon to compile on the server).
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, ROOT } from './config.js';

export const sqlite = new DatabaseSync(process.env.DB_PATH || resolve(config.dataDir, 'agentic.db'));
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const cache = new Map();
const stmt = sql => { let s = cache.get(sql); if (!s) { s = sqlite.prepare(sql); cache.set(sql, s); } return s; };
const clean = params => params.map(p => p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p);

export const db = {
  all: (sql, ...p) => stmt(sql).all(...clean(p)),
  get: (sql, ...p) => stmt(sql).get(...clean(p)),
  run: (sql, ...p) => stmt(sql).run(...clean(p)),
  exec: sql => sqlite.exec(sql),
  /* Runs fn inside a transaction; rolls back on throw. */
  tx(fn) {
    sqlite.exec('BEGIN');
    try { const r = fn(); sqlite.exec('COMMIT'); return r; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  }
};

export function migrate() {
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.all('SELECT name FROM schema_migrations').map(r => r.name));
  const dir = resolve(ROOT, 'migrations');
  const applied = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.tx(() => {
      sqlite.exec(readFileSync(resolve(dir, f), 'utf8'));
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', f, Date.now());
    });
    applied.push(f);
  }
  return applied;
}

/* JSON helpers for TEXT columns */
export const j = { parse: (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } }, str: v => JSON.stringify(v ?? null) };
