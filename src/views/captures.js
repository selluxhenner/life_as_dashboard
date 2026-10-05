// Captures: dump everything, sort it later.
// Top: a brain-dump box (one capture per line). Middle: a sorter that shows the oldest unsorted
// capture with one-key choices. Bottom: every capture, filterable by what it became.
import { h } from '../core/dom.js';
import { state } from '../core/store.js';
import { todayKey, keyOffset, fmt, parseKey } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, seg, select, empty, chip, removeBtn } from '../components/ui.js';
import { icon } from '../core/icons.js';
import { tick, toast } from '../core/fx.js';
import {
  TYPES, typeOf, HORIZONS, liveCaptures, unsorted, captureText, suggestType, updateCapture, setType,
  archiveCapture, deleteCapture, meetingLink, isDone
} from '../features/capture/captures.js';
import { PRIORITIES } from '../core/model.js';
import { render } from '../core/router.js';
import { isPhone } from '../core/platform.js';

let filter = 'all';
let sort = 'new';
let query = '';
let editingId = null;
const skipped = new Set();
let keyHandler = null;

const FILTERS = [
  { value: 'all', label: 'All', test: c => !c.archived },
  { value: 'none', label: 'Unsorted', test: c => !c.archived && c.type === 'none' },
  { value: 'note', label: 'Notes', test: c => !c.archived && c.type === 'note' },
  { value: 'task', label: 'Tasks', test: c => !c.archived && c.type === 'task' },
  { value: 'habit', label: 'Habits', test: c => !c.archived && c.type === 'habit' },
  { value: 'goal', label: 'Goals', test: c => !c.archived && c.type === 'goal' },
  { value: 'cal', label: 'Calendar', test: c => !c.archived && (c.type === 'event' || c.type === 'meeting') },
  { value: 'archived', label: 'Archived', test: c => c.archived }
];
const SORTS = [
  { value: 'new', label: 'Newest first' },
  { value: 'old', label: 'Oldest first' },
  { value: 'date', label: 'By date' },
  { value: 'type', label: 'By type' }
];

const dayLabel = dk => dk === todayKey() ? 'Today' : dk === keyOffset(todayKey(), -1) ? 'Yesterday' : dk === keyOffset(todayKey(), 1) ? 'Tomorrow' : fmt.weekday(dk) + ' ' + fmt.short(dk);
const createdKey = c => { const d = new Date(c.createdAt); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* ---------- dump box ---------- */
function dumpBox() {
  const ta = h('textarea.field.dump', {
    rows: 3, 'aria-label': 'Brain dump',
    placeholder: isPhone() ? 'Write a note…' : 'Brain dump. One thought per line, sort later.\nDates like “Fri 15:00” or “tomorrow” are picked up.'
  });
  const submit = () => {
    if (!ta.value.trim()) { ta.focus(); return; }
    const made = captureText(ta.value, { from: 'captures' });
    ta.value = '';
    tick('ok');
    toast(made.length === 1 ? 'Captured' : made.length + ' captures added', 'pulse');
    requestAnimationFrame(() => { const again = document.querySelector('textarea[aria-label="Brain dump"]'); again && again.focus(); });
  };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  return panel({ title: 'Capture', cls: 'dump-panel', readout: 'Enter saves · Shift+Enter new line' },
    ta, h('div.dump-foot', h('span.hint', isPhone() ? 'Dates like “Fri 15:00” are picked up.' : 'Paste a whole list: every line becomes its own capture.'), h('button.btn.primary', { type: 'button', onclick: submit }, icon('plus'), isPhone() ? 'Save' : 'Capture')));
}

/* ---------- sorter ---------- */
function nextToSort() {
  const list = unsorted().slice().sort((a, b) => a.createdAt - b.createdAt);
  return list.find(c => !skipped.has(c.id)) || (skipped.clear(), list[0]) || null;
}
function sorter() {
  const left = unsorted().length;
  const c = nextToSort();
  if (!c) return null;
  const sug = suggestType(c);
  const pick = type => { tick('ok'); setType(c, type); };
  return panel({ title: 'Sort', cls: 'sorter', readout: h('span', h('b', String(left)), ' unsorted') },
    h('div.sorter-text', c.text),
    h('div.sorter-meta', 'captured ' + fmt.ago(c.createdAt), c.date ? ' · ' + dayLabel(c.date) + (c.time ? ' ' + c.time : '') : '', sug ? h('span.sug', ' · looks like a ' + typeOf(sug).label.toLowerCase()) : null),
    h('div.sorter-btns',
      TYPES.filter(t => t.key !== 'none').map(t => h('button.type-btn' + (t.key === sug ? '.suggested' : ''), { type: 'button', style: { '--c': t.color }, onclick: () => pick(t.key) },
        h('i'), t.label, h('kbd', t.hot))),
      h('span.grow'),
      h('button.btn.sm.ghost', { type: 'button', onclick: () => { skipped.add(c.id); tick(); render(); } }, 'Skip', h('kbd', 'S')),
      h('button.btn.sm.ghost', { type: 'button', onclick: () => archiveCapture(c) }, 'Archive', h('kbd', 'A'))));
}

function bindKeys() {
  keyHandler = e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && a.matches('input, textarea, select, [contenteditable]')) return;
    const c = nextToSort();
    if (!c) return;
    const k = e.key.toUpperCase();
    const t = TYPES.find(x => x.hot === k && x.key !== 'none');
    if (t) { e.preventDefault(); tick('ok'); setType(c, t.key); }
    else if (k === 'A') { e.preventDefault(); archiveCapture(c); }
    else if (k === 'S') { e.preventDefault(); skipped.add(c.id); render(); }
  };
  window.addEventListener('keydown', keyHandler);
}

