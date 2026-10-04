// Connections (Google accounts, Slack, ICS), calendar and inbox endpoints.
import { Hono } from 'hono';
import { db } from '../db.js';
import { HttpError, body, str } from '../http.js';
import { listConnections, getConnection, createConnection, updateConnection, deleteConnection, publicConn } from '../connectors/store.js';
import { startUrl, revoke } from '../connectors/google.js';
import { verifyToken, listChannels } from '../connectors/slack.js';
import { fetchIcs, expand, normaliseUrl } from '../connectors/ics.js';
import { push } from '../connectors/gcal.js';
import { gmailLink } from '../connectors/gmail.js';
import { refreshCalendar, refreshInbox } from '../jobs/refresh.js';

export const connections = new Hono();

connections.get('/connections', c => c.json({ connections: listConnections().map(publicConn) }));

connections.post('/connections/google/start', async c => {
  const b = await body(c);
  return c.json({ url: startUrl({ features: Array.isArray(b.features) ? b.features : ['calendar', 'gmail'], reconnectId: b.reconnectId || null }) });
});

connections.post('/connections/slack', async c => {
  const token = str((await body(c)).token, 300);
  if (!/^xox[pb]-/.test(token)) throw new HttpError(400, 'That does not look like a Slack token (xoxp-…)');
  let me;
  try { me = await verifyToken(token); } catch (e) { throw new HttpError(400, 'Slack rejected the token: ' + e.message); }
  const existing = listConnections('slack').find(x => x.config.teamId === me.teamId);
  const cfg = { userId: me.userId, teamId: me.teamId, team: me.team, channels: existing?.config.channels || [] };
  const conn = existing
    ? updateConnection(existing.id, { secret: token, config: cfg, status: 'ok', account: me.user + ' @ ' + me.team })
    : createConnection({ provider: 'slack', account: me.user + ' @ ' + me.team, label: me.team, secret: token, config: cfg });
  refreshInbox().catch(() => {});
  return c.json({ connection: publicConn(conn) }, 201);
});

connections.post('/connections/ics', async c => {
  const b = await body(c);
  const url = normaliseUrl(str(b.url, 2000));
  let preview;
  try {
    const now = new Date();
    preview = expand(await fetchIcs(url), now, new Date(now.getTime() + 21 * 86400000)).filter(e => !e.allDay).slice(0, 3);
  } catch (e) { throw new HttpError(400, e.message); }
  const conn = createConnection({ provider: 'ics', account: str(b.label, 60) || 'School', label: str(b.label, 60) || 'School', secret: url, config: { kind: b.kind || 'school' } });
  updateConnection(conn.id, { color: '#FFC857' });
  refreshCalendar().catch(() => {});
  return c.json({ connection: publicConn(getConnection(conn.id)), preview }, 201);
});

connections.patch('/connections/:id', async c => {
  const conn = getConnection(c.req.param('id'));
  if (!conn) throw new HttpError(404, 'Connection not found');
  const b = await body(c);
  const patch = {};
  if (typeof b.label === 'string') patch.label = str(b.label, 60);
  if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) patch.color = b.color;
  if (b.config && typeof b.config === 'object') {
    patch.config = { ...conn.config };
    if (Array.isArray(b.config.channels)) patch.config.channels = b.config.channels.filter(x => typeof x === 'string').slice(0, 20);
    if (typeof b.config.pushTarget === 'boolean') {
      if (b.config.pushTarget) for (const g of listConnections('google')) if (g.id !== conn.id && g.config.pushTarget) updateConnection(g.id, { config: { ...g.config, pushTarget: false } });
      patch.config.pushTarget = b.config.pushTarget;
    }
  }
  return c.json({ connection: publicConn(updateConnection(conn.id, patch)) });
});

connections.delete('/connections/:id', async c => {
  const conn = getConnection(c.req.param('id'));
  if (!conn) throw new HttpError(404, 'Connection not found');
  if (conn.provider === 'google') await revoke(conn);
  deleteConnection(conn.id);
  return c.json({ ok: true });
});

