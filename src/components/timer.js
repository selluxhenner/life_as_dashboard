// 25-minute focus timer. Timer state lives at module level so it survives view re-renders.
import { h } from '../core/dom.js';
import { state } from '../core/store.js';
import { todayKey, pad2 } from '../core/dates.js';
import { completeFocusSession } from '../core/model.js';
import { panel } from './panel.js';
import { icon } from '../core/icons.js';
import { tick, toast } from '../core/fx.js';

const FOCUS = 25 * 60;
let remaining = FOCUS, interval = null, endAt = 0;
const subs = new Set();

function step() {
  remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
  if (remaining <= 0) {
    clearInterval(interval); interval = null; remaining = FOCUS;
    tick('ok');
    toast('Focus session complete. Deep work ticked off.', 'pulse');
    completeFocusSession();
  }
  subs.forEach(fn => fn());
}
const start = () => { if (interval) return; endAt = Date.now() + remaining * 1000; interval = setInterval(step, 250); subs.forEach(fn => fn()); };
const pause = () => { if (interval) { clearInterval(interval); interval = null; } subs.forEach(fn => fn()); };
const reset = () => { pause(); remaining = FOCUS; subs.forEach(fn => fn()); };

export function focusTimer() {
  const R = 54, C = 2 * Math.PI * R;
  const ring = h('circle.fg', { r: R, cx: 60, cy: 60, 'stroke-dasharray': C });
  const digits = h('div.timer-digits');
  const playBtn = h('button.btn.primary', { type: 'button', onclick: () => { tick(); interval ? pause() : start(); } });
  const el = panel({ title: 'Focus', readout: h('span', h('b', String(state.focus[todayKey()] || 0)), ' sessions today'), cls: 'timer' },
    h('div.timer-body',
      h('div.timer-dial',
        h('svg', { viewBox: '0 0 120 120' }, h('circle.bg', { r: R, cx: 60, cy: 60 }), ring),
        digits),
      h('div.timer-ctl', playBtn, h('button.btn.ghost', { type: 'button', onclick: () => { tick(); reset(); } }, icon('reset'), 'Reset'),
        h('div.hint', 'A finished session ticks off your deep-work habit.'))));
  const paint = () => {
    digits.textContent = pad2(Math.floor(remaining / 60)) + ':' + pad2(remaining % 60);
    ring.setAttribute('stroke-dashoffset', String(C * (remaining / FOCUS)));
    el.classList.toggle('running', !!interval);
    playBtn.replaceChildren(icon(interval ? 'pause' : 'play'), interval ? 'Pause' : remaining < FOCUS ? 'Resume' : 'Start');
  };
  paint();
  subs.add(paint);
  return { el, destroy: () => subs.delete(paint) };
}
