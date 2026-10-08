// Agent tools. risk: read (free), internal (runs immediately, logged), outward (always waits for Kevin's approval).
import { z } from 'zod';
import { db } from '../db.js';
import { listOpenTodos, createTodo, patchTodo } from '../routes/todos.js';
import { listJobs, saveJob } from '../routes/jobs.js';
import { gatherContext, getBriefing } from '../jobs/briefing.js';
import { latestDigest } from '../jobs/news.js';
import { listConnections, getConnection } from '../connectors/store.js';
import { messageBody } from '../connectors/gmail.js';
import { createEvent, inviteToEvent, editableEvent, changeEvent, cancelEvent } from '../connectors/gcal.js';
import { refreshCalendar } from '../jobs/refresh.js';
import { getSetting, setSetting } from '../settings.js';
import { writeDoc, readDoc, listDocs } from '../routes/docs.js';
import { notify } from '../notify/index.js';
import { localDate } from '../lib/time.js';
import { uid } from '../lib/crypto.js';
import { config } from '../config.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const guest = z.object({ email: z.string().email().max(200), name: z.string().max(100).optional() });

/* An outward action waits in Kevin's approval queue. Used by the runner for outward tools, and by tools that do the
   internal half of a job right away and leave the outward half (e.g. emailing an invitation) for his OK. */
export async function queueAction(ctx, tool, input) {
  const id = uid('act_');
  const summary = TOOLS[tool].summary(input);
  db.run(`INSERT INTO agent_actions (id, run_id, tool, input, risk, status, summary, created_at) VALUES (?, ?, ?, ?, 'outward', 'pending', ?, ?)`,
    id, ctx.runId, tool, JSON.stringify(input), summary, Date.now());
  ctx.onEvent?.({ type: 'tool', name: tool, status: 'pending', summary });
  if (ctx.trigger !== 'chat' && ctx.trigger !== 'voice') await notify({ title: 'Needs your approval', body: summary, url: '#/assistant', kind: 'agent' });
  return id;
}

/* The people Lina knows ("my business partner" → name + email), plus senders from the mail cache. */
export const people = () => getSetting('lina').people || [];
function findPerson(q) {
  const s = q.toLowerCase().trim();
  const known = people().filter(p => [p.name, p.email, p.relation].some(v => v && v.toLowerCase().includes(s)) || (p.relation && s.includes(p.relation.toLowerCase())));
  const mail = db.all(`SELECT from_name AS name, from_addr AS email, MAX(received_at) AS last FROM emails
    WHERE from_name LIKE ? OR from_addr LIKE ? GROUP BY from_addr ORDER BY last DESC LIMIT 5`, `%${q}%`, `%${q}%`);
  return { known, fromEmails: mail.filter(m => !known.some(k => k.email === m.email)) };
}
/* Habits and captures are synced documents ("habit:<id>", "capture:<id>") in the shape the app writes them, so a habit
   Lina adds shows up on every device with the next sync. */
export const listHabits = () => listDocs('habit:');
function habitDoc(id) {
  const hb = readDoc('habit:' + id);
  if (!hb) throw new Error('Unknown habit id ' + id + ' (habit ids are in the context or from list_habits)');
  return hb;
}
const docId = () => uid('id_');
/* What Kevin asked to write down lands in his Capture inbox as a note; background jobs keep theirs to themselves. */
function captureNote({ title, body }) {
  const t = title.trim(), b = body.trim();
  const text = !b || b === t ? t : t ? `${t}: ${b}` : b;
  if (!text) return null;
  const now = Date.now(), id = docId();
  writeDoc('capture:' + id, { id, text, type: 'note', date: '', time: '', end: '', horizon: 'woche', priority: 'med', createdAt: now, updatedAt: now, archived: false, ref: null });
  return id;
}

