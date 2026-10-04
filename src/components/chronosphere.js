// Chronosphere: a 24-hour clock. Midnight sits at the bottom, noon at the top.
// Rings, outside in: hour dial · daylight (sunrise→sunset from suncalc) · today's events · week/month/year progress.
import { arc } from 'd3-shape';
import * as SunCalcNS from 'suncalc';
const SunCalc = SunCalcNS;
import { h } from '../core/dom.js';
import { pad2 } from '../core/dates.js';

const TAU = Math.PI * 2;
const angleOf = min => Math.PI + (min / 1440) * TAU;          // d3 convention: 0 = up, clockwise
const minOf = d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
const polar = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];

function yearProgress(d) {
  const s = new Date(d.getFullYear(), 0, 1), e = new Date(d.getFullYear() + 1, 0, 1);
  return (d - s) / (e - s);
}
function monthProgress(d) {
  const s = new Date(d.getFullYear(), d.getMonth(), 1), e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return (d - s) / (e - s);
}
function weekProgress(d) { return (((d.getDay() + 6) % 7) * 1440 + minOf(d)) / (7 * 1440); }

/**
 * createChronosphere({lat, lon, size})
 * returns {el, update({events:[{start,end,color,title}], score})}
 */
export function createChronosphere({ lat = 52.52, lon = 13.405, size = 420, compact = false } = {}) {
  const R = 200;                                           // internal units, viewBox -210..210
  const svg = h('svg.chrono', { viewBox: '-215 -215 430 430', role: 'img', 'aria-label': '24-hour clock with today’s schedule' });
  const g = {
    dial: h('g.dial'), day: h('g.daylight'), events: h('g.events'), progress: h('g.progress'),
    hand: h('g.hand'), center: h('g.center'), secs: h('g.secs')
  };
  svg.append(g.dial, g.day, g.events, g.progress, g.secs, g.hand, g.center);

  // ---- static dial ----
  for (let i = 0; i < 96; i++) {                          // 15-minute ticks
    const a = angleOf(i * 15), major = i % 12 === 0, hour = i % 4 === 0;
    const r1 = R, r2 = R - (major ? 14 : hour ? 8 : 4);
    const [x1, y1] = polar(a, r1), [x2, y2] = polar(a, r2);
    g.dial.append(h('line', { x1, y1, x2, y2, class: major ? 'tk major' : hour ? 'tk hour' : 'tk' }));
  }
  for (const hr of [0, 3, 6, 9, 12, 15, 18, 21]) {
    const [x, y] = polar(angleOf(hr * 60), R - 26);
    g.dial.append(h('text.hl', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, pad2(hr)));
  }
  g.dial.append(h('circle.ring', { r: R + 6 }));

  // seconds: 60 segments around the center digits
  const secSegs = [];
  for (let i = 0; i < 60; i++) {
    const a0 = (i / 60) * TAU + .012, a1 = ((i + 1) / 60) * TAU - .012;
    const p = h('path.sec', { d: arc()({ innerRadius: 92, outerRadius: 96, startAngle: a0, endAngle: a1 }) });
    secSegs.push(p); g.secs.append(p);
  }

  // center readout
  const tMain = h('text.t-main', { x: 0, y: -6, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  const tDate = h('text.t-date', { x: 0, y: 34, 'text-anchor': 'middle' });
  const tSun = h('text.t-sun', { x: 0, y: 52, 'text-anchor': 'middle' });
  const tTop = h('text.t-top', { x: 0, y: -50, 'text-anchor': 'middle' });
  g.center.append(tTop, tMain, tDate, tSun);

  let events = [], timer = 0, lastMinute = -1;

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
    // solar noon dot
    const [nx, ny] = polar(angleOf(minOf(times.solarNoon)), R - 46);
    g.day.append(h('circle.noon', { cx: nx, cy: ny, r: 3 }));

    // events track
    g.events.replaceChildren();
    g.events.append(h('path.track', { d: arc()({ innerRadius: R - 82, outerRadius: R - 70, startAngle: 0, endAngle: TAU }) }));
    for (const ev of events) {
      if (ev.allDay) continue;
      const a0 = angleOf(ev.start), a1 = angleOf(Math.max(ev.end, ev.start + 10));
      const p = h('path.ev', {
        d: arc().padAngle(.006).cornerRadius(2)({ innerRadius: R - 82, outerRadius: R - 70, startAngle: a0, endAngle: a1 }),
        style: { '--c': ev.color || 'var(--signal)' }, class: ev.past ? 'ev past' : ev.now ? 'ev now' : 'ev'
      });
      p.append(h('title', `${ev.time || ''} ${ev.title}`));
      g.events.append(p);
    }

    // progress rings
    g.progress.replaceChildren();
    const rings = [['W', weekProgress(now), R - 98], ['M', monthProgress(now), R - 106], ['Y', yearProgress(now), R - 114]];
    for (const [label, v, r] of rings) {
      g.progress.append(h('path.pbg', { d: arc()({ innerRadius: r - 1.5, outerRadius: r + 1.5, startAngle: 0, endAngle: TAU }) }));
      g.progress.append(h('path.pfg', { d: arc().cornerRadius(2)({ innerRadius: r - 1.5, outerRadius: r + 1.5, startAngle: 0, endAngle: TAU * v }) }));
      const [x, y] = polar(TAU * v, r);
      g.progress.append(h('circle.pdot', { cx: x, cy: y, r: 2.4 }));
    }

    const yp = (yearProgress(now) * 100).toFixed(1);
    tTop.textContent = `Y ${yp}%  ·  W${String(Math.ceil(weekProgress(now) * 7))}/7`;
    tDate.textContent = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const fmt = d => isNaN(d) ? '--:--' : pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    tSun.textContent = `sun ${fmt(times.sunrise)} → ${fmt(times.sunset)}`;
  }

  function drawHand(now) {
    const m = minOf(now);
    const a = angleOf(m);
    const [x1, y1] = polar(a, R - 124), [x2, y2] = polar(a, R + 4), [dx, dy] = polar(a, R - 76);
    g.hand.replaceChildren(
      h('line.hand-line', { x1, y1, x2, y2 }),
      h('circle.hand-dot', { cx: dx, cy: dy, r: 4.5 }),
      h('circle.hand-tip', { cx: x2, cy: y2, r: 2 })
    );
    tMain.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    const s = now.getSeconds();
    secSegs.forEach((p, i) => p.classList.toggle('on', i <= s));
  }

  function tick() {
    const now = new Date();
    if (now.getMinutes() !== lastMinute) { lastMinute = now.getMinutes(); drawMinute(now); }
    drawHand(now);
  }

  const el = h('div.chronosphere' + (compact ? '.compact' : ''), { style: { '--size': size + 'px' } }, svg);
  tick();
  timer = setInterval(tick, 1000);

  return {
    el,
    update(opts = {}) {
      const nowMin = minOf(new Date());
      events = (opts.events || []).map(e => ({ ...e, past: e.end <= nowMin, now: e.start <= nowMin && e.end > nowMin }));
      lastMinute = -1; tick();
    },
    destroy() { clearInterval(timer); }
  };
}
