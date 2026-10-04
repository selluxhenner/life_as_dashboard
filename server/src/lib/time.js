// Berlin-local dates and times, DST-safe via Intl.
import { config } from '../config.js';

const parts = (d, tz = config.tz) => Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(d).map(p => [p.type, p.value]));

export function localDate(d = new Date(), tz) { const p = parts(d, tz); return `${p.year}-${p.month}-${p.day}`; }
export function localTime(d = new Date(), tz) { const p = parts(d, tz); return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`; }
export function localWeekday(d = new Date(), tz) { return parts(d, tz).weekday; }

/* UTC instant of a local wall-clock time in the home zone (e.g. "2026-10-26", "08:00"). */
export function zonedInstant(date, time = '00:00', tz = config.tz) {
  const guess = new Date(`${date}T${time}:00Z`);
  const p = parts(guess, tz);
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === '24' ? 0 : p.hour), +p.minute);
  const offset = asLocal - guess.getTime();
  const t = new Date(guess.getTime() - offset);
  // second pass handles the hour around DST switches
  const p2 = parts(t, tz);
  const asLocal2 = Date.UTC(+p2.year, +p2.month - 1, +p2.day, +(p2.hour === '24' ? 0 : p2.hour), +p2.minute);
  return new Date(t.getTime() - (asLocal2 - guess.getTime()));
}

export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const monthKey = (d = new Date()) => localDate(d).slice(0, 7);
