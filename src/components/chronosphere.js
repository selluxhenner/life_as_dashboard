// Chronosphere: a 24-hour clock. Midnight sits at the bottom, noon at the top.
// Rings, outside in: hour dial · daylight (sunrise→sunset from suncalc) · today's events · week/month/year progress.
// Motion: a boot sequence on first show, then a radar beam + seconds comet driven by one rAF loop,
// rolling digits, a shockwave every minute, a tick ripple every hour, and a 3D tilt under the pointer.
import { arc } from 'd3-shape';
import * as SunCalcNS from 'suncalc';
const SunCalc = SunCalcNS;
import { h } from '../core/dom.js';
import { pad2 } from '../core/dates.js';
import { reducedMotion } from '../core/fx.js';

const TAU = Math.PI * 2;
const angleOf = min => Math.PI + (min / 1440) * TAU;          // d3 convention: 0 = up, clockwise
const degOf = min => (180 + min / 4) % 360;
const minOf = d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
const polar = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
const easeOutBack = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const clamp01 = t => Math.max(0, Math.min(1, t));

function yearProgress(d) {
  const s = new Date(d.getFullYear(), 0, 1), e = new Date(d.getFullYear() + 1, 0, 1);
  return (d - s) / (e - s);
}
function monthProgress(d) {
  const s = new Date(d.getFullYear(), d.getMonth(), 1), e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return (d - s) / (e - s);
}
function weekProgress(d) { return (((d.getDay() + 6) % 7) * 1440 + minOf(d)) / (7 * 1440); }

/* The boot sequence plays once per app start; views re-render on every store change. */
let booted = false;
const INTRO_MS = 2400;
/* The launch animation calls this when the window is opened again, so the next clock plays its intro. */
export function replayIntro() { booted = false; }

/** A digit that rolls to its next value: old glyph leaves upward, new one rises in. */
function digitSlot() {
  const el = h('span.dg', h('span.dg-c', '0'));
  let value = '0';
  return {
    el,
    set(ch, animate) {
      if (ch === value) return;
      value = ch;
      if (!animate) { el.replaceChildren(h('span.dg-c', ch)); return; }
      for (const old of el.querySelectorAll('.dg-c:not(.out)')) {
        old.classList.add('out');
        old.addEventListener('animationend', () => old.remove(), { once: true });
      }
      el.append(h('span.dg-c.in', ch));
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    },
    scramble() { el.replaceChildren(h('span.dg-c', String((Math.random() * 10) | 0))); value = ''; }
  };
}

/**
 * createChronosphere({lat, lon, size})
 * returns {el, update({events:[{start,end,color,title}]}), destroy()}
 */
