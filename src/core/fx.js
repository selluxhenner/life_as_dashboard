// Small effects: text decode, ui sounds, toasts.
import { h } from './dom.js';
import { state } from './store.js';

const GLYPHS = '01<>/\\[]{}=+*#%&ABCDEFHKLMNPRSTXZ';
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || state.settings.motion === 'calm';

/* Scrambles through glyphs, then settles on the final text (~300ms). */
export function decode(node, text, duration = 320) {
  if (reducedMotion()) { node.textContent = text; return; }
  const start = performance.now();
  node.classList.add('decoding');
  const step = now => {
    const p = Math.min(1, (now - start) / duration);
    const fixed = Math.floor(text.length * p);
    let out = text.slice(0, fixed);
    for (let i = fixed; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    node.textContent = out;
    if (p < 1) requestAnimationFrame(step); else { node.textContent = text; node.classList.remove('decoding'); }
  };
  requestAnimationFrame(step);
}

/* ---------- UI sound (off by default). Synthesized, no assets. ---------- */
let actx = null;
export function tick(kind = 'tap') {
  if (!state.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    const f = { tap: 1800, ok: 1200, open: 600, alert: 320 }[kind] || 1800;
    o.type = kind === 'open' ? 'sine' : 'square';
    o.frequency.setValueAtTime(f, actx.currentTime);
    if (kind === 'ok') o.frequency.exponentialRampToValueAtTime(f * 1.6, actx.currentTime + .06);
    g.gain.setValueAtTime(.035, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + (kind === 'open' ? .18 : .05));
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + .2);
  } catch { /* audio unavailable */ }
}

/* ---------- toasts ---------- */
let host = null;
export function toast(msg, tone = 'signal') {
  host = host || document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
  const t = h('div.toast', { style: { '--c': `var(--${tone})` } }, msg);
  host.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 3200);
}
