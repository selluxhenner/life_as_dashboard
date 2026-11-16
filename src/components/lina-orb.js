// Lina's presence on the deck: a sphere of light points in the middle of the day dial.
// - idle: it breathes slowly, a few motes drift around it;
// - listening: ripples go out from it with Kevin's voice;
// - thinking: three tilted orbits with comets, and particles pulled in from the edges;
// - speaking: a ring of light bars around it moves with her voice.
// One canvas for the whole session: views re-render often, so the deck re-attaches the same element and the animation
// never restarts. It draws only while it is on screen; calm motion draws one still frame per state.
import { h } from '../core/dom.js';
import { reducedMotion } from '../core/fx.js';
import { talk } from '../voice/talk.js';
import { level } from '../voice/mic.js';

const N = 520;                                   // points on the sphere
const TAU = Math.PI * 2;
let orb = null;

/* Even points on a sphere (Fibonacci lattice), each with a random phase. */
const points = Array.from({ length: N }, (_, i) => {
  const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(phi) * r, y, Math.sin(phi) * r, Math.random()];
});
/* Particles that thinking pulls in from the edge: angle, distance (1 = edge, 0 = sphere), speed. */
const motes = Array.from({ length: 90 }, () => [Math.random() * TAU, Math.random(), 0.25 + Math.random() * 0.6]);
/* Three tilted orbits for thinking: tilt, turn, speed, phase. */
const ORBITS = [[1.1, 0.3, 1.0, 0], [1.25, 2.2, -0.75, 2], [0.55, 4.1, 0.6, 4]];

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function rgb(color) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = color || '#4FE3FF';
  const hex = c.fillStyle;
  return hex.startsWith('#') ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : [79, 227, 255];
}
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

