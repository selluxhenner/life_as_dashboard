// Background assistant jobs: meeting prep, job-hunt nudges, optional Berlin job suggestions.
import { z } from 'zod';
import { db } from '../db.js';
import { runAgent } from '../agent/runner.js';
import { listJobs, saveJob } from '../routes/jobs.js';
import { notify } from '../notify/index.js';
import { getSetting } from '../settings.js';
import { structured, asData, DATA_RULE } from '../ai/claude.js';
import { localDate } from '../lib/time.js';
import { config } from '../config.js';

const prepped = new Set();

/* Events starting in 25–45 minutes get a prep note (read + internal tools only, nothing leaves the system). */
export async function meetingPrep() {
  const now = Date.now();
  const soon = db.all(`SELECT id, title, start, location, calendar FROM calendar_events WHERE all_day = 0 AND kind IN ('meeting','event') AND start BETWEEN ? AND ?`,
    new Date(now + 25 * 60000).toISOString(), new Date(now + 45 * 60000).toISOString());
  let n = 0;
  for (const ev of soon) {
    if (prepped.has(ev.id)) continue;
    prepped.add(ev.id);
    const at = new Date(ev.start).toLocaleTimeString('en-GB', { timeZone: config.tz, hour: '2-digit', minute: '2-digit' });
    const r = await runAgent({
      trigger: 'meeting-prep', allowed: ['read', 'internal'],
      message: `"${ev.title}" starts at ${at}${ev.location ? ' (' + ev.location + ')' : ''}. Look for related emails, Slack messages, todos and job entries. If you find something useful, save a short prep note with add_note (title: "Prep: ${ev.title}"). Then answer in at most two sentences what Kevin should know.`
    });
    await notify({ title: `${at} · ${ev.title}`, body: r.text.slice(0, 280) || 'Starts in about 30 minutes.', url: '#/calendar' });
    n++;
  }
  return n;
}

/* 10:00 — follow-ups that are due, plus applications without an answer for 10+ days. */
export async function jobNudge() {
  const today = localDate();
  const jobs = listJobs();
  const due = jobs.filter(j => j.status !== 'rejected' && j.status !== 'offer' && j.nextActionDate && j.nextActionDate <= today);
  const stale = jobs.filter(j => j.status === 'applied' && j.appliedAt && j.appliedAt <= new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10) && !j.nextActionDate);
  const lines = [...due.map(j => `${j.nextAction || 'Follow up'} · ${j.company}`), ...stale.map(j => `No reply for 10+ days · ${j.company}`)];
  if (lines.length) await notify({ title: `Job hunt: ${lines.length} thing${lines.length > 1 ? 's' : ''} to do`, body: lines.slice(0, 4).join('\n'), url: '#/jobs' });
  if (getSetting('flags').jobsAi) await suggestJobs().catch(e => console.error('job suggestions', e.message));
  return lines.length;
}

const SuggestSchema = z.object({ picks: z.array(z.object({ slug: z.string(), fit: z.number().int().min(1).max(10), reason: z.string().describe('max 100 chars') })).max(5) });

/* Arbeitnow public board (Germany). Keeps up to 3 good Berlin matches per day as "saved" roles. */
export async function suggestJobs() {
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api', { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('Arbeitnow HTTP ' + res.status);
  const known = new Set(listJobs({ includeArchived: true }).map(j => j.link));
  const candidates = ((await res.json()).data || [])
    .filter(x => /berlin/i.test(x.location || '') && !known.has(x.url))
    .filter(x => /werkstudent|working student|student|part[- ]time|teilzeit|minijob|intern/i.test(x.title + ' ' + (x.job_types || []).join(' ')))
    .slice(0, 30);
  if (!candidates.length) return 0;
  const out = await structured({
    feature: 'job-suggest', tier: 'fast', schema: SuggestSchema, maxTokens: 2000,
    system: `Pick roles that fit this profile: ${getSetting('jobs').profile} ${DATA_RULE}`,
    prompt: asData('jobs', candidates.map(x => ({ slug: x.slug, title: x.title, company: x.company_name, tags: x.tags, types: x.job_types, remote: x.remote })))
  });
  let added = 0;
  for (const p of out.picks.filter(p => p.fit >= 7).slice(0, 3)) {
    const x = candidates.find(c => c.slug === p.slug);
    if (!x) continue;
    const type = /werkstudent|working student/i.test(x.title) ? 'werkstudent' : /part|teilzeit/i.test(x.title) ? 'part-time' : 'other';
    saveJob({ company: x.company_name, role: x.title, type, link: x.url, location: 'Berlin', status: 'saved', source: 'suggested', notes: 'Suggested: ' + p.reason });
    added++;
  }
  if (added) await notify({ title: `${added} new Berlin role${added > 1 ? 's' : ''} suggested`, body: 'Have a look in Jobs → Saved.', url: '#/jobs' });
  return added;
}
