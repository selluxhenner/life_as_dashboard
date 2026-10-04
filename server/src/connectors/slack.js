// Slack with a user token (xoxp-…): DMs, mentions and chosen channels. Read-only.
import { db } from '../db.js';
import { updateConnection } from './store.js';

async function api(token, method, params = {}) {
  const res = await fetch('https://slack.com/api/' + method + '?' + new URLSearchParams(params), {
    headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000)
  });
  if (res.status === 429) throw new Error('Slack rate limit, retry later');
  const data = await res.json();
  if (!data.ok) throw Object.assign(new Error('Slack: ' + data.error), { slack: data.error });
  return data;
}

export async function verifyToken(token) {
  const a = await api(token, 'auth.test');
  return { userId: a.user_id, user: a.user, team: a.team, teamId: a.team_id, url: a.url };
}

async function userInfo(token, id) {
  if (!id) return { name: 'Someone', avatar: null };
  const row = db.get('SELECT * FROM slack_users WHERE id = ?', id);
  if (row && Date.now() - row.updated_at < 7 * 86400000) return row;
  try {
    const u = (await api(token, 'users.info', { user: id })).user;
    const name = u.profile?.display_name || u.real_name || u.name;
    const avatar = u.profile?.image_48 || null;
    db.run(`INSERT INTO slack_users (id, name, avatar, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, updated_at = excluded.updated_at`, id, name, avatar, Date.now());
    return { name, avatar };
  } catch { return { name: id, avatar: null }; }
}

/* Replace <@U123> mentions with names, strip Slack link markup. */
async function readable(token, text = '') {
  const ids = [...new Set([...text.matchAll(/<@([A-Z0-9]+)>/g)].map(m => m[1]))];
  for (const id of ids) text = text.replaceAll(`<@${id}>`, '@' + (await userInfo(token, id)).name);
  return text.replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1').replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1').slice(0, 1200);
}

async function store(token, kind, m, channelId, channelName) {
  const u = await userInfo(token, m.user);
  db.run(`INSERT INTO slack_messages (id, kind, channel_id, channel_name, user_id, user_name, avatar, text, ts, permalink)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET text = excluded.text, kind = CASE WHEN slack_messages.kind = 'mention' THEN 'mention' ELSE excluded.kind END`,
    channelId + ':' + m.ts, kind, channelId, channelName, m.user, u.name, u.avatar, await readable(token, m.text), Math.round(Number(m.ts) * 1000), m.permalink || null);
}

export async function refreshSlack(conn) {
  const token = conn.secret();
  const me = conn.config.userId;
  // DMs and mentions via search (needs search:read) — newest first, across all conversations
  for (const [kind, query] of [['dm', 'is:dm'], ['mention', `<@${me}>`]]) {
    try {
      const r = await api(token, 'search.messages', { query, sort: 'timestamp', sort_dir: 'desc', count: '30' });
      for (const m of r.messages?.matches || []) {
        if (m.user === me) continue;
        await store(token, kind, m, m.channel?.id, m.channel?.is_im ? null : m.channel?.name);
      }
    } catch (e) { if (e.slack !== 'missing_scope') throw e; }
  }
  for (const ch of conn.config.channels || []) {
    const r = await api(token, 'conversations.history', { channel: ch, limit: '15' });
    const name = (conn.config.channelNames || {})[ch] || ch;
    for (const m of r.messages || []) if (!m.subtype || m.subtype === 'thread_broadcast') await store(token, 'channel', m, ch, name);
  }
  db.run('DELETE FROM slack_messages WHERE ts < ?', Date.now() - 7 * 86400000);
}

export async function listChannels(conn) {
  const r = await api(conn.secret(), 'users.conversations', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200' });
  const channels = (r.channels || []).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  updateConnection(conn.id, { config: { ...conn.config, channelNames: Object.fromEntries(channels.map(c => [c.id, c.name])) } });
  return channels;
}
