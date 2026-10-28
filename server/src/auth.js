// Single-user auth: the master API_TOKEN pairs devices; each device gets its own revocable token.
// A device's scope is 'full' (the apps) or 'ops' (the agent box: may post ops reports and nothing else).
import { config } from './config.js';
import { db } from './db.js';
import { sha256, safeEqual, randomToken, uid } from './lib/crypto.js';
import { HttpError } from './http.js';

export const SCOPES = ['full', 'ops'];

export function resolveToken(token) {
  if (!token) return null;
  if (safeEqual(token, config.apiToken)) return { userId: 1, deviceId: 'master', scope: 'full' };
  const row = db.get('SELECT id, user_id, scope FROM devices WHERE token_hash = ? AND revoked = 0', sha256(token));
  if (!row) return null;
  db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', Date.now(), row.id);
  return { userId: row.user_id, deviceId: row.id, scope: row.scope || 'full' };
}

const bearer = c => resolveToken((c.req.header('Authorization') || '').replace(/^Bearer\s+/i, ''));

/* Hono middleware: sets c.var.user = {userId, deviceId, scope}. Only full-scope tokens get through. */
export async function requireAuth(c, next) {
  const user = bearer(c);
  if (!user) throw new HttpError(401, 'Unauthorized');
  if (user.scope !== 'full') throw new HttpError(403, 'This token may only post ops reports');
  c.set('user', user);
  await next();
}

/* For POST /api/ops/report: the agent box's ops token, or the master token for testing. */
export async function requireOps(c, next) {
  const user = bearer(c);
  if (!user) throw new HttpError(401, 'Unauthorized');
  if (user.scope !== 'ops' && user.deviceId !== 'master') throw new HttpError(403, 'Use an ops token');
  c.set('user', user);
  await next();
}

/* For routes both sides use (approvals): any valid token; the handler checks the scope. */
export async function requireDevice(c, next) {
  const user = bearer(c);
  if (!user) throw new HttpError(401, 'Unauthorized');
  c.set('user', user);
  await next();
}

export function pairDevice({ name, platform, scope = 'full' }) {
  if (!SCOPES.includes(scope)) throw new HttpError(400, 'scope must be ' + SCOPES.join(' or '));
  const token = randomToken(32);
  const id = uid('dev_');
  db.run('INSERT INTO devices (id, name, platform, token_hash, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, String(name || 'Device').slice(0, 80), String(platform || '').slice(0, 20), sha256(token), scope, Date.now());
  return { id, token, scope };
}