/* ---------- list ---------- */
function typeSelect(c) {
  const t = typeOf(c.type);
  return h('label.type-pick', { style: { '--c': t.color } }, h('i'),
    h('select', { 'aria-label': 'Type of ' + c.text, onchange: e => setType(c, e.target.value) },
      TYPES.map(x => h('option', { value: x.key, selected: x.key === c.type }, x.label))));
}

function fields(c) {
  const date = h('input.field.sm', { type: 'date', value: c.date || '', 'aria-label': 'Date for ' + c.text, onchange: e => updateCapture(c, { date: e.target.value }) });
  const time = h('input.field.sm', { type: 'time', value: c.time || '', 'aria-label': 'Time for ' + c.text, onchange: e => updateCapture(c, { time: e.target.value }) });
  if (c.type === 'task') return [date, select(PRIORITIES.map(p => ({ value: p.key, label: p.label })), c.priority || 'med', v => updateCapture(c, { priority: v }), 'Priority', 'field sm')];
  if (c.type === 'goal') return [select(HORIZONS, c.horizon || 'woche', v => updateCapture(c, { horizon: v }), 'Goal horizon', 'field sm')];
  if (c.type === 'event' || c.type === 'meeting') return [date, time];
  if (c.type === 'habit') return [];
  return [date];
}

