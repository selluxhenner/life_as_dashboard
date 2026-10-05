import { h } from '../core/dom.js';
import { panel } from '../components/panel.js';
import { viewHead, empty, chip, btn } from '../components/ui.js';
import { worldMap, regionLegend } from '../components/world-map.js';
import { REGIONS } from '../data/regions.js';
import { remote, refresh } from '../core/remote.js';
import { fmt } from '../core/dates.js';
import { notify } from '../core/store.js';
import COUNTRIES from '../assets/country-centroids.json';
import { go } from '../core/router.js';
import { speak, stopSpeaking, isSpeaking } from '../voice/tts.js';
import { icon } from '../core/icons.js';

export const newsData = () => remote('news', '/api/news/digest/latest', 10 * 60000);
const marketData = () => remote('markets', '/api/markets', 10 * 60000);

// Topic keys match server/src/jobs/news.js TOPICS ('other' is never shown).
export const TOPICS = [
  { key: 'politics', label: 'Politics' },
  { key: 'economy', label: 'Economy' },
  { key: 'elections', label: 'Elections' },
  { key: 'conflict', label: 'Conflict' },
  { key: 'diplomacy', label: 'Diplomacy' },
  { key: 'climate', label: 'Climate' },
  { key: 'tech', label: 'Tech' },
  { key: 'society', label: 'Society' },
  { key: 'health', label: 'Health' }
];
const TOPIC_LABEL = Object.fromEntries(TOPICS.map(t => [t.key, t.label]));
const REGION_LABEL = Object.fromEntries(REGIONS.map(r => [r.key, r.label]));
const STATUS = { upcoming: ['Upcoming', 'signal'], campaign: ['Campaign', 'signal'], voting: ['Voting now', 'warn'], results: ['Results', 'ok'], aftermath: ['Aftermath', 'plain'] };

const place = s => { const c = s.country_n3 && COUNTRIES[s.country_n3]; return c ? { lon: c[0], lat: c[1] } : {}; };
const ago = s => s.publishedAt ? fmt.ago(new Date(s.publishedAt).getTime()) : null;

/* Flatten the digest + breaking list into stories with map coordinates (country centroid). */
export function digestStories(d) {
  if (!d) return [];
  const out = [];
  for (const r of REGIONS) for (const s of ((d.digest || {}).regions || {})[r.key] || []) out.push({ ...s, ...place(s), region: r.key });
  for (const b of d.breaking || []) {
    if (!b.region || out.some(s => s.url === b.url)) continue;
    out.push({ ...b, ...place(b), breaking: true });
  }
  return out;
}

let activeRegion = null;
let activeTopic = null;

const matches = s => (!activeRegion || s.region === activeRegion) && (!activeTopic || s.topic === activeTopic);
const tone = s => ({ '--c': s.region ? `var(--tone-${s.region})` : 'var(--signal)' });
const topicTag = s => s.topic && TOPIC_LABEL[s.topic] ? h('span.topic-tag', { dataset: { topic: s.topic } }, TOPIC_LABEL[s.topic]) : null;
const sourceLine = s => {
  const n = (s.sources || []).length;
  return [s.country, n > 1 ? `${s.source} +${n - 1}` : s.source, ago(s)].filter(Boolean).join(' · ');
};

function storyRow(s) {
  return h('li.story' + (s.breaking ? '.breaking' : ''), { style: tone(s) },
    h('span.story-dot'),
    h('div.grow',
      h('a.story-title', { href: s.url, target: '_blank', rel: 'noopener' }, s.headline),
      h('div.story-meta', topicTag(s), h('span', sourceLine(s)))),
    s.breaking ? chip('breaking', 'alert', 'live') : null);
}

