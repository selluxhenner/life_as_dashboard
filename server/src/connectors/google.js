// Google OAuth for any number of accounts. Each account chooses Calendar and/or Gmail (read-only).
import { config } from '../config.js';
import { hmac } from '../lib/crypto.js';
import { HttpError, page } from '../http.js';
import { listConnections, createConnection, updateConnection, getConnection } from './store.js';

const SCOPES = {
  base: ['openid', 'email'],
  calendar: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly']
};
const STATE_TTL = 10 * 60 * 1000;
const redirectUri = () => config.publicUrl + '/api/oauth/google/callback';

function requireConfig() {
  if (!config.google.clientId || !config.google.clientSecret)
    throw new HttpError(503, 'Google is not set up on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing)');
}

function makeState(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString('base64url');
  return data + '.' + hmac(config.apiToken, data);
}
function readState(state) {
  const [data, sig] = String(state || '').split('.');
  if (!data || hmac(config.apiToken, data) !== sig) return null;
  const p = JSON.parse(Buffer.from(data, 'base64url').toString());
  return Date.now() - p.t < STATE_TTL ? p : null;
}

export function startUrl({ features = ['calendar', 'gmail'], reconnectId = null }) {
  requireConfig();
  const feats = features.filter(f => SCOPES[f]);
  if (!feats.length) throw new HttpError(400, 'Choose Calendar and/or Gmail');
  const scope = [...SCOPES.base, ...feats.flatMap(f => SCOPES[f])].join(' ');
  const hint = reconnectId ? getConnection(reconnectId)?.account : null;
  const params = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: redirectUri(), response_type: 'code', scope,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    state: makeState({ features: feats, reconnectId }), ...(hint ? { login_hint: hint } : {})
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params })
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function callback(url) {
  if (url.searchParams.get('error')) return page('Cancelled', 'Google access was not granted. You can close this window.');
  const st = readState(url.searchParams.get('state'));
  if (!st) return page('Link expired', 'Start the connection again from Agentic OS → Settings.', 400);
  requireConfig();
  const { ok, data } = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirectUri() });
  if (!ok || !data.refresh_token) return page('Something went wrong', 'Google returned no token (' + (data.error || 'no refresh_token') + '). Please try again.', 502);
  const granted = String(data.scope || '').split(' ');
  const features = Object.keys(SCOPES).filter(f => f !== 'base' && SCOPES[f].every(s => granted.includes(s)));
  if (!features.length) return page('Permission missing', 'Tick the Calendar and/or Gmail boxes on the Google screen and try again.', 400);
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + data.access_token } }).then(r => r.json()).catch(() => ({}));
  const account = info.email || 'Google account';
  const existing = listConnections('google').find(c => c.account === account || c.id === st.reconnectId);
  const patch = { secret: data.refresh_token, accessToken: data.access_token, accessExpires: Date.now() + data.expires_in * 1000, status: 'ok', lastError: null, features, account };
  if (existing) updateConnection(existing.id, { ...patch, label: existing.label || account });
  else {
    const first = !listConnections('google').some(c => c.config.pushTarget);
    const c = createConnection({ provider: 'google', account, label: account, features, secret: data.refresh_token, config: { pushTarget: first && features.includes('calendar') } });
    updateConnection(c.id, { accessToken: data.access_token, accessExpires: patch.accessExpires });
  }
  return page('Connected', `${account} is now linked (${features.join(' + ')}). You can close this window.`);
}

/* Valid access token, or null when the account needs to be reconnected. */
export async function accessToken(conn) {
  if (conn.accessToken && conn.accessExpires > Date.now() + 60000) return conn.accessToken;
  requireConfig();
  const { ok, data } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: conn.secret() });
  if (!ok) {
    if (data.error === 'invalid_grant') { updateConnection(conn.id, { status: 'reauth', lastError: 'Google access expired or was revoked' }); return null; }
    throw new HttpError(502, 'Could not refresh Google token: ' + (data.error || 'unknown'));
  }
  updateConnection(conn.id, { accessToken: data.access_token, accessExpires: Date.now() + data.expires_in * 1000, ...(conn.status === 'reauth' ? { status: 'ok' } : {}) });
  conn.accessToken = data.access_token; conn.accessExpires = Date.now() + data.expires_in * 1000;
  return data.access_token;
}

export async function gfetch(conn, url, opts = {}) {
  const token = await accessToken(conn);
  if (!token) return null;
  return fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
}

export async function revoke(conn) {
  await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(conn.secret()), { method: 'POST' }).catch(() => {});
}
