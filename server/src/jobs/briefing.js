// Morning briefing: everything for today in one grounded summary, written a few minutes before the briefing time.
import { z } from 'zod';
import { db, j } from '../db.js';
import { structured, asData, DATA_RULE, MODELS } from '../ai/claude.js';
import { localDate, zonedInstant, addDays } from '../lib/time.js';
import { listOpenTodos } from '../routes/todos.js';
import { listJobs } from '../routes/jobs.js';
import { latestDigest } from './news.js';
import { aiToday } from './aimodels.js';
import { triageInbox } from './triage.js';
import { refreshCalendar, refreshInbox } from './refresh.js';
import { notify } from '../notify/index.js';
import { config } from '../config.js';

const SECTION_IDS = ['schedule', 'school', 'inbox', 'slack', 'tasks', 'jobs', 'news', 'ai'];
const BriefingSchema = z.object({
  headline: z.string().describe('One sentence, the single most important thing about today'),
  sections: z.array(z.object({
    id: z.enum(SECTION_IDS),
    title: z.string(),
    bullets: z.array(z.object({ text: z.string().describe('max 140 chars'), refs: z.array(z.string()) })).max(5)
  })),
  focus: z.array(z.string().describe('max 40 chars')).max(3)
});

export function gatherContext(date = localDate()) {
  const dayStart = zonedInstant(date, '00:00').toISOString(), dayEnd = zonedInstant(addDays(date, 1), '00:00').toISOString();
  const events = db.all(`SELECT id, kind, title, start, end, all_day, location, calendar FROM calendar_events
                         WHERE (all_day = 0 AND start < ? AND end > ?) OR (all_day = 1 AND start <= ? AND end > ?) ORDER BY start`,
    dayEnd, dayStart, date, date)
    .map(e => ({ id: 'ev:' + e.id, kind: e.kind, title: e.title, allDay: !!e.all_day,
      time: e.all_day ? 'all day' : new Date(e.start).toLocaleTimeString('en-GB', { timeZone: config.tz, hour: '2-digit', minute: '2-digit' }) + '–' + new Date(e.end).toLocaleTimeString('en-GB', { timeZone: config.tz, hour: '2-digit', minute: '2-digit' }),
      location: e.location, calendar: e.calendar }));
  const emails = db.all(`SELECT id, account, from_name, subject, snippet, ai_priority, ai_category, ai_summary FROM emails
                         WHERE received_at > ? ORDER BY (ai_priority = 'high') DESC, unread DESC, received_at DESC LIMIT 15`, Date.now() - 36 * 3600000)
    .map(e => ({ id: 'mail:' + e.id, account: e.account, from: e.from_name, subject: e.subject, summary: e.ai_summary || e.snippet, priority: e.ai_priority, category: e.ai_category }));
  const slack = db.all(`SELECT id, kind, channel_name, user_name, text FROM slack_messages WHERE kind IN ('dm','mention') AND ts > ? ORDER BY ts DESC LIMIT 15`, Date.now() - 18 * 3600000)
    .map(s => ({ id: 'slack:' + s.id, kind: s.kind, from: s.user_name, channel: s.channel_name, text: (s.text || '').slice(0, 300) }));
  const todos = listOpenTodos().slice(0, 25).map(t => ({ id: 'todo:' + t.id, title: t.title, priority: t.priority, due: t.due, overdue: !!(t.due && t.due < date) }));
  const jobs = listJobs().filter(x => x.status !== 'rejected' && x.nextActionDate && x.nextActionDate <= addDays(date, 1))
    .map(x => ({ id: 'job:' + x.id, company: x.company, role: x.role, status: x.status, next: x.nextAction, date: x.nextActionDate }));
  const news = latestDigest();
  const newsLines = [];
  for (const [region, list] of Object.entries(news.digest?.regions || {})) list.slice(0, 2).forEach((s, i) => newsLines.push({ id: `news:${region}:${i}`, region, headline: s.headline }));
  const ai = aiToday();
  return { date, weekday: new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long' }), events, emails, slack, todos, jobs, news: newsLines, ai: ai.summaryMd ? { id: 'ai:today', summary: ai.summaryMd.slice(0, 1200) } : null };
}

export async function generateBriefing({ date = localDate(), refresh = true } = {}) {
  if (refresh) {
    await refreshCalendar().catch(e => console.error('briefing: calendar', e.message));
    await refreshInbox().catch(e => console.error('briefing: inbox', e.message));
    await triageInbox().catch(e => console.error('briefing: triage', e.message));
  }
  const ctx = gatherContext(date);
  const out = await structured({
    feature: 'briefing', tier: 'main', schema: BriefingSchema, maxTokens: 8000, effort: 'medium',
    system: `You are the morning briefing of Agentic OS, Kevin's personal operating system. Kevin is a student in Berlin (school timetable from Fuxam),
looking for Werkstudent / part-time / startup work. Write in English, plain and direct, second person ("You have…").
${DATA_RULE}
Rules:
- Only state facts present in the data. Every bullet lists the ids it is based on in "refs".
- Sections in this order, only when there is something to say: schedule (meetings/events), school (lessons), inbox (emails needing action), slack (who needs a reply), tasks, jobs (follow-ups), news (2-3 world headlines), ai (one line on AI news).
- Mention times. Point out conflicts, tight gaps and anything overdue.
- "focus": up to 3 short things that would make today a good day.`,
    prompt: asData('today', ctx)
  });
  const valid = new Set([...ctx.events, ...ctx.emails, ...ctx.slack, ...ctx.todos, ...ctx.jobs, ...ctx.news].map(x => x.id).concat(ctx.ai ? ['ai:today'] : []));
  const sections = out.sections.map(s => ({ ...s, bullets: s.bullets.filter(b => b.refs.length && b.refs.every(r => valid.has(r))) })).filter(s => s.bullets.length);
  db.run('INSERT OR REPLACE INTO briefings (date, created_at, model, headline, sections, focus) VALUES (?, ?, ?, ?, ?, ?)',
    date, Date.now(), MODELS.main, out.headline, j.str(sections), j.str(out.focus));
  return getBriefing(date);
}

export function getBriefing(date = localDate()) {
  const b = db.get('SELECT * FROM briefings WHERE date = ?', date);
  return b ? { date: b.date, createdAt: b.created_at, headline: b.headline, sections: j.parse(b.sections, []), focus: j.parse(b.focus, []) } : null;
}

export async function briefingJob() {
  const b = await generateBriefing();
  await notify({ title: 'Your morning briefing', body: b.headline, url: '#/home', tags: ['sunrise'] });
  return { headline: b.headline };
}
