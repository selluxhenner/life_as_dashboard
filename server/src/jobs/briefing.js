// Morning briefing: everything for today in one grounded summary, written a few minutes before the briefing time,
// plus a spoken version: a 30-second summary Kevin hears, not the card read aloud.
import { z } from 'zod';
import { db, j } from '../db.js';
import { structured, asData, DATA_RULE, MODELS } from '../ai/claude.js';
import { localDate, localTime, zonedInstant, addDays } from '../lib/time.js';
import { listOpenTodos } from '../routes/todos.js';
import { listJobs } from '../routes/jobs.js';
import { latestDigest } from './news.js';
import { aiToday } from './aimodels.js';
import { triageInbox } from './triage.js';
import { refreshCalendar, refreshInbox } from './refresh.js';
import { notify } from '../notify/index.js';
import { config } from '../config.js';
import { getSetting } from '../settings.js';
import { todayWeather } from '../lib/weather.js';
import { marketPulse } from './markets.js';
import { shapeSpoken, spokenText, spokenScript, MAX_WORDS, TONE_IDS, TONE_RULE } from '../voice/script.js';
import { synthesize, ttsEngine } from '../voice/speech.js';

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

const SpokenSchema = z.object({
  greeting: z.string().describe('A few words, e.g. "Morning, Kevin!"'),
  overview: z.string().describe('One sentence, max 14 words, that sums up the whole day: its shape and load'),
  overviewTone: z.string().describe(TONE_IDS.join(' | ')),
  topics: z.array(z.object({
    label: z.string().describe('One to three words for the screen, e.g. "First up", "Reply to Anna", "Rain"'),
    say: z.string().describe('One or two short spoken sentences, max 25 words: what it is and what to do about it'),
    tone: z.string().describe(TONE_IDS.join(' | ')),
    refs: z.array(z.string())
  })).max(4),
  outro: z.string().describe('One short sentence, max 10 words, on what was left out')
});

const SPOKEN_SYSTEM = `You write the spoken morning briefing of Agentic OS: 30 seconds, spoken fast, after which Kevin knows everything that matters today.
Kevin is a student in Berlin (school timetable from Fuxam) looking for Werkstudent / part-time / startup work.
${DATA_RULE}
This is a summary, not a read-out. The card is already on his screen and he will not sit through it being read. Say what a sharp friend
who has read everything would tell him in half a minute while he gets ready:
- greeting: a few words ("Morning, Kevin!").
- overview: one sentence that sums up the whole day, its shape and load: "Packed morning, then you're free from two."
  "Easy one today: a single lesson and two things to finish." This line alone should tell him what kind of day it is.
- topics: at most four, most important first, ranked by how much each one changes his day. One or two short sentences each:
  what it is and what to do about it. Merge and count instead of listing: "Seven new emails; only Anna's needs a reply."
  "Three tasks are overdue, and the CV fix is the one that matters." Connect things: "Your lesson ends at twelve, so you've
  got an hour to prep for the one o'clock call." Cover fixed commitments and what to prepare, clashes or tight gaps, the one
  message that really needs an answer, deadlines and overdue tasks, a job follow-up that is due.
  Add what the card does not show when it matters: rain while he's out, unusual heat or cold, one world event that truly
  matters ("world" or "breaking"), a big market move. Skip the weather on an ordinary day.
- ${TONE_RULE}
- outro: one short sentence that says what you left out, so he knows nothing important was skipped: "Everything else can wait."
  "The rest is on your card, nothing urgent." Only say "nothing urgent" when that is true.
Everything together stays under ${MAX_WORDS - 5} words. Lively, natural spoken English with contractions and varied rhythm: short
punchy sentences next to longer ones, like someone talking, not reading. No lists, symbols, ids, links, emoji, abbreviations or
[bracketed] directions. Times as people say them ("at 9:30", "at two"). Only state facts present in the data. A quiet day gets
fewer topics and a happy overview, not filler.
refs: the ids each topic is based on ("weather", "world:0", "breaking:0", "market:…" or ids from "today").`;

