// Calendar sync through the server.
// Out: day-plan blocks + todos with a due date become events in the push-target Google calendar.
// In:  events from all connected calendars (Google accounts + Fuxam ICS) are shown read-only.
import { state, persist, notify, onSave } from './store.js';
import { apiConfig, apiFetch } from './api.js';
import { todayKey, keyOffset, mondayKeyOf, parseKey, dateKey, pad2, validTime, minutesOf } from './dates.js';

const PUSH_BATCH = 20;
const PAST_DAYS = 7;
const FETCH_EVERY = 5 * 60000;
let timer = null, busy = false;
export let calError = '';

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

function calItems() {
  const cutoff = keyOffset(todayKey(), -PAST_DAYS);
  const items = [];
  for (const dk of Object.keys(state.dayplan)) {
    if (dk < cutoff) continue;
    const blocks = (state.dayplan[dk] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    blocks.forEach((b, i) => {
      if (!b.label) return;
      const it = { key: 'plan:' + dk + ':' + b.id, title: b.label, date: dk, done: !!b.done };
      if (validTime(b.time)) {
        it.time = b.time;
        const next = blocks.slice(i + 1).find(n => validTime(n.time) && n.time > b.time);
        if (b.end && validTime(b.end)) it.endTime = b.end;
        else if (next && minutesOf(next.time) - minutesOf(b.time) <= 180) it.endTime = next.time;
      }
      items.push(it);
    });
  }
  for (const t of state.tasks) {
    if (t.deleted || !t.due || t.due < cutoff) continue;
    items.push({ key: 'todo:' + t.id, title: t.title, date: t.due, done: !!t.done, notes: t.notes || '' });
  }
  return items;
}

function calDiff() {
  const cutoff = keyOffset(todayKey(), -PAST_DAYS);
  const pushed = state.gcal.pushed;
  const upserts = [], deletes = [], seen = {};
  for (const it of calItems()) {
    seen[it.key] = true;
    const sig = JSON.stringify(it);
    if (!pushed[it.key] || pushed[it.key].sig !== sig) upserts.push(it);
  }
  for (const key of Object.keys(pushed)) {
    if (seen[key]) continue;
    if (pushed[key].date < cutoff) delete pushed[key];
    else deletes.push(key);
  }
  return { upserts, deletes };
}

export function scheduleCal(delay = 2500, refetch) {
  if (!state.gcal || !apiConfig()) return;
  if (refetch) state.gcal.lastFetch = 0;
  clearTimeout(timer);
  timer = setTimeout(runCal, delay);
}

function baseRange() {
  const from = keyOffset(mondayKeyOf(new Date()), -7);
  return { from, to: keyOffset(from, 7 * 7) };
}

/* Called by views that show a week outside the loaded range. */
export function ensureCalRange(monKey) {
  const r = state.gcal.range;
  if (!state.gcal.connected || !r) return;
  const end = keyOffset(monKey, 7);
  if (monKey >= r.from && end <= r.to) return;
  state.gcal.range = { from: monKey < r.from ? monKey : r.from, to: end > r.to ? end : r.to };
  scheduleCal(0, true);
}

async function fetchEvents(cfg) {
  const base = baseRange();
  let r = state.gcal.range || base;
  r = { from: r.from < base.from ? r.from : base.from, to: r.to > base.to ? r.to : base.to };
  if (parseKey(r.to) - parseKey(r.from) > 119 * 86400000) r = base;
  const res = await apiFetch(cfg, '/api/calendar/events?from=' + r.from + '&to=' + r.to);
  state.gcal.connected = !!res.connected;
  state.gcal.events = res.events || [];
  state.gcal.range = r;
  state.gcal.lastFetch = Date.now();
}

async function pushCal(cfg) {
  const diff = calDiff();
  const ops = diff.upserts.map(up => ({ up })).concat(diff.deletes.map(del => ({ del })));
  if (!ops.length) return;
  const batch = ops.slice(0, PUSH_BATCH);
  const body = {
    timeZone: tz(),
    upserts: batch.filter(o => o.up).map(o => o.up),
    deletes: batch.filter(o => o.del).map(o => o.del)
  };
  const res = await apiFetch(cfg, '/api/calendar/push', body);
  if (!res.connected) return;
  const ok = new Set(res.done || []);
  body.upserts.forEach(it => { if (ok.has(it.key)) state.gcal.pushed[it.key] = { sig: JSON.stringify(it), date: it.date }; });
  body.deletes.forEach(k => { if (ok.has(k)) delete state.gcal.pushed[k]; });
  if ((res.failed || []).length) { calError = res.failed.length + ' item(s) not pushed (Google HTTP ' + res.failed[0].status + ')'; return; }
  if (ops.length > batch.length) return pushCal(cfg);
}

export async function runCal() {
  const cfg = apiConfig();
  if (!cfg) return;
  if (busy) { scheduleCal(2000); return; }
  busy = true; calError = '';
  const fetched = Date.now() - state.gcal.lastFetch > FETCH_EVERY || !state.gcal.connected;
  try {
    if (fetched) await fetchEvents(cfg);
    if (state.gcal.connected) await pushCal(cfg);
    persist();
    if (fetched) notify();
  } catch (err) {
    calError = err && err.kind === 'server' ? err.msg : err && err.kind === 'auth' ? 'Token rejected' : 'Server unreachable';
  } finally { busy = false; }
}

/* Events of one day in local time. Returns {title, time:'HH:MM'|'' (all-day), start, end (minutes), ev}. */
export function calEventsOn(dk) {
  if (!state.gcal.connected) return [];
  const out = [];
  for (const ev of state.gcal.events) {
    if (ev.allDay) {
      if (ev.start <= dk && dk < ev.end) out.push({ title: ev.title, time: '', start: 0, end: 1440, ev });
      continue;
    }
    const s = new Date(ev.start), e = new Date(ev.end || ev.start);
    if (dateKey(s) !== dk) continue;
    const startMin = s.getHours() * 60 + s.getMinutes();
    let endMin = dateKey(e) === dk ? e.getHours() * 60 + e.getMinutes() : 1440;
    if (endMin <= startMin) endMin = startMin + 30;
    out.push({ title: ev.title, time: pad2(s.getHours()) + ':' + pad2(s.getMinutes()), start: startMin, end: endMin, ev });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export function initCal() {
  onSave(() => scheduleCal());
  window.addEventListener('focus', () => scheduleCal(0, true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleCal(0); });
  setInterval(() => { if (!document.hidden) scheduleCal(0); }, 60000);
  scheduleCal(0, true);
}
