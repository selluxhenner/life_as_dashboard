// Launch sequence (~1.2 s): rings draw, a short system log types out, then the world sweeps in behind.
import { h } from '../core/dom.js';

const LINES = ['core', 'time · sun position', 'world map', 'calendar', 'inbox relay', 'agent'];

export function boot({ skip = false } = {}) {
  if (skip || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const log = h('div.log');
  const el = h('div.boot', { 'aria-hidden': 'true' },
    h('div.core',
      h('svg', { viewBox: '0 0 120 120' }, h('circle', { cx: 60, cy: 60, r: 56 }), h('circle', { cx: 60, cy: 60, r: 44 })),
      log));
  document.body.append(el);
  return new Promise(resolve => {
    LINES.forEach((l, i) => setTimeout(() => log.append(h('div', `> ${l.padEnd(22, '.')} `, h('span', 'ok'))), 120 + i * 110));
    setTimeout(() => { el.classList.add('out'); resolve(); }, 1050);
    setTimeout(() => el.remove(), 1600);
  });
}