function row(c) {
  const t = typeOf(c.type);
  const done = isDone(c);
  const sug = c.type === 'none' ? suggestType(c) : null;
  const text = editingId === c.id
    ? h('input.field.sm.cap-edit', { value: c.text, 'aria-label': 'Edit capture', onkeydown: e => {
        if (e.key === 'Enter') { const v = e.target.value.trim(); editingId = null; if (v) updateCapture(c, { text: v }); else render(); }
        if (e.key === 'Escape') { editingId = null; render(); }
      }, onblur: e => { if (editingId !== c.id) return; const v = e.target.value.trim(); editingId = null; if (v && v !== c.text) updateCapture(c, { text: v }); else render(); } })
    : h('button.cap-text', { type: 'button', title: 'Click to edit', onclick: () => { editingId = c.id; render(); requestAnimationFrame(() => { const i = document.querySelector('.cap-edit'); i && i.focus(); }); } }, c.text);
  const needsDate = (c.type === 'event' || c.type === 'meeting') && !c.date;
  return h('div.cap-row' + (done ? '.done' : '') + (c.archived ? '.archived' : ''), { style: { '--c': t.color } },
    typeSelect(c),
    h('div.cap-main', text,
      h('div.cap-meta',
        h('span', fmt.ago(c.createdAt)),
        c.date ? h('span', (c.type === 'task' ? 'due ' : '') + dayLabel(c.date) + (c.time ? ' ' + c.time : '')) : null,
        c.type === 'goal' ? h('span', 'goal · ' + HORIZONS.find(x => x.value === c.horizon).label.toLowerCase()) : null,
        c.ref && c.ref.kind === 'plan' ? h('span.on-cal', '● in calendar') : null,
        done ? chip('done', 'ok') : null,
        needsDate ? chip('pick a date', 'warn') : null,
        sug ? h('button.sug-btn', { type: 'button', onclick: () => setType(c, sug) }, '→ ' + typeOf(sug).label + '?') : null)),
    h('div.cap-fields', fields(c)),
    h('div.cap-actions',
      c.type === 'meeting' ? h('a.btn.sm', { href: meetingLink(c), target: '_blank', rel: 'noopener', title: 'Open Google Calendar to add guests and send the invite' }, 'Invite', icon('ext')) : null,
      h('button.btn.icon.sm.ghost', { type: 'button', 'aria-label': c.archived ? 'Restore' : 'Archive', title: c.archived ? 'Restore' : 'Archive', onclick: () => archiveCapture(c, !c.archived) }, icon(c.archived ? 'reset' : 'archive')),
      removeBtn(() => { deleteCapture(c); toast('Capture deleted'); }, 'Delete capture')));
}

function grouped(list) {
  const groups = new Map();
  const add = (k, label, c) => { if (!groups.has(k)) groups.set(k, { label, items: [] }); groups.get(k).items.push(c); };
  if (sort === 'type') {
    list.sort((a, b) => TYPES.findIndex(t => t.key === a.type) - TYPES.findIndex(t => t.key === b.type) || b.createdAt - a.createdAt)
      .forEach(c => add(c.type, typeOf(c.type).label, c));
  } else if (sort === 'date') {
    list.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '').localeCompare(b.time || ''))
      .forEach(c => add(c.date || 'none', c.date ? dayLabel(c.date) : 'No date', c));
  } else {
    list.sort((a, b) => sort === 'old' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
      .forEach(c => { const k = createdKey(c); add(k, 'Captured ' + dayLabel(k).replace(/^(Today|Yesterday)$/, s => s.toLowerCase()), c); });
  }
  return [...groups.values()];
}

function listPanel() {
  const f = FILTERS.find(x => x.value === filter);
  const q = query.trim().toLowerCase();
  const list = state.captures.filter(f.test).filter(c => !q || c.text.toLowerCase().includes(q));
  const body = h('div.cap-list');
  if (!list.length) body.append(empty(q ? 'Nothing matches' : filter === 'all' ? 'Nothing captured yet' : 'Nothing here', q ? 'Try another word.' : 'Write anything in the box above. Sort it whenever you have a minute.'));
  for (const g of grouped(list)) body.append(h('div.cap-group', h('div.cap-group-h.micro', g.label, h('span', String(g.items.length))), g.items.map(row)));
  const search = h('input.field.sm.cap-search', { type: 'search', value: query, placeholder: 'Search captures', 'aria-label': 'Search captures', oninput: e => { query = e.target.value; render(); } });
  return panel({ title: 'Everything captured', readout: h('span', h('b', String(liveCaptures().length)), ' total') },
    h('div.cap-toolbar',
      seg(FILTERS.map(x => ({ value: x.value, label: x.label + ' ' + state.captures.filter(x.test).length })), filter, v => { filter = v; render(); }, 'Filter'),
      h('div.cap-tools', search, select(SORTS, sort, v => { sort = v; render(); }, 'Sort', 'field sm narrow'))),
    body);
}

export default {
  id: 'captures',
  render(root) {
    const s = sorter();
    root.append(h('div.view.captures',
      isPhone() ? viewHead('Notes', 'Write it down now. Sort it later.')
        : viewHead('Captures', 'Write everything down first. Decide later if it’s a note, task, habit, goal or meeting.'),
      h('div.cap-top' + (s ? '' : '.solo'), dumpBox(), s),
      listPanel()));
    bindKeys();
  },
  unmount() { if (keyHandler) window.removeEventListener('keydown', keyHandler); keyHandler = null; }
};
