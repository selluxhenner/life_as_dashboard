// Pointer drag and drop: Home uses it to pull a capture onto Tasks, Habits or Up next.
// Pointer events instead of HTML5 drag and drop, because that one never fires inside the
// Tauri window on Windows (WebView2 keeps drops for files) and never fires for touch.
// A drop zone is any element with data-drop="<kind>"; the innermost one under the pointer wins.
import { h } from '../core/dom.js';
import { reducedMotion } from '../core/fx.js';
import { scrollRoot } from '../core/platform.js';

const THRESHOLD = 6;   // px a mouse has to travel before a press becomes a drag
const HOLD = 320;      // ms a finger has to rest on the item before it lifts
const EDGE = 64;       // px from the top/bottom edge where the page scrolls along

const zoneAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('[data-drop]'); };

/**
 * draggable(el, { label, color, hint(zone) -> string, drop(zone) })
 * Presses on buttons, links and fields inside `el` keep working; the rest of `el` is the handle.
 */
export function draggable(el, opts) {
  el.classList.add('is-draggable');
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || e.target.closest('button, a, input, select, textarea, [role="listbox"]')) return;
    session(e, el, opts);
  });
}

function session(down, el, opts) {
  const touch = down.pointerType === 'touch';
  const x0 = down.clientX, y0 = down.clientY;
  let x = x0, y = y0, dragging = false, ghost = null, note = null, zone = null, frame = 0;
  const hold = touch ? setTimeout(lift, HOLD) : 0;

  function lift() {
    dragging = true;
    note = h('span.drag-note', opts.hint(null));
    ghost = h('div.drag-ghost', { style: { '--c': opts.color } }, h('i'), h('div', h('b', opts.label), note));
    document.body.append(ghost);
    document.documentElement.classList.add('is-dragging');
    el.classList.add('drag-source');
    if (touch && navigator.vibrate) navigator.vibrate(12);
    track();
    frame = requestAnimationFrame(scroll);
  }

  function track() {
    ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const z = zoneAt(x, y);
    if (z === zone) return;
    zone?.classList.remove('drop-over');
    zone = z;
    zone?.classList.add('drop-over');
    ghost.classList.toggle('on-target', !!zone);
    ghost.style.setProperty('--c', (zone && zone.style.getPropertyValue('--drop-c')) || opts.color);
    note.textContent = opts.hint(zone);
  }

  /* Near the top or bottom edge the page scrolls, faster the closer the pointer gets. */
  function scroll() {
    const v = y < EDGE ? -(EDGE - y) : y > innerHeight - EDGE ? y - (innerHeight - EDGE) : 0;
    if (v) { scrollRoot().scrollBy(0, Math.round(v / 3)); track(); }
    frame = requestAnimationFrame(scroll);
  }

  function onMove(e) {
    if (e.pointerId !== down.pointerId) return;
    x = e.clientX; y = e.clientY;
    if (!dragging) {
      if (Math.hypot(x - x0, y - y0) < THRESHOLD) return;
      if (touch) return end();   // the finger moved before the hold: that is a scroll
      lift();
    }
    e.preventDefault();
    track();
  }
  function onUp(e) {
    if (e.pointerId !== down.pointerId) return;
    const target = dragging ? zoneAt(x, y) : null;   // fresh lookup: the view may have re-rendered meanwhile
    if (dragging) swallowClick();
    end(target);
    if (target) opts.drop(target);
  }
  const onCancel = e => { if (e.pointerId === down.pointerId) end(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); end(); } };
  const noScroll = e => { if (dragging) e.preventDefault(); };   // a lifted item moves, the page does not
  const noMenu = e => e.preventDefault();                          // long-press would open the context menu

  function end(target) {
    clearTimeout(hold);
    cancelAnimationFrame(frame);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
    removeEventListener('keydown', onKey, true);
    removeEventListener('touchmove', noScroll);
    removeEventListener('contextmenu', noMenu, true);
    zone?.classList.remove('drop-over');
    document.documentElement.classList.remove('is-dragging');
    el.classList.remove('drag-source');
    if (ghost) settle(ghost, target ? null : el);
  }

  addEventListener('pointermove', onMove, { passive: false });
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onCancel);
  addEventListener('keydown', onKey, true);
  addEventListener('touchmove', noScroll, { passive: false });
  if (touch) addEventListener('contextmenu', noMenu, true);
}

/* Dropped: the ghost sinks in place. Missed or cancelled: it flies back to where it came from. */
function settle(ghost, home) {
  if (reducedMotion()) { ghost.remove(); return; }
  const r = home && home.isConnected ? home.getBoundingClientRect() : null;
  ghost.classList.add(r ? 'returning' : 'dropped');
  if (r) ghost.style.transform = `translate3d(${r.left + 14}px, ${r.top + r.height / 2}px, 0)`;
  setTimeout(() => ghost.remove(), 220);
}

/* The click that follows the release must not open whatever sits under the pointer. */
function swallowClick() {
  const stop = e => { e.stopPropagation(); e.preventDefault(); };
  addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', stop, true), 0);
}
