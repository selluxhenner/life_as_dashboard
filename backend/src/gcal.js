/*
 * Google Kalender für LIFE OS. Die Verbindung liegt auf dem Server (Refresh-Token in D1),
 * also reicht es, sich auf einem Gerät einmal bei Google anzumelden.
 *
 *   GET    /api/gcal/status              {configured, connected, account}
 *   POST   /api/gcal/connect             -> {url}: Google-Anmeldeseite im Browser öffnen
 *   GET    /api/gcal/callback            Rückkehr von Google (ohne Bearer, signierter state)
 *   DELETE /api/gcal                     Verbindung trennen und Token bei Google widerrufen
 *   GET    /api/gcal/events?from=&to=    Termine aller sichtbaren Kalender (to exklusiv, YYYY-MM-DD)
 *   POST   /api/gcal/push                {timeZone, upserts:[...], deletes:[key]} -> {done, failed}
 *
 * Gepushte Termine bekommen eine aus dem key abgeleitete Event-ID und landen im Hauptkalender.
 * /events lässt sie weg, damit sie in der App nicht doppelt erscheinen.
 *
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (optional GOOGLE_REDIRECT_URI).
 */

import { HttpError, json, readBody } from './http.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
];
const API = 'https://www.googleapis.com/calendar/v3';
const STATE_TTL = 10 * 60 * 1000;
// Workers (Free) erlauben 50 Subrequests pro Aufruf; ein Upsert braucht bis zu 2.
const MAX_PUSH = 20;
const MAX_CALENDARS = 10;
const MAX_RANGE_DAYS = 120;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

/* Google erlaubt in Event-IDs nur base32hex (0-9, a-v); Hex-Ziffern sind eine Teilmenge davon. */
async function eventId(key) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lifeos:' + key));
  return 'lifeos' + [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function redirectUri(env, url) {
  return env.GOOGLE_REDIRECT_URI || url.origin + '/api/gcal/callback';
}

function requireConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(503, 'Google ist auf dem Server nicht eingerichtet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen)');
  }
}

async function makeState(env) {
  const payload = Date.now() + '.' + crypto.randomUUID();
  return payload + '.' + await hmac(env.API_TOKEN, payload);
}

async function stateValid(env, state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 3) return false;
  const payload = parts[0] + '.' + parts[1];
  if (await hmac(env.API_TOKEN, payload) !== parts[2]) return false;
  const age = Date.now() - Number(parts[0]);
  return age >= 0 && age < STATE_TTL;
}

async function tokenRequest(env, params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function loadAuth(db) {
  return db.prepare('SELECT * FROM gcal_auth WHERE id = 1').first();
}

/* Gültiges Access-Token; null, wenn keine Verbindung (mehr) besteht. */
async function accessToken(env) {
  const auth = await loadAuth(env.DB);
  if (!auth) return null;
  if (auth.access_token && auth.access_expires > Date.now() + 60000) return auth.access_token;
  requireConfig(env);
  const { ok, data } = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: auth.refresh_token });
  if (!ok) {
    // Widerrufen oder abgelaufen: Verbindung verwerfen, damit die App "nicht verbunden" anzeigt.
    if (data.error === 'invalid_grant') { await env.DB.prepare('DELETE FROM gcal_auth').run(); return null; }
    throw new HttpError(502, 'Google-Token konnte nicht erneuert werden: ' + (data.error || 'unbekannt'));
  }
  await env.DB.prepare('UPDATE gcal_auth SET access_token = ?, access_expires = ? WHERE id = 1')
    .bind(data.access_token, Date.now() + data.expires_in * 1000).run();
  return data.access_token;
}

function gapi(token, method, path, body) {
  return fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function page(title, text, status = 200) {
  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LIFE OS · ${escapeHtml(title)}</title>
<body style="background:#171a21;color:#e6e8ee;font-family:Consolas,monospace;padding:40px 16px;text-align:center">
<h1 style="font-size:18px;letter-spacing:2px">${escapeHtml(title)}</h1><p style="color:#9ba3b4">${escapeHtml(text)}</p></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function connect(env, url) {
  requireConfig(env);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env, url),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // sonst liefert Google beim erneuten Verbinden kein Refresh-Token
    state: await makeState(env)
  });
  return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params });
}

