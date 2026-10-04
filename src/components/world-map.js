// Interactive news map: countries tinted by continent tone, markers for stories, click a continent to filter.
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import { h } from '../core/dom.js';
import { regionOf, REGIONS } from '../data/regions.js';
import { subsolar } from './backdrop.js';
import { geoCircle } from 'd3-geo';

let topoPromise = null;
const loadTopo = () => topoPromise || (topoPromise = import('world-atlas/countries-110m.json').then(m => m.default || m));

/**
 * worldMap({stories:[{lon,lat,region,significance,breaking,title}], active, onRegion})
 * Returns an element; renders asynchronously once the atlas is loaded.
 */
export function worldMap({ stories = [], active = null, onRegion } = {}) {
  const W = 960, H = 500;
  const svg = h('svg.world-map', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'World map of current stories' });
  const wrap = h('div.world-map-wrap', svg);
  loadTopo().then(topo => {
    const countries = feature(topo, topo.objects.countries).features.filter(f => f.properties.name !== 'Antarctica');
    const proj = geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' });
    const path = geoPath(proj);
    svg.append(h('path.sphere', { d: path({ type: 'Sphere' }) }));
    svg.append(h('path.graticule', { d: path(geoGraticule10()) }));
    const g = h('g.countries');
    for (const f of countries) {
      const c = path.centroid(f);
      const lon = proj.invert ? (proj.invert(c) || [0])[0] : 0;
      const region = regionOf(f.properties.name, lon);
      if (!region) continue;
      g.append(h('path.country', {
        d: path(f), dataset: { region },
        class: active && active !== region ? 'country faded' : 'country',
        style: { '--c': `var(--tone-${region})` },
        onclick: () => onRegion && onRegion(active === region ? null : region)
      }, h('title', f.properties.name)));
    }
    svg.append(g);
    // night side
    const sun = subsolar(new Date());
    const night = geoCircle().center([sun.lon + 180, -sun.lat]).radius(90)();
    svg.append(h('path.night', { d: path(night) }));
    // stories
    const mg = h('g.markers');
    for (const s of stories) {
      if (s.lon == null) continue;
      const p = proj([s.lon, s.lat]);
      if (!p) continue;
      const r = 3 + (s.significance || 5) * .7;
      mg.append(h('g.marker' + (s.breaking ? '.breaking' : ''), { transform: `translate(${p[0]},${p[1]})`, style: { '--c': `var(--tone-${s.region})` } },
        h('circle.halo', { r: r * 2 }), h('circle.core', { r: r * .55 }), h('title', s.title)));
    }
    svg.append(mg);
  });
  return wrap;
}

export function regionLegend(active, onRegion, counts = {}) {
  return h('div.region-legend', REGIONS.map(r => h('button', {
    type: 'button', 'aria-pressed': String(active === r.key), style: { '--c': `var(--tone-${r.key})` },
    onclick: () => onRegion(active === r.key ? null : r.key)
  }, h('i'), r.label, counts[r.key] ? h('span.data', String(counts[r.key])) : null)));
}
