// Server notifications (briefing ready, breaking news, approvals, call summaries) shown as native notifications.
// Desktop: Tauri notification plugin. Browser: Web Notifications. Phone push comes from ntfy (server side).
import { apiConfig, apiFetch } from './api.js';
import { platform } from './platform.js';
import { toast } from './fx.js';

const KEY = 'agenticNotifySince';
let since = Number(localStorage.getItem(KEY) || 0);

async function show(n) {
  if (platform.isTauri) {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === 'granted';
      if (ok) { sendNotification({ title: n.title, body: n.body }); return; }
    } catch { /* plugin missing: fall through to toast */ }
  } else if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    const note = new Notification(n.title, { body: n.body, icon: 'icon.svg', tag: 'agentic-' + n.id });
    note.onclick = () => { window.focus(); if (n.url) location.hash = n.url.replace(/^#/, '#'); };
    return;
  }
  toast(`${n.title} — ${n.body}`, n.priority >= 4 ? 'flare' : 'signal');
}

async function poll() {
  const cfg = apiConfig();
  if (!cfg) return;
  try {
    const { notifications = [] } = await apiFetch(cfg, '/api/notifications?since=' + since);
    const firstRun = since === 0;
    for (const n of notifications) {
      since = Math.max(since, n.id);
      // never replay a backlog on first connect; only things raised from now on
      if (!firstRun && Date.now() - n.created_at < 30 * 60000) await show(n);
    }
    localStorage.setItem(KEY, String(since));
  } catch { /* offline: try next round */ }
}

export function initNotifications() {
  if (!platform.isTauri && 'Notification' in window && Notification.permission === 'default') {
    window.addEventListener('pointerdown', () => Notification.requestPermission().catch(() => {}), { once: true });
  }
  poll();
  setInterval(poll, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}
