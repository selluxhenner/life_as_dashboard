// News Flash: poll feeds, score new stories (Haiku), flag breaking news, write regional digests (Sonnet).
// Every story carries a topic (politics, economy, elections …) so the World page can slice by subject as well as region.
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { db, j } from '../db.js';
import { fetchFeed, hashUrl } from '../lib/feeds.js';
import { structured, asData, DATA_RULE } from '../ai/claude.js';
import { getSetting } from '../settings.js';
import { notify } from '../notify/index.js';

const COUNTRIES = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url), 'utf8'));
const COUNTRY_NAMES = Object.keys(COUNTRIES).sort();
const REGIONS = ['europe', 'africa', 'asia', 'mideast', 'namerica', 'samerica', 'oceania'];
export const TOPICS = ['politics', 'elections', 'economy', 'conflict', 'diplomacy', 'climate', 'tech', 'health', 'society', 'other'];
const DAY = 86400000;
// Sections that never make the world page; skipping them before scoring saves tokens.
const SKIP_URL = /\/(sport|sports|football|soccer|cricket|tennis|entertainment|culture|lifestyle|travel|style|food|recipes|fashion|celebrity|showbiz|tv-and-radio|music|film|books|games|horoscopes?)(\/|-|$)/i;

/* 1. Pull every news feed; keep items from the last 24 h that we haven't seen. */
export async function pollNews() {
  const feeds = db.all("SELECT * FROM feeds WHERE kind = 'news' AND enabled = 1");
  let added = 0;
  await Promise.all(feeds.map(async f => {
    for (const it of await fetchFeed(f)) {
      if (it.publishedAt < Date.now() - DAY || SKIP_URL.test(it.url)) continue;
      // Google News titles end with " - Outlet": use that as the source instead of the search feed's name.
      const g = f.url.includes('news.google.com') && it.title.match(/^(.*) - ([^-]{2,60})$/);
      const title = g ? g[1] : it.title, source = g ? g[2].trim() : f.name.replace(/ \(via Google News\)/, '');
      const r = db.run(`INSERT OR IGNORE INTO news_items (id, feed_id, source, url, title, summary, published_at, region, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        hashUrl(it.url), f.id, source, it.url, title.slice(0, 300), it.summary, it.publishedAt, f.region_hint, Date.now());
      added += r.changes;
    }
  }));
  return added;
}

const ScoreSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    region: z.enum(REGIONS),
    country: z.string().describe('Exact name from the country list, or empty string'),
    topic: z.enum(TOPICS),
    significance: z.number().int().min(1).max(10),
    cluster: z.string().describe('short kebab-case key shared by items about the same event, e.g. germany-oil-policy'),
    headline: z.string().describe('One precise, neutral English sentence, max 90 characters, no clickbait')
  }))
});

const SCORE_SYSTEM = `You classify world news for a personal news map. ${DATA_RULE}
For every item return: the world region it is about (not where the outlet is), the main country (exact name from the list below or ""),
significance 1-10 for a globally-minded reader in Berlin (10 = historic: war declared, head of state dies, global market crash;
8-9 = major policy shift or disaster with international impact; 5-7 = notable national news; 1-4 = minor, local, sport, celebrity, lifestyle),
a topic, a cluster key that is identical for items about the same event, and a precise one-line headline (max 90 chars, facts only).
Topics: politics (government, parties, legislation, leaders, coups), elections (votes, campaigns, polls, referendums, results),
economy (markets, central banks, inflation, trade, tariffs, big companies, jobs, energy prices), conflict (war, attacks, military, terrorism),
diplomacy (summits, treaties, sanctions, international relations), climate (climate, disasters, environment, energy transition),
tech (technology, AI, science, space), health (pandemics, health systems), society (protests, rights, migration, crime, justice), other (sport, culture, lifestyle).
Economics counts as much as politics: a Fed/ECB/BoJ rate decision, a market crash, a major trade deal or tariff is 7-9; a national election result is 7-9.
Regions: europe, africa, asia, mideast (incl. Turkey, Iran, Egypt, Gulf), namerica (incl. Central America, Caribbean), samerica, oceania.
Country list: ${COUNTRY_NAMES.join(', ')}`;

/* 2. Score unscored items in batches (only new items cost tokens). */
export async function scoreNews() {
  const pending = db.all('SELECT id, title, summary, source, region FROM news_items WHERE scored = 0 ORDER BY published_at DESC LIMIT 160');
  let scored = 0;
  for (let i = 0; i < pending.length; i += 40) {
    const batch = pending.slice(i, i + 40);
    const out = await structured({
      feature: 'news-score', tier: 'fast', system: SCORE_SYSTEM, maxTokens: 7000, schema: ScoreSchema,
      prompt: asData('news', batch.map(b => ({ id: b.id, source: b.source, hint: b.region, title: b.title, summary: (b.summary || '').slice(0, 220) })))
    });
    const ids = new Set(batch.map(b => b.id));
    db.tx(() => {
      for (const s of out.items) {
        if (!ids.has(s.id)) continue;                       // ignore anything the model invented
        const c = COUNTRIES[s.country];
        db.run(`UPDATE news_items SET region = ?, country = ?, country_n3 = ?, topic = ?, significance = ?, cluster = ?, headline = ?, scored = 1 WHERE id = ?`,
          s.region, c ? s.country : null, c ? c.n3 : null, s.topic, s.significance, s.cluster.slice(0, 60), s.headline.slice(0, 120), s.id);
        scored++;
      }
      // anything the model skipped is marked so it isn't retried forever
      for (const b of batch) db.run('UPDATE news_items SET scored = 1 WHERE id = ? AND scored = 0', b.id);
    });
  }
  return scored;
}

/* 3. Breaking: very significant AND reported by at least two outlets within 3 hours. Push once per cluster. */
export async function detectBreaking() {
  const threshold = getSetting('news').breakingThreshold;
  const rows = db.all(`SELECT cluster, MAX(significance) sig, COUNT(DISTINCT feed_id) n, MAX(headline) headline, MIN(id) any_id
                       FROM news_items WHERE published_at > ? AND significance >= ? AND cluster IS NOT NULL GROUP BY cluster`,
    Date.now() - 3 * 3600000, threshold);
  const fresh = [];
  for (const r of rows) {
    if (r.n < 2) continue;
    const already = db.get('SELECT 1 FROM news_items WHERE cluster = ? AND breaking = 1', r.cluster);
    db.run('UPDATE news_items SET breaking = 1 WHERE cluster = ?', r.cluster);
    if (!already) fresh.push(r);
  }
  for (const r of fresh) await notify({ title: 'Breaking', body: r.headline, tags: ['rotating_light'], url: '#/news', priority: 4 });
  return fresh.length;
}

export async function newsTick() {
  const added = await pollNews();
  const scored = added ? await scoreNews() : 0;
  const breaking = scored ? await detectBreaking() : 0;
  return { added, scored, breaking };
}

const DigestSchema = z.object({
  top: z.array(z.object({
    headline: z.string().describe('The event in one precise sentence, max 100 characters'),
    brief: z.string().describe('2-3 sentences: what exactly happened, the key names and numbers, and why it matters for the world. Max 380 characters'),
    item_ids: z.array(z.string()).min(1)
  })).max(6).describe('The 4-6 most consequential events worldwide right now, most important first'),
  regions: z.object(Object.fromEntries(REGIONS.map(r => [r, z.array(z.object({
    headline: z.string().describe('One precise sentence, max 100 characters'),
    item_ids: z.array(z.string()).min(1)
  })).max(6)]))),
  elections: z.array(z.object({
    country: z.string().describe('Exact country name from the stories'),
    kind: z.string().describe('e.g. "Presidential election", "Parliamentary election", "Referendum"'),
    status: z.enum(['upcoming', 'campaign', 'voting', 'results', 'aftermath']),
    when: z.string().describe('Election date as written in the stories (e.g. "12 October"), or empty string if the stories give none'),
    headline: z.string().describe('The current state in one sentence, max 110 characters: who leads, who won, what is at stake'),
    item_ids: z.array(z.string()).min(1)
  })).max(8).describe('National elections and referendums covered in the stories. Skip local races and primaries unless globally significant')
});

/* 4. Digest 3x a day: big-picture briefs, 3-6 clean one-liners per region, an election tracker — all grounded in stored item ids. */
export async function buildDigest(slot) {
  await newsTick().catch(e => console.error('news tick before digest', e.message));
  const since = Date.now() - 14 * 3600000;
  const perRegion = {};
  for (const r of REGIONS) {
    perRegion[r] = db.all(`SELECT id, title, headline, source, topic, significance, cluster FROM news_items
                           WHERE region = ? AND published_at > ? AND scored = 1 AND significance >= 4 AND COALESCE(topic, '') != 'other'
                           ORDER BY significance DESC, published_at DESC LIMIT 30`, r, since);
  }
  const total = Object.values(perRegion).reduce((n, l) => n + l.length, 0);
  if (!total) return { skipped: 'no stories' };
  const out = await structured({
    feature: 'news-digest', tier: 'main', maxTokens: 10000, schema: DigestSchema, effort: 'low',
    system: `You write the world news digest for Kevin, a student in Berlin who wants the big picture: politics, economics, elections, wars and diplomacy. ${DATA_RULE}
1. top: the 4-6 most consequential events worldwide (any region), ranked. Headline plus a short brief with concrete facts (names, numbers, dates) and why it matters.
2. regions: for each region the 3-6 most important distinct events (fewer if quiet). One sentence each: what happened, where, and why it matters, max 100 characters. Cover economy and politics, not only conflict.
3. elections: national elections and referendums in the stories, with their status and date if the stories give one.
Clean, precise, neutral — like a wire service. Merge items about the same event and list all their ids. Never invent facts, dates or numbers that are not in the items.`,
    prompt: asData('stories', perRegion)
  });
  const byId = Object.fromEntries(db.all('SELECT * FROM news_items WHERE published_at > ?', since).map(r => [r.id, r]));
  /* Ground a model line in stored items; lines without real ids are dropped. */
  const ground = (s, extra = {}) => {
    const items = s.item_ids.map(id => byId[id]).filter(Boolean);
    if (!items.length) return null;
    const lead = [...items].sort((a, b) => (b.significance || 0) - (a.significance || 0))[0];
    return {
      headline: s.headline.slice(0, 140), url: lead.url, source: lead.source, sources: [...new Set(items.map(i => i.source))],
      region: lead.region, country: lead.country, country_n3: lead.country_n3, topic: lead.topic || 'other',
      significance: lead.significance, breaking: !!lead.breaking, publishedAt: Math.max(...items.map(i => i.published_at)), ...extra
    };
  };
  const regions = {};
  for (const r of REGIONS) regions[r] = (out.regions[r] || []).map(s => ground(s)).filter(Boolean).map(s => ({ ...s, region: r }));
  const top = out.top.map(s => ground(s, { brief: s.brief.slice(0, 420) })).filter(Boolean);
  const elections = out.elections.map(e => {
    const c = COUNTRIES[e.country];
    return ground(e, {
      kind: e.kind.slice(0, 40), status: e.status, when: e.when.slice(0, 40), topic: 'elections',
      ...(c ? { country: e.country, country_n3: c.n3 } : {})
    });
  }).filter(Boolean);
  db.run('INSERT OR REPLACE INTO news_digests (slot, created_at, regions, top, elections) VALUES (?, ?, ?, ?, ?)',
    slot, Date.now(), j.str(regions), j.str(top), j.str(elections));
  return { slot, top: top.length, elections: elections.length, stories: Object.values(regions).reduce((n, l) => n + l.length, 0) };
}

/* Live wire: the newest significant events (between digests), one row per cluster with every outlet that carried it. */
export function newsWire({ hours = 18, min = 6, limit = 40 } = {}) {
  const rows = db.all(`SELECT id, cluster, headline, title, url, source, region, country, country_n3, topic, significance, breaking, published_at
                       FROM news_items WHERE scored = 1 AND published_at > ? AND significance >= ? AND COALESCE(topic, '') != 'other'
                       ORDER BY published_at DESC`, Date.now() - hours * 3600000, min);
  const byCluster = new Map();
  for (const r of rows) {
    const k = r.cluster || r.id;
    const c = byCluster.get(k);
    if (!c) { byCluster.set(k, { ...r, sources: new Set([r.source]) }); continue; }
    c.sources.add(r.source);
    c.breaking = c.breaking || r.breaking;
    if ((r.significance || 0) > (c.significance || 0)) Object.assign(c, { headline: r.headline, url: r.url, source: r.source, significance: r.significance });
  }
  return [...byCluster.values()].slice(0, limit).map(c => ({
    headline: c.headline || c.title, url: c.url, source: c.source, sources: [...c.sources], region: c.region, country: c.country,
    country_n3: c.country_n3, topic: c.topic || 'other', significance: c.significance, breaking: !!c.breaking, publishedAt: c.published_at
  }));
}

export function latestDigest() {
  const d = db.get('SELECT * FROM news_digests ORDER BY created_at DESC LIMIT 1');
  const breaking = db.all(`SELECT headline, url, source, region, country, country_n3, topic, significance, published_at FROM news_items
                           WHERE breaking = 1 AND published_at > ? GROUP BY cluster ORDER BY published_at DESC LIMIT 5`, Date.now() - 12 * 3600000)
    .map(b => ({ ...b, breaking: true, publishedAt: b.published_at }));
  return {
    digest: d ? { slot: d.slot, createdAt: d.created_at, regions: j.parse(d.regions, {}), top: j.parse(d.top, []), elections: j.parse(d.elections, []) } : null,
    breaking, wire: newsWire()
  };
}
