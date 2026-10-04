// Command palette (Ctrl/⌘+K): jump anywhere, capture a task, ask the assistant, switch theme.
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { routeList, go } from '../core/router.js';
import { addTask } from '../core/model.js';
import { captureText } from '../features/capture/captures.js';
import { state, save } from '../core/store.js';
import { applyTheme, THEMES } from '../core/theme.js';
import { tick, toast } from '../core/fx.js';

let open = false;

function commands(q) {
  const list = [
    ...routeList().map(r => ({ label: 'Go to ' + r.label, icon: r.icon, k: r.key || '', run: () => go(r.id) })),
    ...THEMES.map(t => ({ label: 'Theme: ' + t.name, icon: 'settings', run: () => { state.settings.theme = t.id; applyTheme(t.id); save(); } }))
  ];
  if (q.trim()) {
    list.unshift({ label: `Ask assistant: “${q}”`, icon: 'agent', run: () => { sessionStorage.setItem('agenticAsk', q); go('assistant'); } });
    list.unshift({ label: `Add task: “${q}”`, icon: 'plus', run: () => { addTask(q); toast('Task added', 'pulse'); } });
    list.unshift({ label: `Capture: “${q}”`, icon: 'capture', run: () => { captureText(q, { from: 'palette' }); toast('Captured', 'pulse'); } });
  }
  const s = q.toLowerCase();
  return list.filter(c => c.label.toLowerCase().includes(s) || c.label.startsWith('Add task') || c.label.startsWith('Capture:') || c.label.startsWith('Ask'));
}

export function openPalette() {
  if (open) return;
  open = true; tick('open');
  let sel = 0, items = [];
  const input = h('input', { placeholder: 'Capture a thought, jump to a page, or run a command…', 'aria-label': 'Command', role: 'combobox', 'aria-expanded': 'true' });
  const ul = h('ul', { role: 'listbox' });
  const close = () => { open = false; wrap.remove(); };
  const paint = () => {
    items = commands(input.value);
    sel = Math.min(sel, items.length - 1);
    ul.replaceChildren(...items.map((c, i) => h('li', { role: 'option', 'aria-selected': String(i === sel), onclick: () => { close(); c.run(); }, onmousemove: () => { if (sel !== i) { sel = i; paint(); } } },
      icon(c.icon), c.label, c.k ? h('span.k', c.k) : null)));
  };
  input.addEventListener('input', () => { sel = 0; paint(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; paint(); }
    else if (e.key === 'Enter' && items[sel]) { const c = items[sel]; close(); tick('ok'); c.run(); }
    else if (e.key === 'Escape') close();
  });
  const wrap = h('div.palette-wrap', { onclick: e => { if (e.target === wrap) close(); } },
    h('div.panel.palette', { role: 'dialog', 'aria-label': 'Command palette' }, input, ul,
      h('div.foot', h('span', '↑↓ select'), h('span', '↵ run'), h('span', 'esc close'))));
  document.body.append(wrap);
  paint();
  input.focus();
}

export function initPalette() {
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });
}
