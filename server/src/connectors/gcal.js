// Google Calendar: read events from every connected account, push plan blocks to the push-target account.
import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { gfetch } from './google.js';
import { listConnections } from './store.js';

const API = 'https://www.googleapis.com/calendar/v3';
const MAX_CALENDARS = 10;

export async function fetchEvents(conn, from, to) {
  const timeMin = new Date(Date.parse(from) - 86400000).toISOString();
  const timeMax = new Date(Date.parse(to) + 86400000).toISOString();
  const listRes = await gfetch(conn, API + '/users/me/calendarList?minAccessRole=reader');
  if (!listRes) return null;
  if (!listRes.ok) throw new Error('Google Calendar HTTP ' + listRes.status);
  const cals = ((await listRes.json()).items || []).filter(c => c.selected && !c.hidden).slice(0, MAX_CALENDARS);
  const per = await Promise.all(cals.map(async cal => {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    const res = await gfetch(conn, API + '/calendars/' + encodeURIComponent(cal.id) + '/events?' + q);
    if (!res || !res.ok) return [];
    return ((await res.json()).items || [])
      .filter(ev => ev.status !== 'cancelled' && ev.start && ev.end)
      .filter(ev => !ev.extendedProperties?.private?.lifeos)
      .filter(ev => !(ev.attendees || []).some(a => a.self && a.responseStatus === 'declined'))
      .map(ev => ({
        id: conn.id + ':' + ev.id,
        calendar: cal.summaryOverride || cal.summary || '',
        account: conn.account,
        color: cal.backgroundColor || conn.color,
        title: ev.summary || '(no title)',
        allDay: !!ev.start.date,
        start: ev.start.date || ev.start.dateTime,
        end: ev.end.date || ev.end.dateTime,
        location: ev.location || null,
        link: ev.htmlLink || null,
        kind: (ev.attendees || []).length > 1 || ev.hangoutLink || ev.conferenceData ? 'meeting' : 'event'
      }));
  }));
  return per.flat();
}

/* Google allows only base32hex in event ids; hex is a subset. */
const eventId = key => 'lifeos' + createHash('sha256').update('lifeos:' + key).digest('hex').slice(0, 32);
const nextDay = date => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

function toGoogle(it, timeZone) {
  if (!it || typeof it !== 'object') throw new HttpError(400, 'Item must be an object');
  if (typeof it.key !== 'string' || !/^[\w:.-]{1,120}$/.test(it.key)) throw new HttpError(400, 'Invalid key');
  if (typeof it.title !== 'string' || !it.title.trim()) throw new HttpError(400, 'title missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || '')) throw new HttpError(400, 'date must be YYYY-MM-DD');
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (it.time != null && !timeRe.test(it.time)) throw new HttpError(400, 'time must be HH:MM');
  if (it.endTime != null && !(it.time && timeRe.test(it.endTime) && it.endTime > it.time)) throw new HttpError(400, 'endTime must be HH:MM after time');
  const body = {
    summary: (it.done ? '✓ ' : '') + it.title.trim().slice(0, 300),
    description: typeof it.notes === 'string' && it.notes ? it.notes.slice(0, 2000) : 'From Agentic OS',
    status: 'confirmed',
    extendedProperties: { private: { lifeos: it.key } }
  };
  if (it.time) {
    const [h, m] = it.time.split(':').map(Number);
    const end = it.endTime || hhmm(Math.min(h * 60 + m + 60, 23 * 60 + 59));
    body.start = { dateTime: `${it.date}T${it.time}:00`, timeZone };
    body.end = { dateTime: `${it.date}T${end}:00`, timeZone };
  } else {
    body.start = { date: it.date }; body.end = { date: nextDay(it.date) };
    body.transparency = 'transparent'; body.reminders = { useDefault: false, overrides: [] };
  }
  return { key: it.key, body };
}

export function pushTarget() {
  const cals = listConnections('google').filter(c => c.features.includes('calendar') && c.status === 'ok');
  return cals.find(c => c.config.pushTarget) || cals[0] || null;
}

export async function push({ timeZone = 'Europe/Berlin', upserts = [], deletes = [] }) {
  if (upserts.length + deletes.length > 50) throw new HttpError(400, 'At most 50 changes per push');
  const conn = pushTarget();
  if (!conn) return { connected: false, done: [], failed: [] };
  const items = upserts.map(it => toGoogle(it, timeZone));
  const done = [], failed = [];
  await Promise.all(items.map(async ({ key, body }) => {
    const id = eventId(key);
    let res = await gfetch(conn, API + '/calendars/primary/events/' + id, { method: 'PUT', body: JSON.stringify(body) });
    if (res && res.status === 404) res = await gfetch(conn, API + '/calendars/primary/events', { method: 'POST', body: JSON.stringify({ id, ...body }) });
    if (res && res.ok) done.push(key); else failed.push({ key, status: res ? res.status : 401 });
  }));
  await Promise.all(deletes.map(async key => {
    const res = await gfetch(conn, API + '/calendars/primary/events/' + eventId(key), { method: 'DELETE' });
    if (res && (res.ok || res.status === 404 || res.status === 410)) done.push(key); else failed.push({ key, status: res ? res.status : 401 });
  }));
  return { connected: true, done, failed };
}

/* Create a single event (used by the agent's add_calendar_block tool). */
export async function createEvent({ title, date, time, endTime, notes }) {
  const r = await push({ upserts: [{ key: 'agent:' + Date.now().toString(36), title, date, time, endTime, notes }] });
  return r.connected && r.done.length > 0;
}
