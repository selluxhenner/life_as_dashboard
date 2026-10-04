// ICS calendar subscriptions (Fuxam school timetable). Expands recurring events into a window.
import ICAL from 'ical.js';

export function normaliseUrl(url) {
  const u = String(url || '').trim().replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(u)) throw new Error('Calendar link must start with https:// or webcal://');
  return u;
}

export async function fetchIcs(url) {
  const res = await fetch(normaliseUrl(url), { headers: { 'User-Agent': 'AgenticOS/2.0 (+calendar)' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('Calendar link returned HTTP ' + res.status);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link is not an iCal calendar');
  return text;
}

/* Returns [{uid, title, start, end, allDay, location}] overlapping [from, to). */
export function expand(icsText, from, to) {
  const comp = new ICAL.Component(ICAL.parse(icsText));
  for (const tz of comp.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
  const rangeStart = ICAL.Time.fromJSDate(from, true), rangeEnd = ICAL.Time.fromJSDate(to, true);
  const out = [];
  const events = comp.getAllSubcomponents('vevent').map(v => new ICAL.Event(v));
  const exceptions = events.filter(e => e.isRecurrenceException());
  const masters = events.filter(e => !e.isRecurrenceException());
  for (const ev of exceptions) {
    const master = masters.find(m => m.uid === ev.uid);
    if (master) master.relateException(ev);
  }
  const push = (ev, start, end) => {
    const allDay = start.isDate;
    out.push({
      uid: ev.uid + ':' + start.toString(),
      title: ev.summary || '(no title)',
      start: allDay ? start.toString().slice(0, 10) : start.toJSDate().toISOString(),
      end: allDay ? end.toString().slice(0, 10) : end.toJSDate().toISOString(),
      allDay,
      location: ev.location || null
    });
  };
  for (const ev of masters) {
    if (ev.isRecurring()) {
      const it = ev.iterator();
      let next, guard = 0;
      while ((next = it.next()) && guard++ < 2000) {
        if (next.compare(rangeEnd) >= 0) break;
        const occ = ev.getOccurrenceDetails(next);
        if (occ.endDate.compare(rangeStart) > 0) push(occ.item, occ.startDate, occ.endDate);
      }
    } else if (ev.startDate && ev.endDate.compare(rangeStart) > 0 && ev.startDate.compare(rangeEnd) < 0) {
      push(ev, ev.startDate, ev.endDate || ev.startDate);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
