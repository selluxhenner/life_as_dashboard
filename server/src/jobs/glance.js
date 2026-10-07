// "Glance": the small summary the phone shows outside the app — the morning notification, the home-screen widgets
// and the Quick Settings tile. Short strings only; the app itself has everything else.
import { db, j } from '../db.js';
import { getSetting } from '../settings.js';
import { localDate, zonedInstant, addDays } from '../lib/time.js';
import { getBriefing } from './briefing.js';
import { latestDigest } from './news.js';
import { aiToday } from './aimodels.js';

const VENDOR_NAME = { openai: 'OpenAI', github: 'GitHub', xai: 'xAI', deepseek: 'DeepSeek', huggingface: 'Hugging Face' };
const vendorName = v => VENDOR_NAME[v] || String(v || '').replace(/^./, c => c.toUpperCase());
const HHMM = /^\d{2}:\d{2}$/;

/**
 * Fuxam lesson titles carry a tag, a programme prefix, a track and course codes. On a widget only the subject counts:
 *   "[LU] OS: Explore – Introduction to Software Engineering (OS_01) - Practice Session (Group 2)"
 *   → { tag: 'LU', title: 'Introduction to Software Engineering', detail: 'Practice Session · Group 2' }
 */
export function lessonTitle(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  let tag = '';
  const t = s.match(/^\[([^\]]{1,24})\]\s*/);
  if (t) { tag = t[1].trim(); s = s.slice(t[0].length); }
  s = s.replace(/^[A-Z]{1,6}:\s*/, '')                 // programme prefix "OS: "
    .replace(/\s*\([A-Z]{2,}_\w+\)/g, '');             // course codes "(OS_01)"
  const track = s.split(/\s+[–—]\s+/);                 // "Explore – Workshops": the track name goes
  if (track.length > 1) s = track.slice(1).join(' – ');
  const parts = s.split(/\s+-\s+/);
  let title = parts[0];
  const extra = parts.slice(1);
  const paren = title.match(/^(.+?)\s*\(([^)]+)\)$/);   // "Workshops (Track 1)"
  if (paren) { title = paren[1]; extra.unshift(paren[2]); }
  const detail = extra.map(x => x.replace(/\s*\(([^)]+)\)/g, ' · $1').trim()).filter(Boolean).join(' · ');
  return { tag, title: title.trim() || String(raw || '').trim(), detail };
}

/* The room as it should stand on the widget: "Ris", "Jungle"; video calls become "Online". */
export function roomOf(location, link) {
  const s = String(location || '').trim();
  if (!s) return link ? 'Online' : '';
  if (/^https?:|meet\.google|zoom\.us|teams\.(microsoft|live)/i.test(s)) return 'Online';
  return s.replace(/^(raum|room|rm\.?)\s+/i, '').split(/[,(;]/)[0].trim().slice(0, 14);
}

/**
 * One day for the day-plan widget: lessons (with their room), meetings and events from the calendars, and the plan
 * blocks Kevin put on the day (same end rule as the app: until the next block if that is within 3 hours, else 1 hour).
 * Times are epoch ms; untimed plan blocks and done blocks are left out.
 */
export function dayPlan(date) {
  const from = zonedInstant(date, '00:00').toISOString(), to = zonedInstant(addDays(date, 1), '00:00').toISOString();
  const items = db.all(`SELECT kind, title, start, end, all_day, location, link FROM calendar_events
                        WHERE (all_day = 0 AND start < ? AND end > ?) OR (all_day = 1 AND start <= ? AND end > ?) ORDER BY start`,
    to, from, date, date)
    .map(e => ({
      kind: e.kind, ...(e.kind === 'lesson' ? lessonTitle(e.title) : { tag: '', title: e.title, detail: '' }),
      allDay: !!e.all_day, start: e.all_day ? null : Date.parse(e.start), end: e.all_day ? null : Date.parse(e.end), room: roomOf(e.location, e.link)
    }));
  const doc = db.get('SELECT value FROM docs WHERE user_id = 1 AND key = ? AND deleted = 0', 'dayplan:' + date);
  const blocks = (j.parse(doc && doc.value, []) || []).filter(b => b && b.label && HHMM.test(b.time || '')).sort((a, b) => a.time.localeCompare(b.time));
  blocks.forEach((b, i) => {
    if (b.done) return;
    const start = zonedInstant(date, b.time).getTime();
    const next = blocks.slice(i + 1).find(n => n.time > b.time);
    const end = HHMM.test(b.end || '') && b.end > b.time ? zonedInstant(date, b.end).getTime()
      : next && zonedInstant(date, next.time).getTime() - start <= 3 * 3600000 ? zonedInstant(date, next.time).getTime() : start + 3600000;
    items.push({ kind: 'plan', tag: '', title: String(b.label).slice(0, 80), detail: '', allDay: false, start, end, room: '' });
  });
  return items.sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
}

export function glance(now = new Date()) {
  const date = localDate(now);
  const b = getBriefing(date);
  const { digest, breaking } = latestDigest();
  const ai = aiToday();
  const sp = b && b.spoken;
  return {
    // morning: whether the phone shows the briefing (or a reminder) at briefingTime — Settings › Notifications
    date, at: now.getTime(), briefingTime: getSetting('briefing').time, morning: getSetting('alerts').briefing !== false,
    briefing: b ? {
      date: b.date, createdAt: b.createdAt, headline: b.headline, overview: (sp && sp.overview) || '',
      points: ((sp && sp.topics) || []).slice(0, 4).map(t => ({ label: t.label, say: t.say })), focus: (b.focus || []).slice(0, 3)
    } : null,
    world: {
      createdAt: digest ? digest.createdAt : null,
      top: ((digest && digest.top) || []).slice(0, 4).map(s => ({ headline: s.headline, country: s.country || '', region: s.region || '' })),
      breaking: breaking.slice(0, 2).map(x => ({ headline: x.headline, country: x.country || '', at: x.publishedAt }))
    },
    ai: { date: ai.date, top: (ai.highlights || []).slice(0, 3).map(h => ({ title: h.title, vendor: vendorName(h.vendor) })) },
    // the day-plan widget: today, and tomorrow for the evening
    day: { today: { date, items: dayPlan(date) }, tomorrow: { date: addDays(date, 1), items: dayPlan(addDays(date, 1)) } }
  };
}
