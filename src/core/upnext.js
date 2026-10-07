// Which days "Up next" on Home shows. Pure functions of agenda items (see agenda.js) and the
// minute of the day — covered by tests/upnext.test.js.

export const EVENING = 20 * 60;   // from 20:00 the panel looks at tomorrow

const timed = i => !i.allDay && i.start != null;
const endOf = i => i.end ?? i.start + 60;

/* What still matters today at `nowMin`: running or upcoming items, plus open plan blocks without a time. */
export const leftToday = (items, nowMin) =>
  items.filter(i => !i.allDay && (i.start != null ? endOf(i) > nowMin : i.kind === 'plan' && !i.done));

/**
 * Today is over in the evening, or once everything on today's clock has ended.
 * Over:     { over: true, today: what is left today (may be empty), tomorrow: true }
 * Not over: { over: false, today: all of today, tomorrow: true only when today has nothing timed }
 */
export function upNextPlan(todayItems, nowMin) {
  const clock = todayItems.filter(timed);
  const over = nowMin >= EVENING || (clock.length > 0 && !clock.some(i => endOf(i) > nowMin));
  if (over) return { over, today: leftToday(todayItems, nowMin), tomorrow: true };
  return { over, today: todayItems, tomorrow: clock.length === 0 };
}

/* The next item that has not started yet, or null. */
export const nextUp = (items, nowMin) => items.find(i => timed(i) && i.start >= nowMin) || null;
