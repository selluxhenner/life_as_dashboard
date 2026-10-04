// Capture everything: every thought lands here first, with no type ("unsorted").
// Sorting it later turns it into a note, task, habit, goal, calendar block or meeting.
// The capture stays the record of what was written; `ref` points at the thing it became,
// so changing the type or date moves that thing instead of leaving copies behind.
import * as chrono from 'chrono-node';
import { state, save } from '../../core/store.js';
import { uid, dateKey, pad2, validTime, minutesOf, todayKey } from '../../core/dates.js';
import { addTask, markDirty } from '../../core/model.js';

export const TYPES = [
  { key: 'none', label: 'Unsorted', hot: 'U', color: 'var(--ink-3)' },
  { key: 'note', label: 'Note', hot: 'N', color: 'var(--tone-europe)' },
  { key: 'task', label: 'Task', hot: 'T', color: 'var(--signal)' },
  { key: 'habit', label: 'Habit', hot: 'H', color: 'var(--tone-samerica)' },
  { key: 'goal', label: 'Goal', hot: 'G', color: 'var(--tone-oceania)' },
  { key: 'event', label: 'Calendar', hot: 'C', color: 'var(--amber)' },
  { key: 'meeting', label: 'Meeting', hot: 'M', color: 'var(--tone-asia)' }
];
export const typeOf = key => TYPES.find(t => t.key === key) || TYPES[0];
export const HORIZONS = [{ value: 'woche', label: 'Week' }, { value: 'monat', label: 'Month' }, { value: 'jahr', label: 'Year' }];
export const MEETING_MINUTES = 30;

export const liveCaptures = () => state.captures.filter(c => !c.archived);
export const unsorted = () => state.captures.filter(c => !c.archived && c.type === 'none');

/* Dates in the text ("call Anna tomorrow 15:00", "Freitag 9 Uhr") are read as a suggestion; the type stays unsorted. */
function parseWhen(text) {
  const opts = { forwardDate: true };
  const r = chrono.parse(text, new Date(), opts)[0] || (chrono.de ? chrono.de.parse(text, new Date(), opts)[0] : null);
  if (!r) return {};
  const s = r.start.date();
  const timed = r.start.isCertain('hour');
  const out = { date: dateKey(s) };
  if (timed) out.time = pad2(s.getHours()) + ':' + pad2(s.getMinutes());
  if (timed && r.end) { const e = r.end.date(); out.end = pad2(e.getHours()) + ':' + pad2(e.getMinutes()); }
  return out;
}

/* A soft hint shown next to unsorted items. Never applied automatically. */
export function suggestType(c) {
  const t = c.text.toLowerCase();
  if (/\b(meet|meeting|call|sync|interview|1:1|termin|treffen|besprechung)\b/.test(t)) return 'meeting';
  if (/^(every|each|daily)\b|\b(every day|each morning|jeden tag|täglich)\b/.test(t)) return 'habit';
  if (c.time) return 'event';
  if (/^(idea|note|thought|idee|notiz)\b/.test(t)) return 'note';
  if (/^(learn|reach|become|get to|land|hit|lernen|erreichen)\b/.test(t)) return 'goal';
  return null;
}

/* One capture per non-empty line, so a whole brain dump can be pasted at once. */
export function captureText(raw, extra = {}) {
  const lines = raw.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  const now = Date.now();
  const made = lines.map((text, i) => ({
    id: uid(), text, type: 'none', date: '', time: '', end: '', horizon: 'woche', priority: 'med',
    createdAt: now + i, updatedAt: now + i, archived: false, ref: null,
    ...parseWhen(text), ...extra
  }));
  state.captures.unshift(...made.reverse());
  save();
  return made;
}

/* ---------- the thing a capture became ---------- */
function findRef(c) {
  const r = c.ref;
  if (!r) return null;
  if (r.kind === 'task') return state.tasks.find(t => t.id === r.id && !t.deleted) || null;
  if (r.kind === 'habit') return state.habits.find(hb => hb.id === r.id) || null;
  if (r.kind === 'goal') return (state.ziele[r.horizon] || []).find(g => g.id === r.id) || null;
  if (r.kind === 'plan') return (state.dayplan[r.date] || []).find(b => b.id === r.id) || null;
  return null;
}
export const linked = findRef;

