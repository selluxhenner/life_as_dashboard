// Small reusable UI pieces built on h().
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { tick } from '../core/fx.js';

export function viewHead(title, sub, ...actions) {
  return h('div.view-head',
    h('div', h('h1', title), sub ? h('div.sub', sub) : null),
    actions.length ? h('div.actions', actions) : null);
}

export function check(checked, onToggle, label = 'Done') {
  const svg = h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }));
  return h('button.check', {
    type: 'button', role: 'checkbox', 'aria-checked': String(!!checked), 'aria-label': label,
    onclick: e => { e.stopPropagation(); tick(checked ? 'tap' : 'ok'); onToggle(); }
  }, svg);
}

export function removeBtn(onRemove, label = 'Remove') {
  return h('button.x', { type: 'button', 'aria-label': label, title: label, onclick: e => { e.stopPropagation(); onRemove(); } }, icon('x'));
}

export function btn(label, onclick, cls = '', iconName) {
  return h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', onclick: e => { tick(); onclick(e); } },
    iconName ? icon(iconName) : null, label);
}
export function iconBtn(iconName, label, onclick, cls = '') {
  return h('button.btn.icon' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', 'aria-label': label, title: label, onclick: e => { tick(); onclick(e); } }, icon(iconName));
}

/* Text input that calls onSubmit(value) on Enter (and via the optional button). */
export function addRow({ placeholder, onSubmit, button = 'Add', before = [], type = 'text', label }) {
  const input = h('input.field', { type, placeholder, 'aria-label': label || placeholder });
  const submit = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    input.value = '';
    onSubmit(v);
    requestAnimationFrame(() => {
      // keep typing flow: re-focus the matching input after the view re-renders
      const again = document.querySelector(`input[placeholder="${CSS.escape(placeholder)}"]`);
      again && again.focus();
    });
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); submit(); } });
  return h('div.input-row', ...before, input, button ? h('button.btn', { type: 'button', onclick: submit }, button) : null);
}

export function seg(options, value, onChange, label) {
  return h('div.seg', { role: 'group', 'aria-label': label },
    options.map(o => h('button', {
      type: 'button', 'aria-pressed': String(o.value === value),
      onclick: () => { tick(); onChange(o.value); }
    }, o.label)));
}

export function toggle(checked, onChange, label) {
  return h('label.switch', h('input', { type: 'checkbox', checked, 'aria-label': label, onchange: e => { tick(); onChange(e.target.checked); } }), h('span'));
}

export function empty(title, body, action) {
  return h('div.empty', h('b', title), body ? h('div', body) : null, action ? h('div', { style: { marginTop: '12px' } }, action) : null);
}

export function meter(value, color) {
  return h('div.meter', { role: 'meter', 'aria-valuenow': Math.round(value), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('i', { style: { '--v': Math.max(0, Math.min(100, value)) + '%', ...(color ? { '--c': color } : {}) } }));
}

export function chip(text, tone, cls = '') {
  return h('span.chip' + (tone ? '.' + tone : '') + (cls ? '.' + cls : ''), text);
}

export function select(options, value, onChange, label, cls = 'field') {
  return h('select.' + cls.trim().split(/\s+/).join('.'), { 'aria-label': label, onchange: e => onChange(e.target.value) },
    options.map(o => h('option', { value: o.value, selected: o.value === value }, o.label)));
}
