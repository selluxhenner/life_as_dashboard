// Gmail (read-only): recent inbox messages per account, metadata only. Bodies are fetched on demand.
import { db } from '../db.js';
import { gfetch } from './google.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX = 25;

function parseFrom(v = '') {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || m[2], addr: m[2] } : { name: v.trim(), addr: v.trim() };
}

export async function refreshGmail(conn) {
  const list = await gfetch(conn, `${API}/messages?` + new URLSearchParams({ q: 'in:inbox newer_than:3d', maxResults: String(MAX) }));
  if (!list) return 0;
  if (!list.ok) throw new Error('Gmail HTTP ' + list.status);
  const ids = ((await list.json()).messages || []).map(m => m.id);
  const known = new Set(db.all(`SELECT id FROM emails WHERE connection_id = ?`, conn.id).map(r => r.id));
  const msgs = await Promise.all(ids.map(async id => {
    const res = await gfetch(conn, `${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    return res && res.ok ? res.json() : null;
  }));
  db.tx(() => {
    for (const m of msgs.filter(Boolean)) {
      const hdr = Object.fromEntries((m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
      const from = parseFrom(hdr.from);
      const id = conn.id + ':' + m.id;
      const unread = (m.labelIds || []).includes('UNREAD');
      if (known.has(id)) { db.run('UPDATE emails SET unread = ?, labels = ? WHERE id = ?', unread, (m.labelIds || []).join(','), id); continue; }
      db.run(`INSERT INTO emails (id, connection_id, account, thread_id, from_name, from_addr, subject, snippet, received_at, unread, labels)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, conn.id, conn.account, m.threadId, from.name, from.addr, hdr.subject || '', decode(m.snippet || ''), Number(m.internalDate) || Date.now(), unread, (m.labelIds || []).join(','));
    }
    // messages that left the inbox (archived/deleted) disappear from the list
    const keep = new Set(msgs.filter(Boolean).map(m => conn.id + ':' + m.id));
    for (const id of known) if (!keep.has(id)) db.run('DELETE FROM emails WHERE id = ?', id);
  });
  return msgs.length;
}

const decode = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/* Plain-text body of one message, for the agent. Not stored. */
export async function messageBody(conn, messageId) {
  const res = await gfetch(conn, `${API}/messages/${messageId}?format=full`);
  if (!res || !res.ok) return null;
  const m = await res.json();
  const parts = [];
  const walk = p => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data) parts.push(Buffer.from(p.body.data, 'base64url').toString('utf8'));
    (p.parts || []).forEach(walk);
  };
  walk(m.payload);
  if (!parts.length && m.payload?.body?.data) parts.push(Buffer.from(m.payload.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' '));
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 8000);
}

export function gmailLink(account, threadId) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#inbox/${threadId}`;
}
