// Connection rows (Google accounts, Slack, ICS) with encrypted secrets.
import { db, j } from '../db.js';
import { encrypt, decrypt, uid } from '../lib/crypto.js';

const COLORS = ['#7FA8FF', '#5ED6C8', '#B79CFF', '#FF7A90', '#9BE07A', '#E8C872'];

export function rowToConn(r) {
  if (!r) return null;
  return {
    id: r.id, provider: r.provider, account: r.account, label: r.label, color: r.color,
    features: j.parse(r.features, []), config: j.parse(r.config, {}), status: r.status,
    lastError: r.last_error, lastSyncAt: r.last_sync_at, createdAt: r.created_at,
    secret: () => decrypt(r.secret_enc),
    accessToken: r.access_token_enc ? decrypt(r.access_token_enc) : null,
    accessExpires: r.access_expires
  };
}

export const publicConn = c => ({
  id: c.id, provider: c.provider, account: c.account, label: c.label, color: c.color, features: c.features,
  config: c.provider === 'ics' ? { kind: c.config.kind } : c.config, status: c.status, lastError: c.lastError, lastSyncAt: c.lastSyncAt
});

export const listConnections = (provider) => (provider
  ? db.all('SELECT * FROM connections WHERE provider = ? ORDER BY created_at', provider)
  : db.all('SELECT * FROM connections ORDER BY created_at')).map(rowToConn);
export const getConnection = id => rowToConn(db.get('SELECT * FROM connections WHERE id = ?', id));

export function createConnection({ provider, account, label, features = [], secret, config = {} }) {
  const id = uid(provider + '_');
  const n = db.get('SELECT COUNT(*) n FROM connections').n;
  db.run(`INSERT INTO connections (id, provider, account, label, color, features, secret_enc, config, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?)`,
    id, provider, account, label || account, COLORS[n % COLORS.length], j.str(features), encrypt(secret), j.str(config), Date.now());
  return getConnection(id);
}

export function updateConnection(id, patch) {
  const sets = [], vals = [];
  const map = { account: 'account', label: 'label', color: 'color', status: 'status', lastError: 'last_error', lastSyncAt: 'last_sync_at', accessExpires: 'access_expires' };
  for (const [k, col] of Object.entries(map)) if (k in patch) { sets.push(col + ' = ?'); vals.push(patch[k]); }
  if ('features' in patch) { sets.push('features = ?'); vals.push(j.str(patch.features)); }
  if ('config' in patch) { sets.push('config = ?'); vals.push(j.str(patch.config)); }
  if ('secret' in patch) { sets.push('secret_enc = ?'); vals.push(encrypt(patch.secret)); }
  if ('accessToken' in patch) { sets.push('access_token_enc = ?'); vals.push(patch.accessToken ? encrypt(patch.accessToken) : null); }
  if (!sets.length) return getConnection(id);
  db.run(`UPDATE connections SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
  return getConnection(id);
}

export function deleteConnection(id) {
  db.tx(() => {
    db.run('DELETE FROM calendar_events WHERE connection_id = ?', id);
    db.run('DELETE FROM emails WHERE connection_id = ?', id);
    db.run('DELETE FROM connections WHERE id = ?', id);
  });
}

export function markSynced(id, error = null) {
  db.run('UPDATE connections SET last_sync_at = ?, last_error = ?, status = CASE WHEN ? IS NULL AND status = \'error\' THEN \'ok\' WHEN ? IS NOT NULL AND status = \'ok\' THEN \'error\' ELSE status END WHERE id = ?',
    Date.now(), error, error, error, id);
}