async function callback(env, url) {
  if (url.searchParams.get('error')) return page('ABGEBROCHEN', 'Google-Verbindung wurde nicht erteilt. Du kannst dieses Fenster schliessen.');
  if (!await stateValid(env, url.searchParams.get('state'))) {
    return page('LINK ABGELAUFEN', 'Bitte in LIFE OS erneut auf „Mit Google verbinden“ tippen.', 400);
  }
  requireConfig(env);
  const { ok, data } = await tokenRequest(env, {
    grant_type: 'authorization_code',
    code: url.searchParams.get('code') || '',
    redirect_uri: redirectUri(env, url)
  });
  if (!ok || !data.refresh_token) {
    return page('FEHLER', 'Google hat kein Token geliefert (' + (data.error || 'kein refresh_token') + '). Bitte erneut versuchen.', 502);
  }
  const granted = String(data.scope || '').split(' ');
  if (!SCOPES.every((s) => granted.includes(s))) {
    return page('BERECHTIGUNG FEHLT', 'Bitte beim Verbinden beide Kalender-Häkchen setzen und erneut versuchen.', 400);
  }
  let account = null;
  const cal = await gapi(data.access_token, 'GET', '/calendars/primary');
  if (cal.ok) account = (await cal.json()).id;
  await env.DB.prepare(
    `INSERT INTO gcal_auth (id, refresh_token, access_token, access_expires, account, connected_at)
     VALUES (1, ?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (id) DO UPDATE SET refresh_token = excluded.refresh_token, access_token = excluded.access_token,
       access_expires = excluded.access_expires, account = excluded.account, connected_at = excluded.connected_at`
  ).bind(data.refresh_token, data.access_token, Date.now() + data.expires_in * 1000, account, Date.now()).run();
  return page('KALENDER VERBUNDEN ✓', 'LIFE OS hat jetzt Zugriff auf ' + (account || 'deinen Google Kalender') + '. Du kannst dieses Fenster schliessen.');
}

async function status(env) {
  const auth = await loadAuth(env.DB);
  return json({
    configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    connected: !!auth,
    account: auth ? auth.account : null
  });
}

async function disconnect(env) {
  const auth = await loadAuth(env.DB);
  if (auth) {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(auth.refresh_token), { method: 'POST' }).catch(() => {});
    await env.DB.prepare('DELETE FROM gcal_auth').run();
  }
  return json({ ok: true });
}

function dateParam(url, name) {
  const v = url.searchParams.get(name) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `${name} muss YYYY-MM-DD sein`);
  return v;
}

function toEvent(ev, cal) {
  return {
    id: ev.id,
    calendar: cal.summaryOverride || cal.summary || '',
    color: cal.backgroundColor || null,
    title: ev.summary || '(ohne Titel)',
    allDay: !!ev.start.date,
    start: ev.start.date || ev.start.dateTime,
    end: ev.end.date || ev.end.dateTime,
    location: ev.location || null,
    link: ev.htmlLink || null
  };
}

async function events(env, url) {
  const from = dateParam(url, 'from');
  const to = dateParam(url, 'to');
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (!(days > 0 && days <= MAX_RANGE_DAYS)) throw new HttpError(400, `Zeitraum muss 1–${MAX_RANGE_DAYS} Tage sein`);
  const token = await accessToken(env);
  if (!token) return json({ connected: false, events: [] });

  // Grosszügige UTC-Grenzen; die App ordnet die Termine in ihrer Zeitzone den Tagen zu.
  const timeMin = new Date(Date.parse(from) - 86400000).toISOString();
  const timeMax = new Date(Date.parse(to) + 86400000).toISOString();
  const listRes = await gapi(token, 'GET', '/users/me/calendarList?minAccessRole=reader');
  if (!listRes.ok) throw new HttpError(502, 'Google Kalender antwortet mit HTTP ' + listRes.status);
  const cals = ((await listRes.json()).items || []).filter((c) => c.selected && !c.hidden).slice(0, MAX_CALENDARS);

  const perCal = await Promise.all(cals.map(async (cal) => {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    const res = await gapi(token, 'GET', '/calendars/' + encodeURIComponent(cal.id) + '/events?' + q);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || [])
      .filter((ev) => ev.status !== 'cancelled' && ev.start && ev.end)
      .filter((ev) => !ev.extendedProperties?.private?.lifeos)
      .filter((ev) => !(ev.attendees || []).some((a) => a.self && a.responseStatus === 'declined'))
      .map((ev) => toEvent(ev, cal));
  }));
  const all = perCal.flat().sort((a, b) => a.start.localeCompare(b.start));
  return json({ connected: true, events: all });
}