export function linaOrb() {
  if (orb) return orb.el;
  const canvas = h('canvas.orb-canvas', { 'aria-hidden': 'true' });
  const el = h('div.lina-orb', canvas);
  const ctx = canvas.getContext('2d');
  let raf = 0, t0 = performance.now(), spin = 0, energy = 0, voice = 0, think = 0, listen = 0, tone = null;
  let colors = null, colorsAt = 0, lastState = '', size = 0, introAt = -1;
  const ripples = [];                             // [born, strength] while listening
  let lastRipple = 0;

  const resize = () => {
    const r = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.round(Math.min(r.width, r.height));
    if (!s || s === size) return;
    size = s;
    canvas.width = canvas.height = s * dpr;
    canvas.style.width = canvas.style.height = s + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  function frame(now) {
    raf = 0;
    if (!el.isConnected) return;
    resize();
    if (!size) { schedule(); return; }
    if (!colors || now - colorsAt > 2000) {
      colors = { signal: rgb(css('--signal')), pulse: rgb(css('--pulse')), amber: rgb(css('--amber')), ink: rgb(css('--ink')) };
      colorsAt = now;
    }
    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    const st = talk.state;
    const calm = reducedMotion();
    const speakLevel = 0.45 + 0.4 * Math.abs(Math.sin(now / 130) * Math.sin(now / 410 + 1));
    const target = st === 'listening' ? 0.2 + level.mic * 1.2 : st === 'speaking' ? speakLevel : st === 'thinking' ? 0.4 : 0.06;
    const k = Math.min(1, dt * 8);
    energy += (target - energy) * k;
    voice += ((st === 'speaking' ? 1 : 0) - voice) * Math.min(1, dt * 4);
    think += ((st === 'thinking' ? 1 : 0) - think) * Math.min(1, dt * 3);
    listen += ((st === 'listening' ? 1 : 0) - listen) * Math.min(1, dt * 4);
    spin += dt * (0.15 + think * 1.4 + listen * 0.3);

    // colour drifts between states instead of jumping
    const want = st === 'listening' ? colors.pulse : st === 'thinking' ? mix(colors.signal, colors.amber, 0.55) : colors.signal;
    tone = tone ? mix(tone, want, Math.min(1, dt * 3)) : want;
    const [r, g, b] = tone;
    const col = a => `rgba(${r},${g},${b},${a})`;

    // the entrance (first open, Ctrl+R): the sphere gathers from a spark, a ring flashes out
    const ip = introAt < 0 ? 1 : Math.min(1, (now - introAt) / 1600);
    if (ip >= 1) introAt = -1;
    const grow = ip >= 1 ? 1 : 1 - Math.pow(1 - ip, 3) * Math.cos(ip * 5);   // eases out with a small overshoot
    const s = size, c = s / 2, R = s * 0.2 * (1 + energy * 0.1) * Math.max(0.02, grow);
    ctx.clearRect(0, 0, s, s);

    // glow
    const glow = ctx.createRadialGradient(c, c, R * 0.1, c, c, R * 2.2);
    glow.addColorStop(0, col(0.32 + energy * 0.25));
    glow.addColorStop(0.4, col(0.1 + energy * 0.1));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);

    if (ip < 1) {
      const fr = ip * 1.4;
      ctx.strokeStyle = col(Math.max(0, 0.8 * (1 - fr)));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c, c, s * 0.06 + fr * s * 0.42, 0, TAU); ctx.stroke();
    }

    // thinking: particles pulled in from the edge
    if (think > 0.02) {
      for (const m of motes) {
        m[1] -= dt * m[2] * (0.4 + think);
        if (m[1] <= 0) { m[1] = 1; m[0] = Math.random() * TAU; }
        const d = R * 1.05 + m[1] * (s * 0.5 - R * 1.05);
        const a = m[0] + spin * 0.15 * (1 - m[1]);
        const fade = Math.sin(m[1] * Math.PI) * think;
        ctx.fillStyle = col(0.7 * fade);
        ctx.fillRect(c + Math.cos(a) * d - 1, c + Math.sin(a) * d - 1, 2, 2);
      }
    }

    // listening: ripples go out with his voice
    if (st === 'listening' && now - lastRipple > 160 && level.mic > 0.15) { ripples.push([now, level.mic]); lastRipple = now; }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const [born, strength] = ripples[i], age = (now - born) / 1400;
      if (age >= 1) { ripples.splice(i, 1); continue; }
      ctx.strokeStyle = col((1 - age) * 0.5 * Math.min(1, strength + 0.3));
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(c, c, R * (1.15 + age * 1.1), 0, TAU); ctx.stroke();
    }

    // the sphere
    const cy = Math.cos(spin), sy = Math.sin(spin), tilt = 0.42, ct = Math.cos(tilt), stt = Math.sin(tilt);
    for (const [x0, y0, z0, ph] of points) {
      const ripple = 1 + energy * 0.2 * Math.sin(now / 170 + ph * TAU + y0 * 4) + think * 0.04 * Math.sin(now / 90 + ph * 20);
      let x = x0 * cy - z0 * sy, z = x0 * sy + z0 * cy, y = y0;
      const y2 = y * ct - z * stt; z = y * stt + z * ct; y = y2;
      const depth = (z + 1) / 2;
      const px = c + x * R * ripple, py = c + y * R * ripple;
      ctx.fillStyle = col(0.25 + depth * 0.75);
      const d = 0.9 + depth * 1.9 + energy * 0.8;
      ctx.fillRect(px - d / 2, py - d / 2, d, d);
    }

    // thinking: three tilted orbits, each with a comet
    if (think > 0.02) {
      ORBITS.forEach(([tl, turn, speed, phase], i) => {
        const rr = R * (1.35 + i * 0.12);
        const ca = Math.cos(turn + spin * 0.2), sa = Math.sin(turn + spin * 0.2), squash = Math.cos(tl);
        const at = t => { const x = Math.cos(t) * rr, y = Math.sin(t) * rr * squash; return [c + x * ca - y * sa, c + x * sa + y * ca]; };
        ctx.strokeStyle = col(0.18 * think);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let j = 0; j <= 72; j++) { const [x, y] = at((j / 72) * TAU); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
        const head = now / 1000 * speed * 2.2 + phase;
        for (let j = 0; j < 14; j++) {
          const [x, y] = at(head - j * 0.06 * Math.sign(speed));
          ctx.fillStyle = col(think * (1 - j / 14) * 0.95);
          const d = 3.2 - j * 0.18;
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, d), 0, TAU); ctx.fill();
        }
      });
    }

    // a quiet outer ring; listening shows his level as an arc
    ctx.strokeStyle = col(0.18 + energy * 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c, c, R * 1.28, 0, TAU); ctx.stroke();
    if (listen > 0.02) {
      ctx.strokeStyle = col(0.85 * listen);
      ctx.lineWidth = 2.5;
      const span = 0.2 + level.mic * 2.4;
      ctx.beginPath(); ctx.arc(c, c, R * 1.28, -Math.PI / 2 - span / 2 + spin * 0.4, -Math.PI / 2 + span / 2 + spin * 0.4); ctx.stroke();
    }

    // speaking: a ring of bars around the sphere
    if (voice > 0.02) {
      const bars = 96;
      ctx.lineWidth = 2;
      for (let i = 0; i < bars; i++) {
        const a = (i / bars) * TAU - Math.PI / 2;
        const v = Math.abs(Math.sin(i * 0.9 + now / 110) * Math.sin(i * 0.23 - now / 300) + 0.25 * Math.sin(i * 2.1 + now / 70));
        const len = R * (0.05 + v * 0.38 * energy) * voice;
        const r0 = R * 1.36;
        ctx.strokeStyle = col(0.35 + v * 0.6 * voice);
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
        ctx.lineTo(c + Math.cos(a) * (r0 + len), c + Math.sin(a) * (r0 + len));
        ctx.stroke();
      }
    }

    el.dataset.state = st;
    if (calm) { if (st !== lastState) { lastState = st; schedule(); } return; }
    lastState = st;
    schedule();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };

  orb = { el, start: schedule, intro: () => { introAt = performance.now(); schedule(); } };
  schedule();
  return el;
}

/** Make sure the orb is drawing (after the deck re-attached it). */
export const wakeOrb = () => orb && orb.start();

/** Play the entrance (first open, Ctrl+R). */
export const introOrb = () => orb && orb.intro();
