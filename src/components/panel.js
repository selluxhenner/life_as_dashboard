// Panel = chamfered surface whose outline is an SVG path, so it can draw itself in.
import { h } from '../core/dom.js';

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
  for (const e of entries) layout(e.target);
}) : null;

let animateNext = false;
/* The router turns this on for the first render after a navigation, so panels draw in once, not on every update. */
export function setPanelIntro(on) { animateNext = on; }

function layout(panel) {
  const svg = panel.firstElementChild;
  if (!svg || !svg.classList || !svg.classList.contains('frame')) return;
  const w = panel.clientWidth, ht = panel.clientHeight;
  if (!w || !ht) return;
  const c = parseFloat(getComputedStyle(panel).getPropertyValue('--chamfer')) || 12;
  const [outline, b1, b2] = svg.children;
  svg.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  outline.setAttribute('d', `M.5 .5H${w - c}L${w - .5} ${c}V${ht - .5}H.5Z`);
  const L = 10;
  b1.setAttribute('d', `M.5 ${L + .5}V.5H${L + .5}`);
  b2.setAttribute('d', `M${w - L - .5} ${ht - .5}H${w - .5}V${ht - L - .5}`);
  if (panel.classList.contains('is-drawing')) {
    const len = 2 * (w + ht);
    svg.style.setProperty('--len', len);
  }
}

/**
 * panel({title, readout, cls, actions}, ...children)
 * title: string | Node, readout: string | Node (right-aligned data), actions: Node[]
 */
export function panel(opts = {}, ...children) {
  const svg = h('svg.frame', { 'aria-hidden': 'true', preserveAspectRatio: 'none' },
    h('path'), h('path.bracket'), h('path.bracket'));
  const head = (opts.title || opts.readout || opts.actions)
    ? h('header.panel-head',
        opts.title ? h('h2', opts.title) : null,
        opts.readout != null ? h('span.readout', opts.readout) : null,
        opts.actions ? h('div', { style: { display: 'flex', gap: '6px', marginLeft: opts.readout != null ? '8px' : 'auto' } }, opts.actions) : null)
    : null;
  const el = h('section.panel' + (opts.cls ? '.' + opts.cls.split(' ').join('.') : ''), { style: opts.style, 'aria-label': typeof opts.title === 'string' ? opts.title : null },
    svg, head, ...children);
  if (animateNext && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add('is-drawing');
    setTimeout(() => el.classList.remove('is-drawing'), 1400);
  }
  if (ro) ro.observe(el);
  requestAnimationFrame(() => layout(el));
  return el;
}
