// Single-user auth: the master API_TOKEN pairs devices; each device gets its own revocable token.
import { config } from './config.js';
import { db } from './db.js';
import { sha256, safeEqual, randomToken, uid } from './lib/crypto.js';
import { HttpError } from './http.js';

export function resolveToken(token) {
  if (!token) return null;
  if (safeEqual(token, config.apiToken)) return { userId: 1, deviceId: 'master' };
  const row = db.get('SELECT id, user_id FROM devices WHERE token_hash = ? AND revoked = 0', sha256(token));
  if (!row) return null;
  db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', Date.now(), row.id);
  return { userId: row.user_id, deviceId: row.id };
}

/* Hono middleware: sets c.var.user = {userId, deviceId}. */
export async function requireAuth(c, next) {
  const h = c.req.header('Authorization') || '';
  const user = resolveToken(h.replace(/^Bearer\s+/i, ''));
  if (!user) throw new HttpError(401, 'Unauthorized');
  c.set('user', user);
  await next();
}

export function pairDevice({ name, platform }) {
  const token = randomToken(32);
  const id = uid('dev_');
  db.run('INSERT INTO devices (id, name, platform, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    id, String(name || 'Device').slice(0, 80), String(platform || '').slice(0, 20), sha256(token), Date.now());
  return { id, token };
}
