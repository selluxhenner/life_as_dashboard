// Notifications: stored for the desktop/app to poll, and pushed to the phone via ntfy (free, no account).
import { db } from '../db.js';
import { config } from '../config.js';

export async function notify({ title, body, url = null, priority = 3, tags = [] }) {
  db.run('INSERT INTO notifications (title, body, url, priority, created_at) VALUES (?, ?, ?, ?, ?)', title, body, url, priority, Date.now());
  if (!config.ntfy.topic) return;
  try {
    await fetch(`${config.ntfy.url}/${encodeURIComponent(config.ntfy.topic)}`, {
      method: 'POST',
      headers: { Title: title.replace(/[^\x20-\x7E]/g, ''), Priority: String(priority), Tags: tags.join(','), ...(url ? { Click: config.publicUrl + '/' + url } : {}) },
      body,
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) { console.error('ntfy failed', e.message); }
}

export function notificationsSince(since = 0) {
  return db.all('SELECT * FROM notifications WHERE id > ? ORDER BY id DESC LIMIT 30', since).reverse();
}
