// Notifications: stored for the apps to fetch (the Android app checks every 15 minutes and at the briefing time),
// woken instantly through Firebase when that is set up, and pushed to ntfy when NTFY_TOPIC is set.
import { db } from '../db.js';
import { config } from '../config.js';
import { getSetting } from '../settings.js';
import { localDate, zonedInstant } from '../lib/time.js';
import { fcmPing } from './fcm.js';

// briefing: the morning briefing · breaking: world news · ai: major AI news · calendar: meeting prep
// jobs: job-hunt nudges · agent: approvals and call summaries · general: anything else
export const KINDS = ['briefing', 'breaking', 'ai', 'calendar', 'jobs', 'agent', 'general'];
const NEWSY = ['breaking', 'ai'];

/** Breaking + AI alerts raised since local midnight (they share the daily cap). */
export function newsAlertsToday(now = new Date()) {
  return db.get(`SELECT COUNT(*) n FROM notifications WHERE kind IN ('breaking', 'ai') AND created_at >= ?`,
    zonedInstant(localDate(now), '00:00').getTime()).n;
}

/** Was an alert with this ref raised within the last `ms`? */
export const alertedRecently = (ref, ms) => !!db.get('SELECT 1 FROM notifications WHERE ref = ? AND created_at > ?', ref, Date.now() - ms);

/* Returns the new notification id, or null when this kind is switched off or the daily cap is reached. */
export async function notify({ title, body, url = null, priority = 3, tags = [], kind = 'general', ref = null }) {
  if (!KINDS.includes(kind)) kind = 'general';
  const alerts = getSetting('alerts');
  if (alerts[kind] === false) return null;
  if (NEWSY.includes(kind) && newsAlertsToday() >= alerts.maxPerDay) return null;
  const id = Number(db.run('INSERT INTO notifications (title, body, url, priority, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    title, body, url, priority, kind, ref, Date.now()).lastInsertRowid);
  await fcmPing({ id: String(id), kind }).catch(e => console.error('fcm failed', e.message));
  if (config.ntfy.topic) {
    try {
      await fetch(`${config.ntfy.url}/${encodeURIComponent(config.ntfy.topic)}`, {
        method: 'POST',
        headers: { Title: title.replace(/[^\x20-\x7E]/g, ''), Priority: String(priority), Tags: tags.join(','), ...(url ? { Click: config.publicUrl + '/' + url } : {}) },
        body,
        signal: AbortSignal.timeout(8000)
      });
    } catch (e) { console.error('ntfy failed', e.message); }
  }
  return id;
}

export function notificationsSince(since = 0) {
  return db.all('SELECT * FROM notifications WHERE id > ? ORDER BY id DESC LIMIT 30', since).reverse();
}