export function createChronosphere({ lat = 52.52, lon = 13.405, size = 420, compact = false } = {}) {
  const R = 200;                                           // internal units, viewBox -215..215
  const calm = reducedMotion();
  const intro = !booted && !calm;
  booted = true;

  const svg = h('svg.chrono', { viewBox: '-215 -215 430 430', role: 'img', 'aria-label': '24-hour clock with today’s schedule' });
  const g = {
    dial: h('g.dial'), wake: h('g.wake'), day: h('g.daylight'), events: h('g.events'), progress: h('g.progress'),
    pulse: h('g.pulses'), hand: h('g.hand'), center: h('g.center'), secs: h('g.secs')
  };
  svg.append(g.dial, g.wake, g.day, g.events, g.progress, g.secs, g.pulse, g.hand, g.center);

  // ---- static dial ----
  for (let i = 0; i < 96; i++) {                          // 15-minute ticks, i = 0 at midnight (bottom)
    const a = angleOf(i * 15), major = i % 12 === 0, hour = i % 4 === 0;
    const r1 = R, r2 = R - (major ? 14 : hour ? 8 : 4);
    const [x1, y1] = polar(a, r1), [x2, y2] = polar(a, r2);
    g.dial.append(h('line', { x1, y1, x2, y2, class: major ? 'tk major' : hour ? 'tk hour' : 'tk', style: { '--i': i } }));
  }
  [0, 3, 6, 9, 12, 15, 18, 21].forEach((hr, i) => {
    const [x, y] = polar(angleOf(hr * 60), R - 26);
    g.dial.append(h('text.hl', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', style: { '--i': i } }, pad2(hr)));
  });
  g.dial.append(h('circle.ring', { r: R + 6 }), h('circle.orbit', { r: R + 11, pathLength: 360 }));

  // seconds: 60 dim segments; the lit part is the HTML comet layer drawn on top
  for (let i = 0; i < 60; i++) {
    const a0 = (i / 60) * TAU + .012, a1 = ((i + 1) / 60) * TAU - .012;
    g.secs.append(h('path.sec', { d: arc()({ innerRadius: 92, outerRadius: 96, startAngle: a0, endAngle: a1 }) }));
  }
  const secHead = h('circle.sec-head', { cx: 0, cy: -94, r: 3.2 });
  g.secs.append(secHead);

  // hand: built pointing up, rotated every frame
  g.hand.append(
    h('line.hand-line', { x1: 0, y1: -(R - 124), x2: 0, y2: -(R + 4) }),
    h('circle.hand-dot', { cx: 0, cy: -(R - 76), r: 4.5 }),
    h('circle.hand-tip', { cx: 0, cy: -(R + 4), r: 2 }));

  // progress rings: stroked circles so they can fill with a transition
  const rings = [['w', R - 98], ['m', R - 106], ['y', R - 114]].map(([k, r]) => {
    const fg = h('circle.pfg.' + k, { r, pathLength: 100, 'stroke-dasharray': '0 100' });
    const dot = h('circle.pdot', { cx: 0, cy: -r, r: 2.4 });
    g.progress.append(h('circle.pbg', { r }), fg, dot);
    return { fg, dot };
  });

  // center text (the time itself is HTML so its digits can roll)
  const tDate = h('text.t-date', { x: 0, y: 34, 'text-anchor': 'middle' });
  const tSun = h('text.t-sun', { x: 0, y: 52, 'text-anchor': 'middle' });
  const tTop = h('text.t-top', { x: 0, y: -50, 'text-anchor': 'middle' });
  g.center.append(tTop, tDate, tSun);

  const slots = [digitSlot(), digitSlot(), digitSlot(), digitSlot()];
  const time = h('div.chrono-time', { 'aria-hidden': 'true' }, slots[0].el, slots[1].el, h('span.colon', ':'), slots[2].el, slots[3].el);
  const radar = h('div.chrono-radar');
  const comet = h('div.chrono-comet');
  const glare = h('div.chrono-glare');

  const el = h('div.chronosphere' + (compact ? '.compact' : '') + (intro ? '.intro' : '') + (calm ? '.calm' : ''),
    { style: { '--size': size + 'px' } }, svg, radar, comet, time, glare);

  let events = [], evMarks = [], lastMinute = -1, lastHour = -1, lastBeam = 0, settled = false;
  let raf = 0, timer = 0, visible = true, alive = true;
  const born = performance.now();

  function drawMinute(now) {
    const times = SunCalc.getTimes(now, lat, lon);
    const rise = minOf(times.sunrise), set = minOf(times.sunset);
    const dawn = minOf(times.dawn), dusk = minOf(times.dusk);
    g.day.replaceChildren();
    const band = (a, b, cls, ri = R - 52, ro = R - 40) => {
      if (!(b > a)) return;
      g.day.append(h('path', { class: cls, d: arc()({ innerRadius: ri, outerRadius: ro, startAngle: angleOf(a), endAngle: angleOf(b) }) }));
    };
    band(0, 1440, 'night');
    band(dawn, rise, 'twilight');
    band(set, dusk, 'twilight');
    band(rise, set, 'sun');
    for (const [m, label] of [[rise, '↑'], [set, '↓']]) {
      const [x, y] = polar(angleOf(m), R - 64);
      g.day.append(h('text.sunmark', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, label));
    }
    const [nx, ny] = polar(angleOf(minOf(times.solarNoon)), R - 46);
    g.day.append(h('circle.noon', { cx: nx, cy: ny, r: 3 }));

    // wake: the last three hours glow behind the hand, fading out
    const m = minOf(now);
    g.wake.replaceChildren();
    for (let i = 0; i < 18; i++) {
      const a = m - (i + 1) * 10, b = m - i * 10;
      g.wake.append(h('path', { d: arc()({ innerRadius: R - 3, outerRadius: R + 1, startAngle: angleOf(a), endAngle: angleOf(b) }), style: { opacity: (1 - i / 18) ** 2 * .55 } }));
    }

    // events track
    g.events.replaceChildren();
    g.events.append(h('path.track', { d: arc()({ innerRadius: R - 82, outerRadius: R - 70, startAngle: 0, endAngle: TAU }) }));
    evMarks = [];
    events.forEach((ev, i) => {
      if (ev.allDay) return;
      const a0 = angleOf(ev.start), a1 = angleOf(Math.max(ev.end, ev.start + 10));
      const p = h('path.ev', {
        d: arc().padAngle(.006).cornerRadius(2)({ innerRadius: R - 82, outerRadius: R - 70, startAngle: a0, endAngle: a1 }),
        style: { '--c': ev.color || 'var(--signal)', '--i': i }, class: ev.past ? 'ev past' : ev.now ? 'ev now' : 'ev'
      });
      p.append(h('title', `${ev.time || ''} ${ev.title}`));
      g.events.append(p);
      evMarks.push({ el: p, deg: degOf(ev.start) });
    });

    // progress rings
    const vals = [weekProgress(now), monthProgress(now), yearProgress(now)];
    const paint = () => rings.forEach(({ fg, dot }, i) => {
      fg.setAttribute('stroke-dasharray', `${(vals[i] * 100).toFixed(2)} 100`);
      dot.style.transform = `rotate(${vals[i] * 360}deg)`;
    });
    const age = performance.now() - born;                   // during boot, fill once the clock is on screen
    if (intro && age < 650) setTimeout(paint, 650 - age); else paint();

    const yp = (yearProgress(now) * 100).toFixed(1);
    tTop.textContent = `Y ${yp}%  ·  W${String(Math.ceil(weekProgress(now) * 7))}/7`;
    tDate.textContent = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const fmt = d => isNaN(d) ? '--:--' : pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    tSun.textContent = `sun ${fmt(times.sunrise)} → ${fmt(times.sunset)}`;
  }

  /* One-shot effects. Restarting a CSS animation needs a reflow between remove and add. */
  function restart(node, cls) { node.classList.remove(cls); void node.getBoundingClientRect(); node.classList.add(cls); }
  function shockwave() {
    const ring = h('circle.shock', { r: 96 });
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
    g.pulse.append(ring);
  }

  function frame(ts = performance.now()) {
    const now = new Date();
    const t = ts - born;
    const sec = now.getSeconds() + now.getMilliseconds() / 1000;

    if (now.getMinutes() !== lastMinute) {
      const first = lastMinute === -1;
      lastMinute = now.getMinutes();
      drawMinute(now);
      if (!first && !calm) {
        shockwave();
        if (now.getHours() !== lastHour) restart(g.dial, 'ripple');
      }
      lastHour = now.getHours();
    }

    // hand: smooth through the day; on boot it swings in from midnight with a slight overshoot
    let handDeg = degOf(minOf(now) + (calm ? 0 : now.getMilliseconds() / 60000));
    if (intro && t < 1800) handDeg = 180 + (((handDeg - 180 + 360) % 360) * easeOutBack(clamp01((t - 200) / 1600)));
    g.hand.style.transform = `rotate(${handDeg}deg)`;

    // seconds: comet + radar beam share one angle
    const secDeg = calm ? Math.floor(sec) * 6 : sec * 6;
    el.style.setProperty('--sec', secDeg.toFixed(2) + 'deg');
    secHead.style.transform = `rotate(${secDeg}deg)`;

    // events light up as the beam passes their start
    if (!calm) {
      for (const m of evMarks) {
        const crossed = lastBeam <= secDeg ? m.deg > lastBeam && m.deg <= secDeg : m.deg > lastBeam || m.deg <= secDeg;
        if (crossed) restart(m.el, 'ping');
      }
    }
    lastBeam = secDeg;

    // digits: scramble during boot, then settle left to right
    const digits = pad2(now.getHours()) + pad2(now.getMinutes());
    slots.forEach((s, i) => {
      if (intro && t < 500 + i * 110) { if ((t / 55 | 0) !== ((t - 16) / 55 | 0)) s.scramble(); }
      else s.set(digits[i], settled && (!intro || t > 1200));
    });
    settled = true;
    if (intro && t > INTRO_MS) el.classList.remove('intro');
  }

  function loop(ts) { if (!alive) return; frame(ts); raf = visible ? requestAnimationFrame(loop) : 0; }
  function start() { if (calm) { clearInterval(timer); timer = setInterval(frame, 1000); } else if (!raf) raf = requestAnimationFrame(loop); }

  // pause the loop while the clock is scrolled out of view
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && alive) start();
  }) : null;
  io && io.observe(el);

  // 3D tilt + glare under a fine pointer
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const onMove = e => {
    const b = el.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    el.style.setProperty('--rx', ((.5 - y) * 14).toFixed(2) + 'deg');
    el.style.setProperty('--ry', ((x - .5) * 14).toFixed(2) + 'deg');
    el.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
    el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    el.classList.add('tilt');
  };
  const onLeave = () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); el.classList.remove('tilt'); };
  if (fine && !calm) { el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave); }

  frame();
  start();
  if (intro) setTimeout(() => alive && shockwave(), 1500);  // boot ends with one pulse

  return {
    el,
    update(opts = {}) {
      const nowMin = minOf(new Date());
      events = (opts.events || []).map(e => ({ ...e, past: e.end <= nowMin, now: e.start <= nowMin && e.end > nowMin }));
      drawMinute(new Date());
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf); clearInterval(timer);
      io && io.disconnect();
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave);
    }
  };
}