/* Done-ness of the linked item, so the list can show what is finished. */
export function isDone(c) {
  const x = findRef(c);
  if (!x) return false;
  if (c.ref.kind === 'habit') return !!x.history[todayKey()];
  return !!x.done;
}

function unlink(c) {
  const r = c.ref, x = findRef(c);
  c.ref = null;
  if (!r || !x) return;
  if (r.kind === 'task') { x.deleted = true; markDirty(x); }
  else if (r.kind === 'habit') { if (!Object.keys(x.history).length) state.habits = state.habits.filter(hb => hb !== x); }
  else if (r.kind === 'goal') state.ziele[r.horizon] = state.ziele[r.horizon].filter(g => g !== x);
  else if (r.kind === 'plan') state.dayplan[r.date] = state.dayplan[r.date].filter(b => b !== x);
}

const planLabel = c => (c.type === 'meeting' ? 'Meeting · ' : '') + c.text;
function planEnd(c) {
  if (c.end && validTime(c.end) && c.end > c.time) return c.end;
  if (c.type !== 'meeting' || !validTime(c.time)) return '';
  const m = minutesOf(c.time) + MEETING_MINUTES;
  return m >= 1440 ? '' : pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

function link(c) {
  if (c.type === 'task') {
    const t = addTask(c.text, c.priority || 'med', { due: c.date || null, source: 'capture' });
    c.ref = { kind: 'task', id: t.id };
  } else if (c.type === 'habit') {
    const hb = { id: uid(), label: c.text, icon: '◆', history: {}, mode: 'daily', createdAt: todayKey() };
    state.habits.push(hb);
    c.ref = { kind: 'habit', id: hb.id };
  } else if (c.type === 'goal') {
    const g = { id: uid(), label: c.text, done: false };
    state.ziele[c.horizon].push(g);
    c.ref = { kind: 'goal', id: g.id, horizon: c.horizon };
  } else if ((c.type === 'event' || c.type === 'meeting') && c.date) {
    // Plan blocks are pushed to Google Calendar by calendar-sync, so this is "add to calendar".
    const b = { id: uid(), time: validTime(c.time) ? c.time : '', end: planEnd(c), label: planLabel(c), done: false };
    (state.dayplan[c.date] = state.dayplan[c.date] || []).push(b);
    c.ref = { kind: 'plan', id: b.id, date: c.date };
  }
}

/* Update the linked item in place when it still fits, otherwise move it. */
function apply(c) {
  const x = findRef(c), r = c.ref;
  const want = { task: 'task', habit: 'habit', goal: 'goal', event: 'plan', meeting: 'plan' }[c.type];
  if (x && r.kind === want) {
    if (want === 'task') { x.title = c.text; x.due = c.date || null; x.priority = c.priority || 'med'; markDirty(x); return; }
    if (want === 'habit') { x.label = c.text; return; }
    if (want === 'goal' && r.horizon === c.horizon) { x.label = c.text; return; }
    if (want === 'plan' && r.date === c.date) { x.label = planLabel(c); x.time = validTime(c.time) ? c.time : ''; x.end = planEnd(c); return; }
  }
  unlink(c);
  link(c);
}

export function updateCapture(c, patch) {
  Object.assign(c, patch, { updatedAt: Date.now() });
  apply(c);
  save();
}
export function setType(c, type) { updateCapture(c, { type }); }
export function archiveCapture(c, on = true) {
  c.archived = on; c.updatedAt = Date.now();
  save();
}
export function deleteCapture(c) {
  unlink(c);
  state.captures = state.captures.filter(x => x !== c);
  save();
}

/* Google Calendar "new event" page, pre-filled. Guests are added there; nothing is sent from here. */
export function meetingLink(c) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: c.text });
  if (c.date) {
    const d = c.date.replace(/-/g, '');
    if (validTime(c.time)) {
      const end = planEnd(c) || c.time;
      p.set('dates', `${d}T${c.time.replace(':', '')}00/${d}T${end.replace(':', '')}00`);
      try { p.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* default tz */ }
    } else {
      const next = new Date(+c.date.slice(0, 4), +c.date.slice(5, 7) - 1, +c.date.slice(8) + 1);
      p.set('dates', `${d}/${dateKey(next).replace(/-/g, '')}`);
    }
  }
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
