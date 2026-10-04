// Pre-computes the dot-matrix world map used as the app background.
// Run once (output is committed): node scripts/build-world-dots.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { geoContains, geoBounds, geoCentroid, geoArea } from 'd3-geo';
import { regionOf, REGION_INDEX } from '../src/data/regions.js';

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const countries = feature(topo, topo.objects.countries).features;

const STEP = 1.5;          // degrees between dots
const LAT_MIN = -56, LAT_MAX = 82;

// Bounding boxes first, so each dot only tests a handful of countries.
const indexed = countries.map(f => ({ f, b: geoBounds(f), name: f.properties.name }));

const dots = [];
let row = 0;
for (let lat = LAT_MAX; lat >= LAT_MIN; lat -= STEP, row++) {
  const offset = (row % 2) * STEP / 2;   // staggered rows read as a hex lattice
  for (let lon = -180 + offset; lon < 180; lon += STEP) {
    for (const c of indexed) {
      const [[x0, y0], [x1, y1]] = c.b;
      const inLon = x0 <= x1 ? (lon >= x0 && lon <= x1) : (lon >= x0 || lon <= x1);
      if (!inLon || lat < y0 || lat > y1) continue;
      if (!geoContains(c.f, [lon, lat])) continue;
      const region = regionOf(c.name, lon);
      if (region) dots.push(Math.round(lon * 10), Math.round(lat * 10), REGION_INDEX[region]);
      break;
    }
  }
}

// Country centroids keyed by ISO numeric id, for placing news markers.
const centroids = {};
for (const c of indexed) {
  if (!c.f.id) continue;
  let target = c.f;
  // Use the largest polygon so e.g. France's marker isn't pulled toward French Guiana.
  if (c.f.geometry.type === 'MultiPolygon') {
    let best = null, bestArea = -1;
    for (const coords of c.f.geometry.coordinates) {
      const poly = { type: 'Feature', geometry: { type: 'Polygon', coordinates: coords } };
      const a = geoArea(poly);
      if (a > bestArea) { bestArea = a; best = poly; }
    }
    target = best;
  }
  const [lon, lat] = geoCentroid(target);
  const region = regionOf(c.name, lon);
  if (region) centroids[c.f.id] = [Math.round(lon * 10) / 10, Math.round(lat * 10) / 10, region, c.name];
}

writeFileSync(new URL('../src/assets/world-dots.json', import.meta.url), JSON.stringify({ step: STEP, dots }));
writeFileSync(new URL('../src/assets/country-centroids.json', import.meta.url), JSON.stringify(centroids));
console.log(`dots: ${dots.length / 3}, centroids: ${Object.keys(centroids).length}`);
