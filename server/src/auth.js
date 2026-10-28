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

/* Re-pairing on these platforms takes over the existing row instead of adding one: every reinstall of the Android
   app pairs again as "Phone (Android)", and there is one phone. Desktops keep separate rows (two PCs share a name). */
const REPAIR_REPLACES = ['android'];
/* Browsers are temporary: not counted as devices on the Hub, and revoked after two weeks without a request. */
export const TEMPORARY_PLATFORMS = ['web'];
export const TEMPORARY_TTL_MS = 14 * 86400000;
export const isTemporary = platform => TEMPORARY_PLATFORMS.includes(platform);

export function pairDevice({ name, platform, scope = 'full' }) {
  if (!SCOPES.includes(scope)) throw new HttpError(400, 'scope must be ' + SCOPES.join(' or '));
  name = String(name || 'Device').slice(0, 80); platform = String(platform || '').slice(0, 20);
  const token = randomToken(32);
  const prev = REPAIR_REPLACES.includes(platform) && db.get(
    'SELECT id FROM devices WHERE name = ? AND platform = ? AND scope = ? AND revoked = 0 ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT 1',
    name, platform, scope);
  if (prev) {
    // the old install's token and push token die with it; the new install registers its own push token
    db.run('UPDATE devices SET token_hash = ?, push_token = NULL WHERE id = ?', sha256(token), prev.id);
    return { id: prev.id, token, scope };
  }
  const id = uid('dev_');
  db.run('INSERT INTO devices (id, name, platform, token_hash, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, name, platform, sha256(token), scope, Date.now());
  return { id, token, scope };
}

/* Revokes browsers idle for longer than TEMPORARY_TTL_MS. Returns how many. */
export function pruneTemporaryDevices(now = Date.now()) {
  const marks = TEMPORARY_PLATFORMS.map(() => '?').join(', ');
  return Number(db.run(`UPDATE devices SET revoked = 1 WHERE revoked = 0 AND platform IN (${marks}) AND COALESCE(last_seen_at, created_at) < ?`,
    ...TEMPORARY_PLATFORMS, now - TEMPORARY_TTL_MS).changes);
}
