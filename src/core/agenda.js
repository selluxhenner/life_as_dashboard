// One merged agenda per day: plan blocks + calendar events (Google accounts, Fuxam lessons) + due todos.
import { state } from './store.js';
import { calEventsOn } from './calendar-sync.js';
import { minutesOf, validTime } from './dates.js';

export const SOURCE_COLORS = {
  plan: 'var(--signal)',
  lesson: 'var(--amber)',
  todo: 'var(--ink-3)',
  event: 'var(--tone-europe)'
};

export function agendaFor(dk) {
  const items = [];
  const blocks = (state.dayplan[dk] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  blocks.forEach((b, i) => {
    const timed = validTime(b.time);
    const start = timed ? minutesOf(b.time) : null;
    let end = null;
    if (timed) {
      const next = blocks.slice(i + 1).find(n => validTime(n.time) && n.time > b.time);
      end = b.end && validTime(b.end) ? minutesOf(b.end) : next && minutesOf(next.time) - start <= 180 ? minutesOf(next.time) : start + 60;
    }
    items.push({ kind: 'plan', id: b.id, title: b.label, time: timed ? b.time : '', start, end, done: !!b.done, color: SOURCE_COLORS.plan, ref: b });
  });
  for (const c of calEventsOn(dk)) {
    const kind = c.ev.kind === 'lesson' ? 'lesson' : 'event';
    items.push({
      kind, id: c.ev.id, title: c.title, time: c.time, start: c.time ? c.start : null, end: c.time ? c.end : null,
      allDay: !c.time, color: c.ev.color || SOURCE_COLORS[kind], location: c.ev.location, link: c.ev.link,
      calendar: c.ev.calendar, account: c.ev.account
    });
  }
  return items.sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
}

export const dueTasksOn = dk => state.tasks.filter(t => !t.deleted && t.due === dk);
