// AI models tracker: vendor news (feeds + scraped pages), Artificial Analysis leaderboard, daily summary.
import { z } from 'zod';
import { db, j } from '../db.js';
import { config } from '../config.js';
import { fetchFeed, hashUrl } from '../lib/feeds.js';
import { structured, asData, DATA_RULE } from '../ai/claude.js';
import { localDate } from '../lib/time.js';

export async function pollAiFeeds() {
  const feeds = db.all("SELECT * FROM feeds WHERE kind = 'ai' AND enabled = 1");
  let added = 0;
  await Promise.all(feeds.map(async f => {
    for (const it of await fetchFeed(f)) {
      if (f.id === 'ai-github' && !/copilot|model/i.test(it.title)) continue;     // only Copilot / model news from GitHub
      if (it.publishedAt < Date.now() - 14 * 86400000) continue;
      added += db.run(`INSERT OR IGNORE INTO ai_updates (id, feed_id, vendor, title, url, published_at) VALUES (?, ?, ?, ?, ?, ?)`,
        hashUrl(it.url), f.id, f.vendor, it.title.slice(0, 300), it.url, it.publishedAt).changes;
    }
  }));
  return added;
}

const ClassSchema = z.object({ items: z.array(z.object({
  id: z.string(),
  vendor: z.string().describe('lowercase company: anthropic, openai, google, github, mistral, meta, deepseek, xai, huggingface, other'),
  kind: z.enum(['release', 'feature', 'pricing', 'research', 'other']),
  importance: z.number().int().min(1).max(10).describe('10 = new frontier model from a major lab; 7-8 = notable model/product launch; 1-3 = minor post'),
  summary: z.string().describe('One sentence, max 140 chars')
})) });

async function classify() {
  const pending = db.all('SELECT id, vendor, title FROM ai_updates WHERE classified = 0 ORDER BY published_at DESC LIMIT 60');
  if (!pending.length) return 0;
  const out = await structured({
    feature: 'ai-classify', tier: 'fast', schema: ClassSchema, maxTokens: 6000,
    system: `You triage AI industry news for a daily tracker. ${DATA_RULE}`,
    prompt: asData('ai-news', pending)
  });
  const ids = new Set(pending.map(p => p.id));
  db.tx(() => {
    for (const s of out.items) if (ids.has(s.id))
      db.run('UPDATE ai_updates SET vendor = ?, kind = ?, importance = ?, summary = ?, classified = 1 WHERE id = ?', s.vendor, s.kind, s.importance, s.summary, s.id);
    for (const p of pending) db.run('UPDATE ai_updates SET classified = 1 WHERE id = ? AND classified = 0', p.id);
  });
  return out.items.length;
}

/* Artificial Analysis free API (needs AA_API_KEY). Returns normalised rows or null. */
export async function fetchLeaderboard() {
  if (!config.aaKey) return null;
  try {
    const res = await fetch('https://artificialanalysis.ai/api/v2/data/llms/models', { headers: { 'x-api-key': config.aaKey }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = ((await res.json()).data || []).map(m => ({
      model: m.name, vendor: m.model_creator?.name || '',
      intelligence: m.evaluations?.artificial_analysis_intelligence_index ?? null,
      coding: m.evaluations?.artificial_analysis_coding_index ?? null,
      speed: m.median_output_tokens_per_second ?? null,
      price: m.pricing?.price_1m_blended_3_to_1 ?? null,
      open: !!(m.is_open_weights ?? m.open_weights)
    })).filter(r => r.model);
    return rows.length ? rows : null;
  } catch (e) { console.error('leaderboard', e.message); return null; }
}

function boards(rows) {
  const top = (list, key, n = 12) => list.filter(r => r[key] != null).sort((a, b) => b[key] - a[key]).slice(0, n)
    .map((r, i) => ({ rank: i + 1, model: r.model, vendor: r.vendor, score: Math.round(r[key] * 10) / 10 }));
  const fastCheap = rows.filter(r => r.intelligence != null && r.price != null && r.price > 0)
    .map(r => ({ ...r, value: r.intelligence / Math.max(0.05, r.price) }));
  return [
    ...top(rows, 'intelligence').map(r => ({ ...r, category: 'overall' })),
    ...top(rows, 'coding').map(r => ({ ...r, category: 'coding' })),
    ...top(fastCheap, 'value').map(r => ({ ...r, category: 'fast' })),
    ...top(rows.filter(r => r.open), 'intelligence').map(r => ({ ...r, category: 'open' }))
  ];
}

const Pick = z.object({ model: z.string(), vendor: z.string(), why: z.string().describe('max 60 chars') });
const DailySchema = z.object({
  summary_md: z.string().describe('What is new in AI today, markdown: 2-6 bullets, bold model names, include [source](url) links'),
  best: z.object({ overall: z.array(Pick).max(3), coding: z.array(Pick).max(3), fast: z.array(Pick).max(3), open: z.array(Pick).max(3) })
});

export async function aiDaily() {
  await pollAiFeeds();
  await classify();
  const date = localDate();
  const updates = db.all('SELECT vendor, title, url, kind, importance, summary, published_at FROM ai_updates WHERE published_at > ? ORDER BY importance DESC, published_at DESC LIMIT 30', Date.now() - 2 * 86400000);
  const rows = await fetchLeaderboard();
  const lb = rows ? { source: 'Artificial Analysis', updatedAt: Date.now(), rows: boards(rows) } : (j.parse(db.get('SELECT leaderboard FROM ai_daily ORDER BY date DESC LIMIT 1')?.leaderboard) || null);
  const out = await structured({
    feature: 'ai-daily', tier: 'main', schema: DailySchema, maxTokens: 6000, effort: 'low',
    system: `You write a short daily briefing on the AI model landscape for a developer. ${DATA_RULE}
Focus on what actually changed in the last 48 hours (new models, Copilot / Codex / Claude / Gemini features, pricing). If nothing notable happened, say so in one bullet.
"best" must only name models that appear in the leaderboard data; if there is no leaderboard, base it on the updates and keep "why" factual.`,
    prompt: asData('updates', updates) + '\n' + asData('leaderboard', lb ? lb.rows.slice(0, 48) : 'unavailable')
  });
  db.run('INSERT OR REPLACE INTO ai_daily (date, created_at, summary_md, best, leaderboard) VALUES (?, ?, ?, ?, ?)', date, Date.now(), out.summary_md, j.str(out.best), j.str(lb));
  return { date, updates: updates.length };
}

export function aiToday() {
  const d = db.get('SELECT * FROM ai_daily ORDER BY date DESC LIMIT 1');
  const updates = db.all('SELECT vendor, title, url, kind, importance, summary, published_at FROM ai_updates WHERE published_at > ? ORDER BY published_at DESC LIMIT 25', Date.now() - 7 * 86400000)
    .map(u => ({ ...u, publishedAt: u.published_at }));
  if (!d) return { date: null, updates };
  return { date: d.date, summaryMd: d.summary_md, best: j.parse(d.best, {}), leaderboard: j.parse(d.leaderboard), updates };
}
