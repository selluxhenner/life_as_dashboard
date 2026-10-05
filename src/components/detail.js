// Full-page detail that grows out of the card you clicked and shrinks back into it when minimised.
// Used for habits and tasks. It re-renders on every store change (except while you type in it).
import { h } from '../core/dom.js';
import { subscribe } from '../core/store.js';
import { icon } from '../core/icons.js';
import { tick, reducedMotion } from '../core/fx.js';

let current = null;
export const detailOpen = () => !!current;

/**
 * openDetail({ from: Element, key, render: () => Node[] })
 * key identifies the source card, so after a re-render the detail can shrink back into its new copy.
 */
export function openDetail({ from, key, label, render }) {
  if (current) current.close(true);
  tick('open');
  const body = h('div.detail-body');
  const minimise = h('button.btn.icon.ghost.detail-min', { type: 'button', 'aria-label': 'Minimise', title: 'Minimise (Esc)', onclick: () => close() }, icon('collapse'));
  const sheet = h('div.detail', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, minimise, body);
  const wrap = h('div.detail-wrap', sheet);
  const prevFocus = document.activeElement;

  const typing = () => { const a = document.activeElement; return a && sheet.contains(a) && a.matches('input, textarea, [contenteditable]'); };
  let pending = false;
  const paint = () => {
    if (typing()) { pending = true; return; }
    pending = false;
    const y = sheet.scrollTop;
    body.replaceChildren(...[render()].flat());
    sheet.scrollTop = y;
  };
  const unsub = subscribe(() => paint());
  sheet.addEventListener('focusout', () => setTimeout(() => { if (pending && !typing()) paint(); }, 0));
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.dialog-wrap, .popover')) { e.preventDefault(); close(); } };
  const onRoute = () => close(true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onRoute);

  paint();
  document.body.append(wrap);
  document.documentElement.classList.add('detail-lock');

  // grow from the card: clip the sheet to the card's rectangle, then open the clip to the full sheet
  const clipFrom = el => {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect(), s = wrap.getBoundingClientRect();
    return `inset(${Math.max(0, r.top - s.top)}px ${Math.max(0, s.right - r.right)}px ${Math.max(0, s.bottom - r.bottom)}px ${Math.max(0, r.left - s.left)}px round 8px)`;
  };
  const start = clipFrom(from);
  if (start && !reducedMotion()) {
    wrap.animate([{ clipPath: start }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], { duration: 380, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    body.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 120, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' });
  }
  requestAnimationFrame(() => minimise.focus({ preventScroll: true }));

  function close(instant = false) {
    if (current !== api) return;
    current = null;
    unsub();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onRoute);
    document.documentElement.classList.remove('detail-lock');
    const target = key ? document.querySelector(`[data-detail="${CSS.escape(key)}"]`) : null;
    const end = !instant && !reducedMotion() ? clipFrom(target) : null;
    if (end) {
      tick('tap');
      wrap.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: end }], { duration: 300, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' })
        .finished.then(() => wrap.remove(), () => wrap.remove());
    } else if (!instant && !reducedMotion()) {
      wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished.then(() => wrap.remove(), () => wrap.remove());
    } else wrap.remove();
    const back = target || prevFocus;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }
  const api = { close };
  current = api;
  return api;
}

export function closeDetail() { if (current) current.close(); }
