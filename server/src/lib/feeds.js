// RSS / Atom / RDF fetching with conditional requests, plus a tiny HTML link scraper for sites without feeds.
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { db } from '../db.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });
const UA = 'Mozilla/5.0 (compatible; AgenticOS/2.0; personal news reader)';
export const hashUrl = u => createHash('sha256').update(u).digest('hex').slice(0, 24);

const textOf = v => (v == null ? '' : typeof v === 'object' ? (v['#text'] ?? '') : String(v));
const strip = s => textOf(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const arr = v => (Array.isArray(v) ? v : v ? [v] : []);

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  if (doc.rss) {
    return arr(doc.rss.channel?.item).map(i => ({
      title: strip(i.title), url: textOf(i.link).trim() || textOf(i.guid),
      summary: strip(i.description).slice(0, 600), publishedAt: Date.parse(textOf(i.pubDate) || textOf(i['dc:date'])) || Date.now()
    }));
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map(e => {
      const links = arr(e.link);
      const href = (links.find(l => l['@rel'] === 'alternate') || links[0] || {})['@href'] || '';
      return { title: strip(e.title), url: href, summary: strip(e.summary || e.content).slice(0, 600), publishedAt: Date.parse(textOf(e.published) || textOf(e.updated)) || Date.now() };
    });
  }
  if (doc['rdf:RDF']) {
    return arr(doc['rdf:RDF'].item).map(i => ({ title: strip(i.title), url: textOf(i.link), summary: strip(i.description).slice(0, 600), publishedAt: Date.parse(textOf(i['dc:date'])) || Date.now() }));
  }
  return [];
}

/* Fetch one feed row; returns new items only (or [] on 304). Updates etag bookkeeping. */
export async function fetchFeed(feed) {
  const headers = { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html' };
  if (feed.etag) headers['If-None-Match'] = feed.etag;
  if (feed.last_modified) headers['If-Modified-Since'] = feed.last_modified;
  try {
    const res = await fetch(feed.url, { headers, signal: AbortSignal.timeout(20000) });
    if (res.status === 304) { db.run('UPDATE feeds SET last_fetch_at = ?, last_error = NULL WHERE id = ?', Date.now(), feed.id); return []; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.text();
    const items = feed.url.includes('#html') || /<html/i.test(body.slice(0, 500)) ? scrapeLinks(body, feed.url) : parseFeed(body);
    db.run('UPDATE feeds SET etag = ?, last_modified = ?, last_fetch_at = ?, last_error = NULL WHERE id = ?',
      res.headers.get('etag'), res.headers.get('last-modified'), Date.now(), feed.id);
    return items.filter(i => i.title && /^https?:/.test(i.url));
  } catch (e) {
    db.run('UPDATE feeds SET last_fetch_at = ?, last_error = ? WHERE id = ?', Date.now(), e.message, feed.id);
    return [];
  }
}

/* For news pages without RSS (e.g. anthropic.com/news): article links with their visible text. */
export function scrapeLinks(html, pageUrl) {
  const base = new URL(pageUrl.replace('#html', ''));
  const prefix = base.pathname.replace(/\/$/, '') + '/';
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let href; try { href = new URL(m[1], base).href; } catch { continue; }
    const path = new URL(href).pathname;
    if (!path.startsWith(prefix) || path.length <= prefix.length + 3) continue;
    let title = strip(m[2]).replace(/\b(Announcements?|Product|Policy|Research|News|Science)\b\s*/g, '').trim();
    // listing cards often start or end with the date: "Oct 2, 2026 Title" / "Title Oct 2, 2026"
    const DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/;
    const dm = title.match(DATE);
    const publishedAt = dm ? Date.parse(dm[0]) || Date.now() : Date.now();
    if (dm) title = title.replace(dm[0], '').trim();
    if (title.length < 12 || out.has(href)) continue;
    out.set(href, { title: title.slice(0, 200), url: href, summary: '', publishedAt });
  }
  return [...out.values()].slice(0, 20);
}

export const DEFAULT_FEEDS = [
  // news — region hints help the classifier
  ['bbc-world', 'news', 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', null],
  ['bbc-europe', 'news', 'BBC Europe', 'https://feeds.bbci.co.uk/news/world/europe/rss.xml', 'europe'],
  ['bbc-africa', 'news', 'BBC Africa', 'https://feeds.bbci.co.uk/news/world/africa/rss.xml', 'africa'],
  ['bbc-asia', 'news', 'BBC Asia', 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', 'asia'],
  ['bbc-mideast', 'news', 'BBC Middle East', 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', 'mideast'],
  ['bbc-us', 'news', 'BBC US & Canada', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', 'namerica'],
  ['bbc-latam', 'news', 'BBC Latin America', 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml', 'samerica'],
  ['bbc-aus', 'news', 'BBC Australia', 'https://feeds.bbci.co.uk/news/world/australia/rss.xml', 'oceania'],
  ['aljazeera', 'news', 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', null],
  ['dw', 'news', 'DW', 'https://rss.dw.com/rdf/rss-en-all', 'europe'],
  ['guardian', 'news', 'The Guardian', 'https://www.theguardian.com/world/rss', null],
  ['france24', 'news', 'France 24', 'https://www.france24.com/en/rss', null],
  ['npr', 'news', 'NPR World', 'https://feeds.npr.org/1004/rss.xml', null],
  ['africanews', 'news', 'Africanews', 'https://www.africanews.com/feed/rss', 'africa'],
  ['mercopress', 'news', 'MercoPress', 'https://en.mercopress.com/rss/', 'samerica'],
  ['rnz', 'news', 'RNZ World', 'https://www.rnz.co.nz/rss/world.xml', 'oceania'],
  ['reuters', 'news', 'Reuters (via Google News)', 'https://news.google.com/rss/search?q=when:12h+source:Reuters&hl=en-US&gl=US&ceid=US:en', null],
  ['ap', 'news', 'AP (via Google News)', 'https://news.google.com/rss/search?q=when:12h+source:Associated+Press&hl=en-US&gl=US&ceid=US:en', null],
  // AI vendors
  ['ai-openai', 'ai', 'OpenAI', 'https://openai.com/news/rss.xml', 'openai'],
  ['ai-anthropic', 'ai', 'Anthropic', 'https://www.anthropic.com/news#html', 'anthropic'],
  ['ai-deepmind', 'ai', 'Google DeepMind', 'https://deepmind.google/blog/rss.xml', 'google'],
  ['ai-google', 'ai', 'Google AI', 'https://blog.google/technology/ai/rss/', 'google'],
  ['ai-github', 'ai', 'GitHub Changelog', 'https://github.blog/changelog/feed/', 'github'],
  ['ai-mistral', 'ai', 'Mistral', 'https://mistral.ai/news#html', 'mistral'],
  ['ai-hf', 'ai', 'Hugging Face', 'https://huggingface.co/blog/feed.xml', 'huggingface'],
  ['ai-simon', 'ai', 'Simon Willison', 'https://simonwillison.net/atom/everything/', 'community']
];

export function seedFeeds() {
  for (const [id, kind, name, url, hint] of DEFAULT_FEEDS) {
    db.run(`INSERT OR IGNORE INTO feeds (id, kind, name, url, region_hint, vendor) VALUES (?, ?, ?, ?, ?, ?)`,
      id, kind, name, url, kind === 'news' ? hint : null, kind === 'ai' ? hint : null);
  }
}