connections.post('/connections/:id/refresh', async c => {
  const conn = getConnection(c.req.param('id'));
  if (!conn) throw new HttpError(404, 'Connection not found');
  return c.json({ calendar: await refreshCalendar(), inbox: await refreshInbox() });
});

connections.get('/slack/channels', async c => {
  const conn = listConnections('slack')[0];
  if (!conn) throw new HttpError(404, 'Slack is not connected');
  return c.json({ channels: await listChannels(conn) });
});

/* ---------- calendar ---------- */
let lastCalRefresh = 0;
connections.get('/calendar/events', async c => {
  const from = c.req.query('from') || '', to = c.req.query('to') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpError(400, 'from/to must be YYYY-MM-DD');
  if (c.req.query('live') === '1' || Date.now() - lastCalRefresh > 10 * 60000) {
    lastCalRefresh = Date.now();
    await refreshCalendar().catch(e => console.error('calendar refresh', e));
  }
  const rows = db.all(`SELECT * FROM calendar_events WHERE start < ? AND end >= ? ORDER BY start`, to + 'T23:59:59Z', from);
  const connected = listConnections().some(x => x.provider === 'ics' || (x.provider === 'google' && x.features.includes('calendar')));
  return c.json({
    connected,
    events: rows.map(r => ({ id: r.id, kind: r.kind, calendar: r.calendar, account: r.account, color: r.color, title: r.title, allDay: !!r.all_day, start: r.start, end: r.end, location: r.location, link: r.link }))
  });
});
connections.post('/calendar/push', async c => {
  const b = await body(c);
  return c.json(await push({ timeZone: typeof b.timeZone === 'string' ? b.timeZone : 'Europe/Berlin', upserts: Array.isArray(b.upserts) ? b.upserts : [], deletes: Array.isArray(b.deletes) ? b.deletes.filter(k => typeof k === 'string') : [] }));
});

/* ---------- inbox ---------- */
let lastInboxRefresh = 0;
async function maybeRefreshInbox(live) {
  if (live || Date.now() - lastInboxRefresh > 5 * 60000) { lastInboxRefresh = Date.now(); await refreshInbox().catch(e => console.error('inbox refresh', e)); }
}
connections.get('/inbox/email', async c => {
  await maybeRefreshInbox(c.req.query('live') === '1');
  const accounts = listConnections('google').filter(x => x.features.includes('gmail')).map(x => ({ id: x.id, account: x.account, color: x.color, status: x.status }));
  const emails = db.all('SELECT * FROM emails ORDER BY received_at DESC LIMIT 120').map(r => ({
    id: r.id, account: r.account, threadId: r.thread_id, fromName: r.from_name, fromAddr: r.from_addr, subject: r.subject,
    snippet: r.snippet, receivedAt: r.received_at, unread: !!r.unread, aiCategory: r.ai_category, aiPriority: r.ai_priority, aiSummary: r.ai_summary,
    link: gmailLink(r.account, r.thread_id)
  }));
  return c.json({ accounts, emails });
});
connections.get('/inbox/slack', async c => {
  await maybeRefreshInbox(c.req.query('live') === '1');
  const conn = listConnections('slack')[0];
  if (!conn) return c.json({ connected: false });
  const rows = kind => db.all('SELECT * FROM slack_messages WHERE kind = ? ORDER BY ts DESC LIMIT 40', kind).map(r => ({
    id: r.id, channelId: r.channel_id, channelName: r.channel_name, userName: r.user_name, avatar: r.avatar, text: r.text, ts: r.ts, permalink: r.permalink
  }));
  const chMsgs = rows('channel');
  const channels = (conn.config.channels || []).map(id => ({ id, name: (conn.config.channelNames || {})[id] || id, messages: chMsgs.filter(m => m.channelId === id) }));
  return c.json({ connected: true, team: conn.config.team, dms: rows('dm'), mentions: rows('mention'), channels });
});