/* What the spoken briefing may use beyond the card: weather, the world's top stories, breaking news, big market moves. */
async function extras() {
  const weather = await todayWeather();
  const d = latestDigest();
  const world = (d.digest?.top || []).slice(0, 5).map((s, i) => ({ id: 'world:' + i, headline: s.headline, brief: s.brief, country: s.country }));
  const breaking = (d.breaking || []).slice(0, 3).map((b, i) => ({ id: 'breaking:' + i, headline: b.headline, country: b.country }));
  const quotes = await marketPulse().then(m => m.quotes).catch(() => []);
  const markets = quotes.filter(q => Math.abs(q.change || 0) >= 1.5)
    .map(q => ({ id: 'market:' + q.sym, label: q.label, changePercent: Math.round(q.change * 10) / 10 }));
  return { weather, world, breaking, markets };
}

async function writeSpoken(date, ctx, card) {
  const more = await extras();
  const valid = new Set([...ctx.events, ...ctx.emails, ...ctx.slack, ...ctx.todos, ...ctx.jobs, ...ctx.news, ...more.world, ...more.breaking, ...more.markets]
    .map(x => x.id).concat(ctx.ai ? ['ai:today'] : [], more.weather ? ['weather'] : []));
  const out = await structured({
    feature: 'briefing-voice', tier: 'main', schema: SpokenSchema, maxTokens: 3000, effort: 'low',
    system: SPOKEN_SYSTEM,
    prompt: `It is ${localTime()} on ${ctx.weekday}.\n` + asData('today', { ...ctx, ...more })
      + '\n' + asData('card_on_screen', { headline: card.headline, sections: card.sections.map(s => ({ title: s.title, bullets: s.bullets.map(b => b.text) })) })
  });
  const spoken = shapeSpoken(out, r => valid.has(r));
  db.run('UPDATE briefings SET spoken = ? WHERE date = ?', j.str(spoken), date);
  // When it will be read out on its own, render the audio now so it starts instantly (cached on disk).
  if (getSetting('voice').autoRead && ttsEngine()) await synthesize({ text: spokenScript(spoken), lang: 'en' }).catch(e => console.error('briefing: voice', e.message));
  return spoken;
}

/** Adds the spoken version to a briefing written before it existed (or rewrites it with force). */
export async function ensureSpoken(date = localDate(), { force = false } = {}) {
  const b = getBriefing(date);
  if (!b) return null;
  if (b.spoken && !force) return b;
  await writeSpoken(date, gatherContext(date), b);
  return getBriefing(date);
}

/** The plain text of today's spoken briefing (null when there is none). */
export function briefingSpeech(date = localDate()) {
  const b = getBriefing(date);
  return b && b.spoken ? spokenText(b.spoken) : null;
}

/** The same with delivery directions: what the voice engine is given (and the audio cache key). */
export function briefingScript(date = localDate()) {
  const b = getBriefing(date);
  return b && b.spoken ? spokenScript(b.spoken) : null;
}

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
  await writeSpoken(date, ctx, { headline: out.headline, sections }).catch(e => console.error('briefing: spoken', e.message));
  return getBriefing(date);
}

export function getBriefing(date = localDate()) {
  const b = db.get('SELECT * FROM briefings WHERE date = ?', date);
  return b ? { date: b.date, createdAt: b.created_at, headline: b.headline, sections: withEnds(j.parse(b.sections, [])), focus: j.parse(b.focus, []), spoken: j.parse(b.spoken, null) } : null;
}

/* So the card can cross lines off: every bullet about calendar events gets `until`, the end of the last of them
   (all-day events end at midnight). Tasks are checked on the device by id, where "done" is instant. */
function withEnds(sections) {
  const ids = [...new Set(sections.flatMap(s => s.bullets.flatMap(x => (x.refs || []).filter(r => r.startsWith('ev:')).map(r => r.slice(3)))))];
  if (!ids.length) return sections;
  const ends = Object.fromEntries(db.all(`SELECT id, end, all_day FROM calendar_events WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
    .map(e => [e.id, e.all_day ? zonedInstant(e.end, '00:00').toISOString() : new Date(e.end).toISOString()]));
  return sections.map(s => ({
    ...s,
    bullets: s.bullets.map(x => {
      const evs = (x.refs || []).filter(r => r.startsWith('ev:')).map(r => ends[r.slice(3)]);
      return evs.length && evs.every(Boolean) ? { ...x, until: evs.sort().at(-1) } : x;
    })
  }));
}

export async function briefingJob() {
  const b = await generateBriefing();
  await notify({ title: 'Your morning briefing', body: b.headline, url: '#/home', tags: ['sunrise'], kind: 'briefing', ref: 'briefing:' + b.date });
  return { headline: b.headline };
}
