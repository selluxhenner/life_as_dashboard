// Lina's presence on the deck: a sphere of light points that breathes when she is idle, leans in and follows Kevin's
// voice while she listens, spins its rings while she thinks and pulses with her voice while she speaks.
// One canvas for the whole session: views re-render often, so the deck re-attaches the same element and the animation
// never restarts. It draws only while it is on screen; calm motion draws one still frame per state.
import { h } from '../core/dom.js';
import { reducedMotion } from '../core/fx.js';
import { talk } from '../voice/talk.js';
import { level } from '../voice/mic.js';

const N = 420;                                   // points on the sphere
const TAU = Math.PI * 2;
let orb = null;

/* Even points on a sphere (Fibonacci lattice). */
const points = Array.from({ length: N }, (_, i) => {
  const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(phi) * r, y, Math.sin(phi) * r, Math.random()];
});

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function rgb(color) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = color || '#4FE3FF';
  const hex = c.fillStyle;                       // normalised to #rrggbb
  return hex.startsWith('#') ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : [79, 227, 255];
}

export function linaOrb() {
  if (orb) return orb.el;
  const canvas = h('canvas.orb-canvas', { 'aria-hidden': 'true' });
  const el = h('div.lina-orb', canvas);
  const ctx = canvas.getContext('2d');
  let raf = 0, t0 = performance.now(), spin = 0, energy = 0, voice = 0, colors = null, colorsAt = 0, lastState = '', size = 0;

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
    if (!el.isConnected) return;                 // off screen: stop until the deck attaches it again
    resize();
    if (!colors || now - colorsAt > 2000) {      // the theme can change at any time
      colors = { signal: rgb(css('--signal')), pulse: rgb(css('--pulse')), amber: rgb(css('--amber')), ink: rgb(css('--ink')) };
      colorsAt = now;
    }
    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    const st = talk.state;
    const calm = reducedMotion();
    // how much is going on: the microphone while listening, her voice (a soft rhythm) while speaking
    const target = st === 'listening' ? 0.25 + level.mic * 1.1 : st === 'speaking' ? 0.45 + 0.35 * Math.abs(Math.sin(now / 140) * Math.sin(now / 370)) : st === 'thinking' ? 0.35 : 0.08;
    energy += (target - energy) * Math.min(1, dt * 9);
    voice += ((st === 'speaking' ? 1 : 0) - voice) * Math.min(1, dt * 4);
    spin += dt * (st === 'thinking' ? 1.6 : st === 'listening' ? 0.5 : 0.18);

    const s = size, c = s / 2, R = s * 0.3 * (1 + energy * 0.12);
    ctx.clearRect(0, 0, s, s);
    const tone = st === 'listening' ? colors.pulse : st === 'thinking' ? colors.amber : colors.signal;
    const [r, g, b] = tone;

    // glow
    const glow = ctx.createRadialGradient(c, c, R * 0.1, c, c, R * 1.9);
    glow.addColorStop(0, `rgba(${r},${g},${b},${0.30 + energy * 0.25})`);
    glow.addColorStop(0.45, `rgba(${r},${g},${b},${0.10 + energy * 0.08})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);

    // the sphere: rotate around y, tilt a little, project; points ripple with energy
    const cy = Math.cos(spin), sy = Math.sin(spin), tilt = 0.42, ct = Math.cos(tilt), stt = Math.sin(tilt);
    for (const [x0, y0, z0, k] of points) {
      const ripple = 1 + energy * 0.22 * Math.sin(now / 180 + k * TAU + y0 * 4);
      let x = x0 * cy - z0 * sy, z = x0 * sy + z0 * cy, y = y0;
      const y2 = y * ct - z * stt; z = y * stt + z * ct; y = y2;
      const depth = (z + 1) / 2;                  // 0 back … 1 front
      const px = c + x * R * ripple, py = c + y * R * ripple;
      const a = 0.28 + depth * 0.72;
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      const d = 1 + depth * 1.8 + energy * 0.9;
      ctx.fillRect(px - d / 2, py - d / 2, d, d);
    }

    // rings: two thin orbits; thinking spins arcs around them
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const rr = R * (1.32 + i * 0.16);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.22 + energy * 0.15})`;
      ctx.beginPath(); ctx.arc(c, c, rr, 0, TAU); ctx.stroke();
      if (st === 'thinking' || st === 'listening') {
        const start = (i ? -1 : 1) * spin * (i ? 1.3 : 1) + i;
        ctx.strokeStyle = `rgba(${r},${g},${b},0.75)`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c, c, rr, start, start + (st === 'thinking' ? 0.9 : 0.25 + level.mic * 1.4)); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    // her voice: a waveform band across the middle
    if (voice > 0.02) {
      ctx.strokeStyle = `rgba(${colors.ink[0]},${colors.ink[1]},${colors.ink[2]},${0.55 * voice})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const x = c - R * 0.9 + (i / 64) * R * 1.8;
        const env = Math.sin((i / 64) * Math.PI);
        const y = c + Math.sin(i * 0.55 + now / 90) * Math.sin(i * 0.17 - now / 260) * R * 0.22 * energy * env * voice;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }

    el.dataset.state = st;
    if (calm) { if (st !== lastState) { lastState = st; schedule(); } return; }
    lastState = st;
    schedule();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };

  orb = { el, start: schedule };
  schedule();
  return el;
}

/** Make sure the orb is drawing (after the deck re-attached it). */
export const wakeOrb = () => orb && orb.start();
