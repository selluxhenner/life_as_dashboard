// Google Calendar: read events from every connected account, push plan blocks to the push-target account.
import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { gfetch } from './google.js';
import { listConnections } from './store.js';
import { config } from '../config.js';
import { localDate, localTime, addDays } from '../lib/time.js';

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

/* Lina's events (blocks and meetings). Unlike pushed plan blocks they carry no `lifeos` key, so fetchEvents reads them
   back and they show up in the app's calendar like any other event. Nobody is invited here: see inviteToEvent. */
export async function createEvent({ title, date, time, endTime, notes, location, video = false }, timeZone = 'Europe/Berlin') {
  const conn = pushTarget();
  if (!conn) throw new Error('No Google calendar is connected');
  const { body } = toGoogle({ key: 'agent', title, date, time, endTime, notes: notes || 'Scheduled by Lina' }, timeZone);
  body.extendedProperties = { private: { lifeosAgent: '1' } };
  if (location) body.location = location.slice(0, 300);
  if (video) body.conferenceData = { createRequest: { requestId: 'lina' + Date.now().toString(36), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  const res = await gfetch(conn, API + '/calendars/primary/events' + (video ? '?conferenceDataVersion=1' : ''), { method: 'POST', body: JSON.stringify(body) });
  if (!res) throw new Error('Google needs to be reconnected');
  if (!res.ok) throw new Error('Google Calendar HTTP ' + res.status);
  const ev = await res.json();
  return { connectionId: conn.id, eventId: ev.id, link: ev.htmlLink || null, meet: ev.hangoutLink || null };
}

/* An event Lina may change, by the app's id ("<connection>:<google event id>"): looked up on the account's
   writable calendars. guests = other people on it (a change or cancellation then emails them, so it needs Kevin's OK). */
export async function editableEvent(id) {
  const cut = String(id).indexOf(':');
  const conn = listConnections('google').find(c => c.id === String(id).slice(0, cut));
  if (cut < 0 || !conn) throw new Error('Only Google Calendar events can be changed (school lessons are read-only)');
  const eventId = String(id).slice(cut + 1);
  const cals = ['primary'];
  const list = await gfetch(conn, API + '/users/me/calendarList?minAccessRole=writer');
  if (list && list.ok) for (const c of (await list.json()).items || []) if (!c.primary) cals.push(c.id);
  for (const cal of cals.slice(0, MAX_CALENDARS)) {
    const res = await gfetch(conn, API + '/calendars/' + encodeURIComponent(cal) + '/events/' + encodeURIComponent(eventId));
    if (res && res.ok) {
      const ev = await res.json();
      const guests = (ev.attendees || []).filter(a => !a.self && !a.resource).map(a => a.displayName || a.email);
      return { conn, cal, ev, guests, url: API + '/calendars/' + encodeURIComponent(cal) + '/events/' + encodeURIComponent(eventId) };
    }
  }
  throw new Error('That event isn’t on a calendar Lina can edit');
}

const wall = iso => { const d = new Date(iso); return { date: localDate(d, config.tz), time: localTime(d, config.tz) }; };
const plusMinutes = (date, time, mins) => {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return { date: addDays(date, Math.floor(total / 1440)), time: hhmm(((total % 1440) + 1440) % 1440) };
};

/* Move / rename an event. Keeps its length when only the start changes. notify: email the guests about it. */
export async function changeEvent({ id, title, date, time, endTime, location }, notify = false) {
  const { ev, url, conn } = await editableEvent(id);
  const patch = {};
  if (title) patch.summary = title.slice(0, 300);
  if (location !== undefined) patch.location = location.slice(0, 300);
  if (date || time || endTime) {
    if (ev.start.date) {                                             // all-day: move the day(s), keep the length
      const days = Math.round((Date.parse(ev.end.date) - Date.parse(ev.start.date)) / 86400000);
      const d = date || ev.start.date;
      patch.start = { date: d }; patch.end = { date: addDays(d, days) };
    } else {
      const from = wall(ev.start.dateTime);
      const length = Math.round((Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)) / 60000);
      const start = { date: date || from.date, time: time || from.time };
      const end = endTime ? { date: start.date, time: endTime } : plusMinutes(start.date, start.time, length);
      if (endTime && endTime <= start.time) throw new Error('The end must be after the start');
      patch.start = { dateTime: `${start.date}T${start.time}:00`, timeZone: config.tz };
      patch.end = { dateTime: `${end.date}T${end.time}:00`, timeZone: config.tz };
    }
  }
  const res = await gfetch(conn, url + '?sendUpdates=' + (notify ? 'all' : 'none'), { method: 'PATCH', body: JSON.stringify(patch) });
  if (!res || !res.ok) throw new Error('Google Calendar HTTP ' + (res ? res.status : 401) + (res && res.status === 403 ? ': only the organizer can change this event' : ''));
  return { ok: true };
}

/* Remove an event from Kevin's calendar; with notify, Google tells the guests it's cancelled. */
export async function cancelEvent({ id }, notify = false) {
  const { url, conn } = await editableEvent(id);
  const res = await gfetch(conn, url + '?sendUpdates=' + (notify ? 'all' : 'none'), { method: 'DELETE' });
  if (!res || !(res.ok || res.status === 410)) throw new Error('Google Calendar HTTP ' + (res ? res.status : 401));
  return { ok: true };
}

/* Adds guests to an event Lina created and lets Google email them the invitation (only after Kevin approved it). */
export async function inviteToEvent({ connectionId, eventId, attendees }) {
  const conn = listConnections('google').find(c => c.id === connectionId) || pushTarget();
  if (!conn) throw new Error('No Google calendar is connected');
  const url = API + '/calendars/primary/events/' + encodeURIComponent(eventId);
  const cur = await gfetch(conn, url);
  if (!cur || !cur.ok) throw new Error('The event is gone (HTTP ' + (cur ? cur.status : 401) + ')');
  const have = (await cur.json()).attendees || [];
  const add = attendees.filter(a => !have.some(h => h.email?.toLowerCase() === a.email.toLowerCase()))
    .map(a => ({ email: a.email, ...(a.name ? { displayName: a.name } : {}) }));
  const res = await gfetch(conn, url + '?sendUpdates=all', { method: 'PATCH', body: JSON.stringify({ attendees: [...have, ...add] }) });
  if (!res || !res.ok) throw new Error('Google Calendar HTTP ' + (res ? res.status : 401));
  return { ok: true, invited: add.map(a => a.email) };
}
