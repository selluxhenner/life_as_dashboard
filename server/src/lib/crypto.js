import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// 32-byte key. Without ENC_KEY it is derived from API_TOKEN (fine for one user; set ENC_KEY in production).
const KEY = config.encKey
  ? Buffer.from(config.encKey, 'base64')
  : createHash('sha256').update('agentic-os:' + config.apiToken).digest();
if (KEY.length !== 32) throw new Error('ENC_KEY must be 32 bytes, base64-encoded');

export function encrypt(text) {
  if (text == null) return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

export function decrypt(blob) {
  if (blob == null) return null;
  if (blob.startsWith('plain:')) return blob.slice(6);      // legacy rows, re-encrypted on next write
  const raw = Buffer.from(blob.slice(3), 'base64');
  const d = createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const hmac = (key, data) => createHmac('sha256', key).update(data).digest('base64url');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const uid = (p = '') => p + Date.now().toString(36) + randomBytes(5).toString('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}
