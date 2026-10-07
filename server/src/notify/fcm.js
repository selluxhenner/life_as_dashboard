// Optional instant push through Firebase Cloud Messaging (FCM HTTP v1). The message carries no text, only "check now":
// the phone then fetches /api/notifications with its own token, so nothing you read passes through Google.
// Off until a service-account key exists at FCM_CREDENTIALS (default data/fcm-service-account.json).
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';

let creds;                                   // undefined = not read yet, null = not set up
let access = { token: null, exp: 0 };

function credentials() {
  if (creds !== undefined) return creds;
  try { creds = existsSync(config.fcmCredentials) ? JSON.parse(readFileSync(config.fcmCredentials, 'utf8')) : null; }
  catch (e) { console.error('fcm: unreadable credentials', e.message); creds = null; }
  if (creds && !(creds.client_email && creds.private_key && creds.project_id)) { console.error('fcm: not a service-account key'); creds = null; }
  return creds;
}
export const fcmReady = () => !!credentials();
/** Tests swap the key in and out. */
export function setFcmCredentials(c) { creds = c; access = { token: null, exp: 0 }; }

const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');

async function accessToken() {
  if (access.token && access.exp > Date.now() + 60000) return access.token;
  const c = credentials(), now = Math.floor(Date.now() / 1000), aud = c.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud, iat: now, exp: now + 3600 });
  const jwt = unsigned + '.' + createSign('RSA-SHA256').update(unsigned).sign(c.private_key, 'base64url');
  const res = await fetch(aud, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('token HTTP ' + res.status);
  const j = await res.json();
  access = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return access.token;
}

/* Wakes every phone that registered a push token. Returns how many FCM accepted; tokens FCM no longer knows are dropped. */
export async function fcmPing(data = {}) {
  if (!fcmReady()) return 0;
  const devices = db.all('SELECT id, push_token FROM devices WHERE push_token IS NOT NULL AND revoked = 0');
  if (!devices.length) return 0;
  const auth = await accessToken();
  let sent = 0;
  for (const d of devices) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: d.push_token, data: { type: 'check', ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) }, android: { priority: 'HIGH', ttl: '3600s' } } }),
      signal: AbortSignal.timeout(10000)
    }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.ok) { sent++; continue; }
    if (res.status === 404) db.run('UPDATE devices SET push_token = NULL WHERE id = ?', d.id);      // UNREGISTERED: app removed or token rotated
    else console.error('fcm send', res.status, (await res.text()).slice(0, 200));
  }
  return sent;
}