/* ---------- market strip ---------- */
function spark(values, up) {
  if (!values || values.length < 2) return null;
  const W = 72, H = 22, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * W).toFixed(1)},${(H - 2 - (v - min) / span * (H - 4)).toFixed(1)}`).join(' ');
  return h('svg.spark.' + (up ? 'up' : 'down'), { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, h('polyline', { points: pts }));
}

function marketStrip() {
  const { data } = marketData();
  const quotes = (data && data.quotes) || [];
  if (!quotes.length) return null;
  return h('div.market-strip', { role: 'list', 'aria-label': 'Markets' }, quotes.map(q => {
    const up = q.change >= 0;
    const price = q.price.toLocaleString('en-US', { minimumFractionDigits: q.digits, maximumFractionDigits: q.digits });
    return h('div.quote', { role: 'listitem', title: q.monthChange != null ? `${q.label}: ${q.monthChange >= 0 ? '+' : ''}${q.monthChange.toFixed(1)}% over the month` : q.label },
      h('div.quote-label', q.label),
      h('div.quote-row',
        h('span.quote-price', q.unit === '%' ? price + '%' : (q.unit || '') + price),
        h('span.quote-change' + (up ? '.up' : '.down'), (up ? '▲ ' : '▼ ') + Math.abs(q.change).toFixed(2) + '%')),
      spark(q.spark, (q.monthChange ?? q.change) >= 0));
  }));
}

/* ---------- big picture ---------- */
function topCard(s, i) {
  return h('article.top-story' + (s.breaking ? '.breaking' : ''), { style: tone(s) },
    h('div.top-rank', String(i + 1).padStart(2, '0')),
    h('div.grow',
      h('div.top-tags', s.region ? h('span.region-tag', REGION_LABEL[s.region]) : null, topicTag(s), s.breaking ? chip('breaking', 'alert', 'live') : null),
      h('a.top-headline', { href: s.url, target: '_blank', rel: 'noopener' }, s.headline),
      s.brief ? h('p.top-brief', s.brief) : null,
      h('div.story-meta', h('span', [(s.sources || [s.source]).filter(Boolean).slice(0, 4).join(', '), ago(s)].filter(Boolean).join(' · ')))));
}

/* ---------- live wire ---------- */
function wireRow(s) {
  return h('li.wire-row' + (s.breaking ? '.breaking' : ''), { style: tone(s) },
    h('time.wire-time', s.publishedAt ? fmt.time(new Date(s.publishedAt)) : ''),
    h('span.story-dot'),
    h('div.grow',
      h('a.story-title', { href: s.url, target: '_blank', rel: 'noopener' }, s.headline),
      h('div.story-meta', topicTag(s), h('span', [s.country || REGION_LABEL[s.region], (s.sources || []).length > 1 ? s.sources.length + ' outlets' : s.source].filter(Boolean).join(' · ')))),
    h('span.sig', { title: 'Significance ' + s.significance + '/10' }, String(s.significance)));
}

/* ---------- elections ---------- */
function electionCard(e) {
  const [label, t] = STATUS[e.status] || STATUS.upcoming;
  return h('li.election', { style: tone(e) },
    h('div.election-head',
      h('b', h('span.story-dot'), e.country || REGION_LABEL[e.region] || '—'),
      chip(label, t === 'plain' ? '' : t, t === 'plain' ? 'plain' : (e.status === 'voting' ? 'live' : ''))),
    h('div.election-kind', [e.kind, e.when].filter(Boolean).join(' · ')),
    h('a.story-title', { href: e.url, target: '_blank', rel: 'noopener' }, e.headline),
    h('div.story-meta', h('span', sourceLine({ ...e, country: null }))));
}

function speechFor(top, stories, label) {
  const parts = [label];
  if (top.length) parts.push('The big picture. ' + top.slice(0, 4).map(s => s.headline + (s.brief ? ' ' + s.brief : '')).join(' '));
  const by = {};
  stories.forEach(s => (by[s.region] = by[s.region] || []).push(s));
  for (const r of REGIONS) if (by[r.key]) parts.push(r.label + '. ' + by[r.key].slice(0, 3).map(s => s.headline).join('. ') + '.');
  return parts.join('\n');
}

export function worldPulsePanel() {
  const { data, connected } = newsData();
  const top = (data && data.digest && data.digest.top) || [];
  const stories = top.length ? top : digestStories(data).sort((a, b) => (b.breaking - a.breaking) || (b.significance || 0) - (a.significance || 0));
  return panel({ title: 'World pulse', readout: data && data.digest ? fmt.ago(new Date(data.digest.createdAt).getTime()) : '', actions: [h('button.btn.sm.ghost', { type: 'button', onclick: () => go('news') }, 'Open')] },
    stories.length
      ? h('ul.stories.compact', stories.slice(0, 4).map(storyRow))
      : empty(connected ? 'First digest is on its way' : 'News needs the server', connected ? 'Digests arrive at 07:00, 13:00 and 19:00.' : 'Pair this device in Settings to get the world digest.'));
}

export default {
  id: 'news',
  render(root) {
    const { data, loading, connected } = newsData();
    const digest = (data && data.digest) || {};
    const stories = digestStories(data);
    const top = (digest.top || []).map(s => ({ ...s, ...place(s) }));
    const wire = (data && data.wire) || [];
    const elections = digest.elections || [];
    const breaking = (data && data.breaking) || [];

    const setRegion = r => { activeRegion = r; notify(); };
    const setTopic = t => { activeTopic = activeTopic === t ? null : t; notify(); };

    // counts reflect the other filter, so the chips tell you where the news is
    const regionCounts = {}, topicCounts = {};
    for (const s of [...stories, ...wire]) {
      if (!activeTopic || s.topic === activeTopic) regionCounts[s.region] = (regionCounts[s.region] || 0) + 1;
      if (!activeRegion || s.region === activeRegion) topicCounts[s.topic] = (topicCounts[s.topic] || 0) + 1;
    }
    const visible = stories.filter(matches);
    const visibleTop = top.filter(matches);
    const visibleWire = wire.filter(matches);
    const visibleElections = elections.filter(e => !activeRegion || e.region === activeRegion);
    const mapStories = [...visible, ...visibleWire.filter(w => !visible.some(s => s.url === w.url)).map(w => ({ ...w, ...place(w) }))];
    const filterLabel = [activeTopic && TOPIC_LABEL[activeTopic], activeRegion && REGION_LABEL[activeRegion]].filter(Boolean).join(' · ');

    const readBtn = h('button.btn', {
      type: 'button',
      onclick: () => { if (isSpeaking()) stopSpeaking(); else speak(speechFor(visibleTop, visible, filterLabel ? 'World news: ' + filterLabel : 'Your world news')); }
    }, icon('volume'), 'Read aloud');
    const reload = () => { refresh('news', '/api/news/digest/latest'); refresh('markets', '/api/markets'); };

    const topicBar = h('div.topic-bar', { role: 'group', 'aria-label': 'Filter by topic' },
      h('button', { type: 'button', 'aria-pressed': String(!activeTopic), onclick: () => { activeTopic = null; notify(); } }, 'All'),
      TOPICS.filter(t => topicCounts[t.key] || activeTopic === t.key).map(t => h('button', {
        type: 'button', 'aria-pressed': String(activeTopic === t.key), dataset: { topic: t.key }, onclick: () => setTopic(t.key)
      }, h('i'), t.label, h('span.data', String(topicCounts[t.key] || 0)))),
      filterLabel ? h('button.clear', { type: 'button', onclick: () => { activeTopic = null; activeRegion = null; notify(); } }, icon('x'), 'Clear') : null);

    const hasAny = stories.length || top.length || wire.length;

    root.append(h('div.view.news',
      viewHead('World', digest.createdAt ? `Digest of ${fmt.time(new Date(digest.createdAt))} · live wire every 30 min · next digest ${nextSlot()}` : 'Politics, economy, elections and conflict — the events that move the world, three digests a day plus a live wire.',
        readBtn, connected ? btn(loading ? 'Refreshing…' : 'Refresh', reload, 'ghost', 'sync') : null),
      breaking.length ? h('div.breaking-bar', chip('breaking', 'alert', 'live'),
        h('a.grow', { href: breaking[0].url, target: '_blank', rel: 'noopener' }, breaking[0].headline),
        breaking.length > 1 ? h('span.data', `+${breaking.length - 1} more`) : null) : null,
      connected ? marketStrip() : null,
      hasAny ? topicBar : null,
      hasAny ? h('div.world-grid',
        panel({ title: 'The big picture', readout: visibleTop.length ? `${visibleTop.length} must-know` : '', cls: 'top-panel' },
          visibleTop.length ? h('div.top-list', visibleTop.map(topCard))
            : h('div.hint', top.length ? 'No headline event matches this filter — see the wire.' : 'Builds with the next digest.')),
        panel({ title: h('span.wire-title', h('span.live-dot'), 'Live wire'), readout: visibleWire.length ? visibleWire.length + ' events · 18 h' : '', cls: 'wire-panel' },
          visibleWire.length ? h('ol.wire', visibleWire.map(wireRow)) : h('div.hint', 'Nothing significant on the wire for this filter.'))) : null,
      panel({ cls: 'map-panel flush' },
        worldMap({ stories: mapStories, active: activeRegion, onRegion: setRegion }),
        regionLegend(activeRegion, setRegion, regionCounts)),
      visibleElections.length && (!activeTopic || activeTopic === 'elections' || activeTopic === 'politics')
        ? panel({ title: 'Elections watch', readout: visibleElections.length + ' races', cls: 'elections-panel' },
            h('ul.elections', visibleElections.map(electionCard)))
        : null,
      hasAny && activeRegion
        ? regionFocus(activeRegion, [...visibleTop, ...visible, ...visibleWire])
        : hasAny
        ? h('div.region-cols', REGIONS.map(r => {
            const list = visible.filter(s => s.region === r.key);
            return panel({ title: r.label, readout: list.length ? list.length + ' stories' : '', cls: 'region-panel', style: { '--c': `var(--tone-${r.key})` } },
              list.length ? h('ul.stories', list.map(storyRow)) : h('div.hint', activeTopic ? 'Nothing on this topic.' : 'Quiet. Nothing significant.'));
          }))
        : panel({}, empty(connected ? 'No digest yet' : 'Connect the server to get news', connected ? 'The server builds the first digest at the next slot (07:00, 13:00, 19:00).' : 'Settings → Server. The map above already shows where it is day and night right now.'))));
  }
};

/* One region picked: all of its news across the full width, in three columns by importance. */
const TIERS = [
  { key: 'must', label: 'Must know', hint: 'Breaking or significance 8+', test: s => s.breaking || (s.significance || 0) >= 8 },
  { key: 'notable', label: 'Important', hint: 'Significance 6–7', test: s => (s.significance || 0) >= 6 },
  { key: 'more', label: 'Also happening', hint: 'Worth a glance', test: () => true }
];
function regionFocus(region, list) {
  const seen = new Set(), stories = [];
  for (const s of list) { if (!s || !s.url || seen.has(s.url) || s.region !== region) continue; seen.add(s.url); stories.push(s); }
  stories.sort((a, b) => (b.breaking ? 1 : 0) - (a.breaking ? 1 : 0) || (b.significance || 0) - (a.significance || 0) || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const cols = TIERS.map(() => []);
  for (const s of stories) cols[TIERS.findIndex(t => t.test(s))].push(s);
  const label = REGION_LABEL[region];
  return h('div.region-focus', { style: { '--c': `var(--tone-${region})` } },
    h('div.region-focus-head', h('h2', label), h('span.data.muted', stories.length + ' stories'),
      h('button.btn.sm.ghost', { type: 'button', onclick: () => { activeRegion = null; notify(); } }, icon('x'), 'All regions')),
    h('div.region-tiers', TIERS.map((t, i) => panel({ title: t.label, readout: cols[i].length ? String(cols[i].length) : '', cls: 'tier-panel tier-' + t.key },
      cols[i].length ? h('ul.stories.tier-list', cols[i].map(s => tierStory(s, t.key))) : h('div.hint', i === 0 ? 'Nothing major in ' + label + ' right now.' : 'Nothing here.')))));
}
function tierStory(s, tier) {
  return h('li.story.tier-story' + (s.breaking ? '.breaking' : ''), { style: tone(s) },
    h('span.story-dot'),
    h('div.grow',
      h('a.story-title', { href: s.url, target: '_blank', rel: 'noopener' }, s.headline),
      tier !== 'more' && s.brief ? h('p.top-brief', s.brief) : null,
      h('div.story-meta', topicTag(s), h('span', sourceLine(s)))),
    s.breaking ? chip('breaking', 'alert', 'live') : s.significance ? h('span.sig', { title: 'Significance ' + s.significance + '/10' }, String(s.significance)) : null);
}

function nextSlot() {
  const hr = new Date().getHours();
  return hr < 7 ? '07:00' : hr < 13 ? '13:00' : hr < 19 ? '19:00' : '07:00';
}
