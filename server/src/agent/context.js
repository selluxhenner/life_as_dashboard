// What Lina has at hand in a spoken turn, so "delete the gym task" or "move my 3 o'clock to 4" is one model call
// instead of a lookup and then the change: the dates of the next two weeks, open todos, habits and the coming week's
// calendar, each with the id the tools take. Plain lines, short enough to stay well under the cost of a lookup.
import { db } from '../db.js';
import { listOpenTodos } from '../routes/todos.js';
import { listHabits } from './tools.js';
import { localDate, localTime, addDays } from '../lib/time.js';

const DATE_DAYS = 14, EVENT_DAYS = 7, MAX_TODOS = 40, MAX_EVENTS = 40;

const weekday = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const day = d => weekday(d) + ' ' + d;

function eventWhen(e) {
  if (e.all_day) {
    const from = String(e.start).slice(0, 10), last = addDays(String(e.end).slice(0, 10), -1);
    return last > from ? `${day(from)} to ${day(last)}, all day` : `${day(from)}, all day`;
  }
  const s = new Date(e.start), end = new Date(e.end);
  return `${day(localDate(s))} ${localTime(s)}-${localTime(end)}`;
}

export function quickContext(now = new Date()) {
  const today = localDate(now);
  const dates = Array.from({ length: DATE_DAYS }, (_, i) => {
    const d = addDays(today, i);
    return day(d) + (i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : '');
  });

  const open = listOpenTodos();
  const todos = open.slice(0, MAX_TODOS).map(t =>
    `${t.id} | ${t.title}${t.due ? ' | due ' + t.due : ''}${t.priority === 'high' ? ' | high priority' : ''}`);

  const habits = listHabits().map(hb => {
    const often = hb.mode === 'weekly' ? `weekly, ${hb.target || 3}x` : 'daily';
    return `${hb.id} | ${hb.label} | ${often}${hb.history?.[today] ? ' | done today' : ''}`;
  });

  const events = db.all('SELECT id, kind, title, start, end, all_day, location FROM calendar_events WHERE start < ? AND end >= ? ORDER BY start LIMIT ?',
    addDays(today, EVENT_DAYS + 1), today, MAX_EVENTS)
    .map(e => `${e.id} | ${eventWhen(e)} | ${e.title || '(no title)'}${e.location ? ' @ ' + e.location : ''}${e.kind === 'lesson' ? ' | school lesson, read-only' : ''}`);

  return [
    'Dates: ' + dates.join(', ') + '.',
    `Open todos (id | title | due)${open.length > MAX_TODOS ? `, first ${MAX_TODOS} of ${open.length}` : ''}:`, todos.length ? todos.join('\n') : 'none',
    'Habits (id | label | how often):', habits.length ? habits.join('\n') : 'none',
    `Calendar, today and the next ${EVENT_DAYS} days (id | when | title):`, events.length ? events.join('\n') : 'nothing'
  ].join('\n');
}
