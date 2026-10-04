// Pull fresh data from every connection into the local cache tables.
import { db } from '../db.js';
import { listConnections, markSynced } from '../connectors/store.js';
import { fetchEvents } from '../connectors/gcal.js';
import { fetchIcs, expand } from '../connectors/ics.js';
import { refreshGmail } from '../connectors/gmail.js';
import { refreshSlack } from '../connectors/slack.js';
import { localDate, addDays } from '../lib/time.js';

const PAST = 7, FUTURE = 60;

function replaceEvents(conn, events, kind) {
  const now = Date.now();
  db.tx(() => {
    db.run('DELETE FROM calendar_events WHERE connection_id = ?', conn.id);
    for (const e of events) {
      db.run(`INSERT OR REPLACE INTO calendar_events (id, connection_id, kind, calendar, account, color, title, start, end, all_day, location, link, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id, conn.id, kind || e.kind || 'event', e.calendar || conn.label, e.account || conn.account, e.color || conn.color,
        e.title, e.start, e.end, e.allDay, e.location, e.link, now);
    }
  });
}

export async function refreshCalendar() {
  const from = addDays(localDate(), -PAST), to = addDays(localDate(), FUTURE);
  const results = [];
  for (const conn of listConnections()) {
    if (conn.status === 'reauth') continue;
    try {
      if (conn.provider === 'google' && conn.features.includes('calendar')) {
        const evs = await fetchEvents(conn, from, to);
        if (evs) { replaceEvents(conn, evs); markSynced(conn.id); results.push([conn.account, evs.length]); }
      } else if (conn.provider === 'ics') {
        const text = await fetchIcs(conn.secret());
        const evs = expand(text, new Date(from + 'T00:00:00Z'), new Date(to + 'T00:00:00Z'))
          .map(e => ({ ...e, id: conn.id + ':' + e.uid, calendar: conn.label }));
        replaceEvents(conn, evs, conn.config.kind === 'school' ? 'lesson' : 'event');
        markSynced(conn.id); results.push([conn.label, evs.length]);
      }
    } catch (e) { markSynced(conn.id, e.message); results.push([conn.label, 'error: ' + e.message]); }
  }
  return results;
}

export async function refreshInbox() {
  const results = [];
  for (const conn of listConnections()) {
    if (conn.status === 'reauth') continue;
    try {
      if (conn.provider === 'google' && conn.features.includes('gmail')) { results.push([conn.account, await refreshGmail(conn)]); markSynced(conn.id); }
      else if (conn.provider === 'slack') { await refreshSlack(conn); markSynced(conn.id); results.push([conn.label, 'ok']); }
    } catch (e) { markSynced(conn.id, e.message); results.push([conn.label, 'error: ' + e.message]); }
  }
  return results;
}