const when = i => {
  const days = Math.round((Date.parse(i.date) - Date.parse(localDate())) / 86400000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 && days < 7 ? new Date(i.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long' }) : i.date;
  return `${day} ${i.time}`;
};

export const TOOLS = {
  get_today: {
    risk: 'read', description: "Today's full context: calendar (meetings, lessons), important emails, Slack DMs/mentions, open todos, job follow-ups, news and AI headlines.",
    schema: z.object({ date: date.optional() }),
    run: ({ date: d }) => gatherContext(d || localDate())
  },
  get_briefing: { risk: 'read', description: "This morning's generated briefing, if it exists.", schema: z.object({}), run: () => getBriefing() || { none: true } },
  list_todos: { risk: 'read', description: 'Open todos with id, title, priority and due date.', schema: z.object({}), run: () => listOpenTodos().map(t => ({ id: t.id, title: t.title, priority: t.priority, due: t.due })) },
  get_calendar: {
    risk: 'read', description: 'Calendar events (all Google accounts + school lessons) between two dates (inclusive from, exclusive to). id is for move_event / cancel_event; lessons are read-only.',
    schema: z.object({ from: date, to: date }),
    run: ({ from, to }) => db.all('SELECT id, kind, title, start, end, all_day, location, calendar FROM calendar_events WHERE start < ? AND end >= ? ORDER BY start LIMIT 80', to, from)
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
  update_todo: {
    risk: 'internal', description: 'Change a todo: rename it, move its due date (null = no date), change priority or notes, or reopen it (done false).',
    schema: z.object({ id: z.string(), title: z.string().min(1).max(300).optional(), due: date.nullable().optional(), priority: z.enum(['high', 'med', 'low']).optional(), notes: z.string().max(2000).optional(), done: z.boolean().optional() }),
    run: ({ id, ...patch }) => patchTodo(id, patch),
    summary: i => `Updated task${i.title ? ' “' + i.title + '”' : ''}${i.due ? ' (due ' + i.due + ')' : ''}`
  },
  delete_todo: {
    risk: 'internal', description: 'Delete a todo Kevin no longer wants (say which one you deleted).',
    schema: z.object({ id: z.string(), title: z.string().max(300).optional() }),
    run: ({ id }) => patchTodo(id, { deleted: true }), summary: i => `Deleted task${i.title ? ' “' + i.title + '”' : ''}`
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
    risk: 'internal', description: 'Write a note: something Kevin wants to capture or remember (it lands in his Capture inbox), call answers, meeting prep. title: a few words; body: the note itself.',
    schema: z.object({ title: z.string().max(200), body: z.string().max(5000) }),
    run: (i, ctx) => {
      const id = uid('note_');
      db.run('INSERT INTO notes (id, title, body, source, created_at) VALUES (?, ?, ?, ?, ?)', id, i.title, i.body, ctx.source, Date.now());
      const capture = ['chat', 'voice', 'phone'].includes(ctx.trigger) ? captureNote(i) : null;
      return { id, ...(capture ? { capture } : {}) };
    },
    summary: i => `Noted “${i.title}”`
  },
  list_habits: {
    risk: 'read', description: 'Habits with id, label, how often (daily or weekly with a target) and whether they are ticked off today.',
    schema: z.object({}),
    run: () => { const today = localDate(); return listHabits().map(hb => ({ id: hb.id, label: hb.label, mode: hb.mode || 'daily', target: hb.target, doneToday: !!hb.history?.[today] })); }
  },
  add_habit: {
    risk: 'internal', description: 'Start tracking a new habit. mode daily (default) or weekly, with target = times per week.',
    schema: z.object({ label: z.string().min(1).max(120), mode: z.enum(['daily', 'weekly']).optional(), target: z.number().int().min(1).max(7).optional() }),
    run: i => {
      const hb = { id: docId(), label: i.label, icon: '◆', history: {}, mode: i.mode || 'daily', ...(i.mode === 'weekly' ? { target: i.target || 3 } : {}), createdAt: localDate() };
      writeDoc('habit:' + hb.id, hb);
      return { ok: true, id: hb.id };
    },
    summary: i => `Added habit “${i.label}”`
  },
  update_habit: {
    risk: 'internal', description: 'Rename a habit or change how often it is due.',
    schema: z.object({ id: z.string(), label: z.string().min(1).max(120).optional(), mode: z.enum(['daily', 'weekly']).optional(), target: z.number().int().min(1).max(7).optional() }),
    run: ({ id, ...patch }) => {
      const hb = { ...habitDoc(id), ...patch };
      if (hb.mode === 'weekly' && !hb.target) hb.target = 3;
      writeDoc('habit:' + id, hb);
      return { ok: true };
    },
    summary: i => `Updated habit${i.label ? ' “' + i.label + '”' : ''}`
  },
  delete_habit: {
    risk: 'internal', description: 'Delete a habit together with its history (say which one you deleted).',
    schema: z.object({ id: z.string(), label: z.string().max(120).optional() }),
    run: ({ id }) => { habitDoc(id); writeDoc('habit:' + id, null); return { ok: true }; },
    summary: i => `Deleted habit${i.label ? ' “' + i.label + '”' : ''}`
  },
  check_habit: {
    risk: 'internal', description: 'Tick a habit off for a day (today unless date is given), or untick it with done false.',
    schema: z.object({ id: z.string(), date: date.optional(), done: z.boolean().optional(), label: z.string().max(120).optional() }),
    run: ({ id, date: day = localDate(), done = true }) => {
      const hb = habitDoc(id);
      const history = { ...(hb.history || {}) };
      if (done) history[day] = true; else delete history[day];
      writeDoc('habit:' + id, { ...hb, history });
      return { ok: true };
    },
    summary: i => `${i.done === false ? 'Unticked' : 'Ticked off'} ${i.label ? '“' + i.label + '”' : 'a habit'}`
  },
  add_calendar_block: {
    risk: 'internal', description: "Put a time block on Kevin's own Google calendar (no attendees, nobody is invited). Use it to give a task a time slot.",
    schema: z.object({ title: z.string().max(200), date, time, endTime: time.optional(), notes: z.string().max(1000).optional() }),
    run: async i => { const ev = await createEvent(i, config.tz); refreshCalendar().catch(() => {}); return { ok: true, link: ev.link }; },
    summary: i => `Blocked ${when(i)} “${i.title}”`
  },
  move_event: {
    risk: 'internal',
    description: "Move or rename an event on Kevin's Google calendar (id from get_calendar). When only the start changes it keeps its length. If other people are invited, the change waits for Kevin's OK (they get an update email).",
    schema: z.object({ id: z.string(), title: z.string().max(200).optional(), date: date.optional(), time: time.optional(), endTime: time.optional(), location: z.string().max(300).optional() }),
    run: async (i, ctx) => {
      const e = await editableEvent(i.id);
      const label = i.title || e.ev.summary || 'event';
      if (e.guests.length) {
        const id = await queueAction(ctx, 'update_event', { ...i, label, guests: e.guests });
        return { ok: true, waiting: `Guests (${e.guests.join(', ')}) would be emailed, so the change is queued for Kevin's approval (${id}), NOT done yet` };
      }
      await changeEvent(i);
      refreshCalendar().catch(() => {});
      return { ok: true };
    },
    summary: i => `Changed “${i.title || 'an event'}”${i.date || i.time ? ' to ' + [i.date, i.time].filter(Boolean).join(' ') : ''}`
  },
  find_person: {
    risk: 'read', description: 'Who someone is: searches the people Kevin told you about (by name, email or relation such as "business partner") and recent email senders.',
    schema: z.object({ query: z.string().min(1).max(100) }), run: ({ query }) => findPerson(query)
  },
  remember_person: {
    risk: 'internal', description: 'Remember a person for later, e.g. relation "business partner" = name + email. Updates the entry with the same email or relation.',
    schema: z.object({ name: z.string().min(1).max(100), email: z.string().email().max(200).optional(), relation: z.string().max(60).optional() }),
    run: i => {
      const list = people().filter(p => !((i.email && p.email === i.email) || (i.relation && p.relation?.toLowerCase() === i.relation.toLowerCase())));
      setSetting('lina', { ...getSetting('lina'), people: [...list, i].slice(-50) });
      return { ok: true };
    },
    summary: i => `Remembered ${i.name}${i.relation ? ' (' + i.relation + ')' : ''}`
  },
  schedule_meeting: {
    risk: 'internal',
    description: 'Schedule a meeting: it goes on Kevin\'s Google calendar right away. Guests are NOT invited yet: their invitation waits for Kevin\'s approval (queued automatically). video: add a Google Meet link (for calls / remote meetings).',
    schema: z.object({ title: z.string().min(1).max(200), date, time, endTime: time.optional(), guests: z.array(guest).max(10).optional(), location: z.string().max(300).optional(), video: z.boolean().optional(), notes: z.string().max(1000).optional() }),
    run: async (i, ctx) => {
      const ev = await createEvent(i, config.tz);
      refreshCalendar().catch(() => {});
      const guests = i.guests || [];
      const invite = guests.length ? await queueAction(ctx, 'send_invite', { connectionId: ev.connectionId, eventId: ev.eventId, title: i.title, date: i.date, time: i.time, guests }) : null;
      return { ok: true, onCalendar: true, meet: ev.meet, invitation: invite ? `queued for Kevin's approval (${invite}), NOT sent yet` : 'no guests' };
    },
    summary: i => `Scheduled “${i.title}” ${when(i)}`
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
  send_invite: {
    risk: 'outward', description: 'Invite guests to an event created by schedule_meeting (Google emails them the invitation).',
    schema: z.object({ connectionId: z.string(), eventId: z.string(), title: z.string().max(200), date, time, guests: z.array(guest).min(1).max(10) }),
    summary: i => `Send the invite for “${i.title}” (${when(i)}) to ${i.guests.map(g => g.name || g.email).join(', ')}`,
    preview: i => i.guests.map(g => (g.name ? g.name + ' <' + g.email + '>' : g.email)).join('\n'),
    execute: i => inviteToEvent({ connectionId: i.connectionId, eventId: i.eventId, attendees: i.guests })
  },
  update_event: {
    risk: 'outward', description: 'Change an event that other people are invited to; Google emails them the update. Use move_event, it queues this when needed.',
    schema: z.object({ id: z.string(), label: z.string().max(200), title: z.string().max(200).optional(), date: date.optional(), time: time.optional(), endTime: time.optional(), location: z.string().max(300).optional(), guests: z.array(z.string()).optional() }),
    summary: i => `Change “${i.label}”${i.date || i.time ? ' to ' + [i.date, i.time].filter(Boolean).join(' ') : ''} and tell ${(i.guests || []).join(', ') || 'the guests'}`,
    execute: async ({ label, guests, ...i }) => { const r = await changeEvent(i, true); refreshCalendar().catch(() => {}); return r; }
  },
  cancel_event: {
    risk: 'outward', description: "Cancel (delete) an event on Kevin's Google calendar, id from get_calendar. Always waits for his OK; guests are told it is cancelled.",
    schema: z.object({ id: z.string(), title: z.string().max(200) }),
    summary: i => `Cancel “${i.title}”`,
    execute: async i => { const e = await editableEvent(i.id); const r = await cancelEvent(i, e.guests.length > 0); refreshCalendar().catch(() => {}); return r; }
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
