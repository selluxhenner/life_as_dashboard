// Living world backdrop: dot-matrix continents in regional tones, lit by the real sun.
// Static layer (dots, day/night, graticule, home marker) is redrawn once a minute to an offscreen canvas.
// The live layer only animates pings (news, events) at a capped frame rate and pauses when hidden.
import WORLD from '../assets/world-dots.json';
import { REGIONS } from '../data/regions.js';

const DEG = Math.PI / 180;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* Subsolar point for a date (NOAA approximation, accurate to ~0.1°). */
export function subsolar(date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) % 360 * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  let eot = (L * DEG - ra) / DEG;                       // degrees
  eot = ((eot + 180) % 360 + 360) % 360 - 180;
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = -15 * (utcH - 12) - eot;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lat: decl / DEG, lon };
}
/* Sun elevation in degrees at lat/lon, given the subsolar point. */
export function sunElevation(lat, lon, sun) {
  const s = Math.sin(lat * DEG) * Math.sin(sun.lat * DEG) + Math.cos(lat * DEG) * Math.cos(sun.lat * DEG) * Math.cos((lon - sun.lon) * DEG);
  return Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
}

const LAT_TOP = 84, LAT_BOTTOM = -58;

export function createBackdrop(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const stat = document.createElement('canvas');
  const sctx = stat.getContext('2d');
  const isMobile = matchMedia('(max-width: 860px)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FPS = isMobile ? 24 : 40;

  let w = 0, ht = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  let colors = {}, pings = [], reveal = opts.boot ? 0 : 1, running = false, last = 0, raf = 0;
  let parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  const home = opts.home || { lat: 52.52, lon: 13.405, label: 'Berlin' };

  const project = (lon, lat) => [ox + (lon + 180) * scale, oy + (LAT_TOP - lat) * scale];

  function readColors() {
    colors = {
      tones: REGIONS.map(r => css('--tone-' + r.key)),
      signal: css('--signal'), ink3: css('--ink-3'), seam: css('--seam'), amber: css('--amber'),
      void: css('--void'), dotAlpha: parseFloat(css('--map-dot-alpha')) || .55
    };
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; ht = window.innerHeight;
    for (const c of [canvas, stat]) { c.width = Math.round(w * dpr); c.height = Math.round(ht * dpr); }
    canvas.style.width = w + 'px'; canvas.style.height = ht + 'px';
    // Cover the viewport. On portrait screens, keep Europe (home) roughly centered.
    const latSpan = LAT_TOP - LAT_BOTTOM;
    scale = Math.max(w / 360, ht / latSpan) * 1.04;
    const mapW = 360 * scale, mapH = latSpan * scale;
    ox = (w - mapW) / 2; oy = (ht - mapH) / 2;
    if (mapW > w * 1.3) ox = Math.min(0, Math.max(w - mapW, w / 2 - (home.lon + 180) * scale));
    drawStatic();
  }

  function drawStatic() {
    const now = new Date();
    const sun = subsolar(now);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, w, ht);

    // Graticule: meridians every 30°, the equator and tropics slightly stronger.
    sctx.lineWidth = 1;
    sctx.strokeStyle = colors.seam;
    sctx.globalAlpha = .55;
    sctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 30) { const [x] = project(lon, 0); sctx.moveTo(x + .5, 0); sctx.lineTo(x + .5, ht); }
    for (const lat of [60, 30, -30]) { const [, y] = project(0, lat); sctx.moveTo(0, y + .5); sctx.lineTo(w, y + .5); }
    sctx.stroke();
    sctx.globalAlpha = .9;
    sctx.setLineDash([2, 6]);
    sctx.beginPath();
    { const [, y] = project(0, 0); sctx.moveTo(0, y + .5); sctx.lineTo(w, y + .5); }
    sctx.stroke();
    sctx.setLineDash([]);

    // Noon meridian: a soft vertical band where it's midday right now.
    const [nx] = project(sun.lon, 0);
    const band = sctx.createLinearGradient(nx - 160, 0, nx + 160, 0);
    band.addColorStop(0, 'transparent'); band.addColorStop(.5, colors.signal); band.addColorStop(1, 'transparent');
    sctx.globalAlpha = .045; sctx.fillStyle = band; sctx.fillRect(nx - 160, 0, 320, ht);

    // Dots.
    const r = Math.max(1, scale * WORLD.step * .26);
    const d = WORLD.dots;
    for (let i = 0; i < d.length; i += 3) {
      const lon = d[i] / 10, lat = d[i + 1] / 10, reg = d[i + 2];
      const [x, y] = project(lon, lat);
      if (x < -4 || x > w + 4 || y < -4 || y > ht + 4) continue;
      const el = sunElevation(lat, lon, sun);
      // day 1 → civil/nautical twilight fades → night .22
      const light = el > 0 ? 1 : el > -12 ? .22 + .78 * (1 + el / 12) ** 2 : .22;
      sctx.globalAlpha = colors.dotAlpha * (.35 + .65 * light);
      sctx.fillStyle = colors.tones[reg];
      sctx.fillRect(x - r, y - r, r * 2, r * 2);
      // City lights: a deterministic sprinkle on the night side.
      if (el < -6 && ((i * 2654435761) >>> 0) % 100 < 9) {
        sctx.globalAlpha = .7;
        sctx.fillStyle = colors.amber;
        sctx.fillRect(x - r * .5, y - r * .5, r, r);
      }
    }

    // Terminator line: points where elevation = 0, traced per longitude.
    sctx.globalAlpha = .5;
    sctx.strokeStyle = colors.signal;
    sctx.setLineDash([1, 4]);
    sctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 2) {
      // tan(lat) = -cos(lon - lonSub) / tan(decl)
      const lat = Math.atan(-Math.cos((lon - sun.lon) * DEG) / Math.tan((sun.lat || .01) * DEG)) / DEG;
      const [x, y] = project(lon, lat);
      lon === -180 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
    }
    sctx.stroke();
    sctx.setLineDash([]);

    // Sun glyph at the subsolar point.
    const [sx, sy] = project(sun.lon, sun.lat);
    sctx.globalAlpha = 1;
    const g = sctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
    g.addColorStop(0, 'rgb(255 220 150 / .35)'); g.addColorStop(1, 'transparent');
    sctx.fillStyle = g; sctx.fillRect(sx - 60, sy - 60, 120, 120);
    sctx.strokeStyle = colors.amber; sctx.lineWidth = 1;
    sctx.beginPath(); sctx.arc(sx, sy, 5, 0, Math.PI * 2); sctx.stroke();
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      sctx.moveTo(sx + Math.cos(a) * 8, sy + Math.sin(a) * 8); sctx.lineTo(sx + Math.cos(a) * 11, sy + Math.sin(a) * 11);
    }
    sctx.stroke();

    // Home marker: crosshair + coordinates.
    const [hx, hy] = project(home.lon, home.lat);
    sctx.strokeStyle = colors.signal; sctx.globalAlpha = .9;
    sctx.beginPath();
    sctx.arc(hx, hy, 7, 0, Math.PI * 2);
    sctx.moveTo(hx - 16, hy); sctx.lineTo(hx - 10, hy); sctx.moveTo(hx + 10, hy); sctx.lineTo(hx + 16, hy);
    sctx.moveTo(hx, hy - 16); sctx.lineTo(hx, hy - 10); sctx.moveTo(hx, hy + 10); sctx.lineTo(hx, hy + 16);
    sctx.stroke();
    sctx.globalAlpha = 1;
  }

  function frame(t) {
    raf = 0;
    if (!running) return;
    if (t - last < 1000 / FPS) { raf = requestAnimationFrame(frame); return; }
    last = t;
    parallax.x += (parallax.tx - parallax.x) * .06;
    parallax.y += (parallax.ty - parallax.y) * .06;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(parallax.x * dpr, parallax.y * dpr);
    if (reveal < 1) {
      reveal = Math.min(1, reveal + 1 / (FPS * .9));
      const e = 1 - (1 - reveal) ** 3;
      ctx.drawImage(stat, 0, 0, canvas.width * e, canvas.height, 0, 0, canvas.width * e, canvas.height);
      // scan head
      ctx.fillStyle = colors.signal; ctx.globalAlpha = .5 * (1 - e);
      ctx.fillRect(canvas.width * e - 2 * dpr, 0, 2 * dpr, canvas.height);
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(stat, 0, 0);
    }
    // Pings: expanding rings, tone by region.
    ctx.setTransform(dpr, 0, 0, dpr, parallax.x * dpr, parallax.y * dpr);
    const now = performance.now();
    for (const p of pings) {
      const [x, y] = project(p.lon, p.lat);
      const period = p.breaking ? 1600 : 3200;
      const ph = ((now + p.phase) % period) / period;
      ctx.strokeStyle = p.color; ctx.lineWidth = 1;
      ctx.globalAlpha = (1 - ph) * (p.breaking ? .9 : .55);
      ctx.beginPath(); ctx.arc(x, y, 3 + ph * (p.breaking ? 26 : 16) * (p.size || 1), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = .95; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(x, y, p.breaking ? 2.6 : 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    const needsMotion = reveal < 1 || pings.length || Math.abs(parallax.tx - parallax.x) > .1 || Math.abs(parallax.ty - parallax.y) > .1;
    if (needsMotion && !reduced) raf = requestAnimationFrame(frame);
  }

  function kick() { if (running && !raf) raf = requestAnimationFrame(frame); }

  function start() {
    readColors(); resize();
    running = !document.hidden;
    if (reduced) reveal = 1;
    kick();
    if (reduced || !pings.length) requestAnimationFrame(frame);
  }

  // Wiring
  window.addEventListener('resize', () => { resize(); kick(); requestAnimationFrame(frame); });
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { drawStatic(); kick(); } });
  if (!isMobile && !reduced) window.addEventListener('pointermove', e => {
    parallax.tx = (e.clientX / w - .5) * -10; parallax.ty = (e.clientY / ht - .5) * -6; kick();
  }, { passive: true });
  setInterval(() => { if (running) { drawStatic(); kick(); requestAnimationFrame(frame); } }, 60000);

  start();

  return {
    project,
    refresh() { readColors(); drawStatic(); kick(); requestAnimationFrame(frame); },
    /* pings: [{lon, lat, region, breaking, size}] */
    setPings(list) {
      pings = list.map((p, i) => ({ ...p, phase: i * 397, color: css('--tone-' + p.region) || colors.signal }));
      kick();
    }
  };
}
