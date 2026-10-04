// Agent tools. risk: read (free), internal (runs immediately, logged), outward (always waits for Kevin's approval).
import { z } from 'zod';
import { db } from '../db.js';
import { listOpenTodos, createTodo, patchTodo } from '../routes/todos.js';
import { listJobs, saveJob } from '../routes/jobs.js';
import { gatherContext, getBriefing } from '../jobs/briefing.js';
import { latestDigest } from '../jobs/news.js';
import { listConnections, getConnection } from '../connectors/store.js';
import { messageBody } from '../connectors/gmail.js';
import { createEvent } from '../connectors/gcal.js';
import { localDate } from '../lib/time.js';
import { uid } from '../lib/crypto.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const TOOLS = {
  get_today: {
    risk: 'read', description: "Today's full context: calendar (meetings, lessons), important emails, Slack DMs/mentions, open todos, job follow-ups, news and AI headlines.",
    schema: z.object({ date: date.optional() }),
    run: ({ date: d }) => gatherContext(d || localDate())
  },
  get_briefing: { risk: 'read', description: "This morning's generated briefing, if it exists.", schema: z.object({}), run: () => getBriefing() || { none: true } },
  list_todos: { risk: 'read', description: 'Open todos with id, title, priority and due date.', schema: z.object({}), run: () => listOpenTodos().map(t => ({ id: t.id, title: t.title, priority: t.priority, due: t.due })) },
  get_calendar: {
    risk: 'read', description: 'Calendar events (all Google accounts + school lessons) between two dates (inclusive from, exclusive to).',
    schema: z.object({ from: date, to: date }),
    run: ({ from, to }) => db.all('SELECT kind, title, start, end, all_day, location, calendar FROM calendar_events WHERE start < ? AND end >= ? ORDER BY start LIMIT 80', to, from)
  },
  search_emails: {
    risk: 'read', description: 'Search cached recent emails (last 3 days, all accounts) by text in sender or subject. Empty query = latest.',
    schema: z.object({ query: z.string().max(100).optional(), unread_only: z.boolean().optional() }),
    run: ({ query = '', unread_only }) => db.all(`SELECT id, account, from_name, from_addr, subject, snippet, received_at, unread, ai_priority, ai_summary FROM emails
      WHERE (? = '' OR from_name LIKE ? OR from_addr LIKE ? OR subject LIKE ?) AND (? = 0 OR unread = 1) ORDER BY received_at DESC LIMIT 20`,
      query, `%${query}%`, `%${query}%`, `%${query}%`, unread_only ? 1 : 0)
  },
  read_email: {
    risk: 'read', description: 'Full text of one email by id (from search_emails).',
    schema: z.object({ id: z.string() }),
    run: async ({ id }) => {
      const row = db.get('SELECT * FROM emails WHERE id = ?', id);
      if (!row) return { error: 'Unknown email id' };
      const body = await messageBody(getConnection(row.connection_id), id.split(':').pop());
      return { from: `${row.from_name} <${row.from_addr}>`, subject: row.subject, account: row.account, body };
    }
  },
  get_slack: {
    risk: 'read', description: 'Recent Slack DMs and mentions (who messaged Kevin).',
    schema: z.object({}), run: () => db.all("SELECT kind, channel_name, user_name, text, ts, permalink FROM slack_messages WHERE kind IN ('dm','mention') ORDER BY ts DESC LIMIT 20")
  },
  list_jobs: { risk: 'read', description: 'Job hunt pipeline (Berlin Werkstudent / part-time / startup roles).', schema: z.object({}), run: () => listJobs() },
  get_news: { risk: 'read', description: 'Latest world news digest by region plus breaking news.', schema: z.object({}), run: () => latestDigest() },

  create_todo: {
    risk: 'internal', description: 'Create a todo for Kevin.',
    schema: z.object({ title: z.string().min(1).max(300), priority: z.enum(['high', 'med', 'low']).optional(), due: date.optional(), notes: z.string().max(2000).optional() }),
    run: (i, ctx) => createTodo(i, ctx.source),
    summary: i => `Added task “${i.title}”`
  },
  complete_todo: {
    risk: 'internal', description: 'Mark a todo as done.',
    schema: z.object({ id: z.string() }), run: ({ id }) => patchTodo(id, { done: true }), summary: () => 'Completed a task'
  },
  save_job: {
    risk: 'internal', description: 'Add or update a job hunt entry. Pass id to update an existing one.',
    schema: z.object({
      id: z.string().optional(), company: z.string().max(200).optional(), role: z.string().max(200).optional(),
      type: z.enum(['werkstudent', 'part-time', 'startup', 'minijob', 'other']).optional(),
      status: z.enum(['saved', 'applied', 'interview', 'offer', 'rejected']).optional(),
      link: z.string().max(500).optional(), nextAction: z.string().max(200).optional(), nextActionDate: date.optional(), notes: z.string().max(3000).optional()
    }),
    run: i => saveJob(i), summary: i => `${i.id ? 'Updated' : 'Saved'} job ${i.company || ''}`.trim()
  },
  add_note: {
    risk: 'internal', description: 'Store a note (facts Kevin told you, call answers, meeting prep).',
    schema: z.object({ title: z.string().max(200), body: z.string().max(5000) }),
    run: (i, ctx) => { const id = uid('note_'); db.run('INSERT INTO notes (id, title, body, source, created_at) VALUES (?, ?, ?, ?, ?)', id, i.title, i.body, ctx.source, Date.now()); return { id }; },
    summary: i => `Noted “${i.title}”`
  },
  add_calendar_block: {
    risk: 'internal', description: "Put a time block on Kevin's own Google calendar (no attendees, nobody is invited).",
    schema: z.object({ title: z.string().max(200), date, time, endTime: time.optional(), notes: z.string().max(1000).optional() }),
    run: async i => ({ ok: await createEvent(i) }), summary: i => `Blocked ${i.date} ${i.time} “${i.title}”`
  },

  draft_email: {
    risk: 'outward', description: 'Prepare an email for Kevin to send. It is NOT sent: Kevin reviews it and sends it himself.',
    schema: z.object({ to: z.string().max(300), subject: z.string().max(300), body: z.string().max(8000), account: z.string().optional() }),
    summary: i => `Email to ${i.to}: “${i.subject}”`,
    preview: i => `To: ${i.to}\nSubject: ${i.subject}\n\n${i.body}`,
    execute: i => {
      const acc = i.account || listConnections('google').find(c => c.features.includes('gmail'))?.account || '';
      return { openUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(acc)}&view=cm&fs=1&to=${encodeURIComponent(i.to)}&su=${encodeURIComponent(i.subject)}&body=${encodeURIComponent(i.body)}` };
    }
  },
  schedule_call: {
    risk: 'outward', description: "Phone Kevin (AI voice call) to ask him specific questions. Use only when the answers can't wait and a notification isn't enough.",
    schema: z.object({ purpose: z.string().max(200), questions: z.array(z.string().max(200)).min(1).max(5) }),
    summary: i => `Call you: ${i.purpose}`,
    preview: i => i.questions.map((q, n) => `${n + 1}. ${q}`).join('\n'),
    execute: async i => { const { placeCall } = await import('../phone/twilio.js'); return placeCall(i); }
  }
};

export function toolDefs(allowed) {
  return Object.entries(TOOLS).filter(([, t]) => allowed.includes(t.risk)).map(([name, t]) => ({
    name, description: t.description + (t.risk === 'outward' ? ' Requires Kevin’s approval; you will be told it is queued.' : ''),
    input_schema: (({ $schema, ...s }) => s)(z.toJSONSchema(t.schema, { target: 'draft-7' })),
    eager_input_streaming: true
  }));
}