function nextDay(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function hhmm(mins) {
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

/* Ein Eintrag aus der App -> Google-Event. Mit time: Termin (Standard 60 Min.), ohne: ganztägig. */
function toGoogle(it, timeZone) {
  if (!it || typeof it !== 'object') throw new HttpError(400, 'Eintrag muss ein Objekt sein');
  if (typeof it.key !== 'string' || !/^[\w:.-]{1,120}$/.test(it.key)) throw new HttpError(400, 'key ungültig');
  if (typeof it.title !== 'string' || !it.title.trim()) throw new HttpError(400, 'title fehlt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || '')) throw new HttpError(400, 'date muss YYYY-MM-DD sein');
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (it.time != null && !timeRe.test(it.time)) throw new HttpError(400, 'time muss HH:MM sein');
  if (it.endTime != null && !(it.time && timeRe.test(it.endTime) && it.endTime > it.time)) {
    throw new HttpError(400, 'endTime muss HH:MM nach time sein');
  }
  const body = {
    summary: (it.done ? '✓ ' : '') + it.title.trim().slice(0, 300),
    description: typeof it.notes === 'string' && it.notes ? it.notes.slice(0, 2000) : 'Aus LIFE OS',
    status: 'confirmed',
    extendedProperties: { private: { lifeos: it.key } }
  };
  if (it.time) {
    const [h, m] = it.time.split(':').map(Number);
    const end = it.endTime || hhmm(Math.min(h * 60 + m + 60, 23 * 60 + 59));
    body.start = { dateTime: `${it.date}T${it.time}:00`, timeZone };
    body.end = { dateTime: `${it.date}T${end}:00`, timeZone };
  } else {
    // To-dos: ganztägig, nicht als "beschäftigt" und ohne Erinnerungen
    body.start = { date: it.date };
    body.end = { date: nextDay(it.date) };
    body.transparency = 'transparent';
    body.reminders = { useDefault: false, overrides: [] };
  }
  return { key: it.key, body };
}

async function push(env, request) {
  const input = await readBody(request);
  const timeZone = typeof input?.timeZone === 'string' && input.timeZone ? input.timeZone : 'UTC';
  const upserts = Array.isArray(input?.upserts) ? input.upserts : [];
  const deletes = Array.isArray(input?.deletes) ? input.deletes : [];
  if (upserts.length + deletes.length > MAX_PUSH) throw new HttpError(400, `Maximal ${MAX_PUSH} Änderungen pro Push`);
  if (!deletes.every((k) => typeof k === 'string' && k.length <= 120)) throw new HttpError(400, 'deletes ungültig');
  const items = upserts.map((it) => toGoogle(it, timeZone));

  const token = await accessToken(env);
  if (!token) return json({ connected: false, done: [], failed: [] });
  const done = [];
  const failed = [];

  await Promise.all(items.map(async ({ key, body }) => {
    const id = await eventId(key);
    // PUT setzt auch einen in Google gelöschten (cancelled) Termin wieder auf confirmed.
    let res = await gapi(token, 'PUT', '/calendars/primary/events/' + id, body);
    if (res.status === 404) res = await gapi(token, 'POST', '/calendars/primary/events', { id, ...body });
    if (res.ok) done.push(key); else failed.push({ key, status: res.status });
  }));
  await Promise.all(deletes.map(async (key) => {
    const res = await gapi(token, 'DELETE', '/calendars/primary/events/' + await eventId(key));
    if (res.ok || res.status === 404 || res.status === 410) done.push(key); else failed.push({ key, status: res.status });
  }));
  return json({ connected: true, done, failed });
}

export async function gcalRoute(request, env, url, path) {
  const method = request.method;
  if (path === '/api/gcal/callback' && method === 'GET') return callback(env, url);
  if (path === '/api/gcal/status' && method === 'GET') return status(env);
  if (path === '/api/gcal/connect' && method === 'POST') return connect(env, url);
  if (path === '/api/gcal' && method === 'DELETE') return disconnect(env);
  if (path === '/api/gcal/events' && method === 'GET') return events(env, url);
  if (path === '/api/gcal/push' && method === 'POST') return push(env, request);
  throw new HttpError(405, 'Methode nicht erlaubt');
}
