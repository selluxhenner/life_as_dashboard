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

/* Flatten the digest + breaking list into stories with map coordinates (country centroid). */
export function digestStories(d) {
  if (!d) return [];
  const out = [];
  const place = s => { const c = s.country_n3 && COUNTRIES[s.country_n3]; return c ? { lon: c[0], lat: c[1] } : {}; };
  for (const r of REGIONS) for (const s of ((d.digest || {}).regions || {})[r.key] || []) out.push({ ...s, ...place(s), region: r.key });
  for (const b of d.breaking || []) {
    if (!b.region || out.some(s => s.url === b.url)) continue;
    out.push({ ...b, ...place(b), breaking: true });
  }
  return out;
}

let activeRegion = null;

function storyRow(s) {
  return h('li.story' + (s.breaking ? '.breaking' : ''), { style: { '--c': `var(--tone-${s.region})` } },
    h('span.story-dot'),
    h('div.grow',
      h('a.story-title', { href: s.url, target: '_blank', rel: 'noopener' }, s.headline),
      h('div.story-meta', [s.country, s.source, s.publishedAt ? fmt.ago(new Date(s.publishedAt).getTime()) : null].filter(Boolean).join(' · '))),
    s.breaking ? chip('breaking', 'alert', 'live') : null);
}

function speechFor(stories, label) {
  const by = {};
  stories.forEach(s => (by[s.region] = by[s.region] || []).push(s));
  const parts = [label];
  for (const r of REGIONS) if (by[r.key]) parts.push(r.label + '. ' + by[r.key].slice(0, 3).map(s => s.headline).join('. ') + '.');
  return parts.join('\n');
}

export function worldPulsePanel() {
  const { data, connected } = newsData();
  const stories = digestStories(data).sort((a, b) => (b.breaking - a.breaking) || (b.significance || 0) - (a.significance || 0));
  return panel({ title: 'World pulse', readout: data && data.digest ? fmt.ago(new Date(data.digest.createdAt).getTime()) : '', actions: [h('button.btn.sm.ghost', { type: 'button', onclick: () => go('news') }, 'Map')] },
    stories.length
      ? h('ul.stories.compact', stories.slice(0, 4).map(storyRow))
      : empty(connected ? 'First digest is on its way' : 'News needs the server', connected ? 'Digests arrive at 07:00, 13:00 and 19:00.' : 'Pair this device in Settings to get the world digest.'));
}

export default {
  id: 'news',
  render(root) {
    const { data, loading, connected } = newsData();
    const stories = digestStories(data);
    const counts = {};
    stories.forEach(s => counts[s.region] = (counts[s.region] || 0) + 1);
    const setRegion = r => { activeRegion = r; notify(); };
    const visible = activeRegion ? stories.filter(s => s.region === activeRegion) : stories;
    const breaking = stories.filter(s => s.breaking);
    const readBtn = h('button.btn', {
      type: 'button',
      onclick: () => { if (isSpeaking()) stopSpeaking(); else speak(speechFor(visible, activeRegion ? 'News from ' + REGIONS.find(r => r.key === activeRegion).label : 'Your world news')); }
    }, icon('volume'), 'Read aloud');

    root.append(h('div.view.news',
      viewHead('World', data && data.digest ? `Digest of ${fmt.time(new Date(data.digest.createdAt))} · next at ${nextSlot()}` : 'Precise, region-by-region updates — three times a day, plus breaking news.',
        readBtn, connected ? btn(loading ? 'Refreshing…' : 'Refresh', () => refresh('news', '/api/news/digest/latest'), 'ghost', 'sync') : null),
      breaking.length ? h('div.breaking-bar', chip('breaking', 'alert', 'live'), h('span', breaking[0].headline)) : null,
      panel({ cls: 'map-panel flush' },
        worldMap({ stories, active: activeRegion, onRegion: setRegion }),
        regionLegend(activeRegion, setRegion, counts)),
      stories.length
        ? h('div.region-cols', REGIONS.filter(r => !activeRegion || r.key === activeRegion).map(r => {
            const list = stories.filter(s => s.region === r.key);
            return panel({ title: r.label, readout: list.length ? list.length + ' stories' : '', cls: 'region-panel', style: { '--c': `var(--tone-${r.key})` } },
              list.length ? h('ul.stories', list.map(storyRow)) : h('div.hint', 'Quiet. Nothing significant.'));
          }))
        : panel({}, empty(connected ? 'No digest yet' : 'Connect the server to get news', connected ? 'The server builds the first digest at the next slot (07:00, 13:00, 19:00).' : 'Settings → Server. The map above already shows where it is day and night right now.'))));
  }
};

function nextSlot() {
  const hr = new Date().getHours();
  return hr < 7 ? '07:00' : hr < 13 ? '13:00' : hr < 19 ? '19:00' : '07:00';
}
