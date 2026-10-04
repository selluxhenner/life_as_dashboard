// Inbox triage (Haiku): category, priority and a one-line summary for new emails.
import { z } from 'zod';
import { db } from '../db.js';
import { structured, asData, DATA_RULE } from '../ai/claude.js';

const Schema = z.object({ items: z.array(z.object({
  id: z.string(),
  category: z.enum(['personal', 'school', 'work', 'job-hunt', 'finance', 'newsletter', 'notification', 'spam']),
  priority: z.enum(['high', 'normal', 'low']).describe('high = needs Kevin to act or reply soon'),
  summary: z.string().describe('What it is and what is needed, max 100 chars')
})) });

export async function triageInbox() {
  const pending = db.all(`SELECT id, account, from_name, from_addr, subject, snippet FROM emails WHERE ai_category IS NULL ORDER BY received_at DESC LIMIT 40`);
  if (!pending.length) return 0;
  const out = await structured({
    feature: 'triage', tier: 'fast', schema: Schema, maxTokens: 5000,
    system: `You sort Kevin's email. Kevin is a student in Berlin looking for Werkstudent / part-time / startup jobs. ${DATA_RULE}`,
    prompt: asData('emails', pending.map(p => ({ id: p.id, account: p.account, from: `${p.from_name} <${p.from_addr}>`, subject: p.subject, snippet: p.snippet })))
  });
  const ids = new Set(pending.map(p => p.id));
  db.tx(() => {
    for (const s of out.items) if (ids.has(s.id)) db.run('UPDATE emails SET ai_category = ?, ai_priority = ?, ai_summary = ? WHERE id = ?', s.category, s.priority, s.summary, s.id);
    for (const p of pending) db.run("UPDATE emails SET ai_category = COALESCE(ai_category, 'notification') WHERE id = ?", p.id);
  });
  return out.items.length;
}
