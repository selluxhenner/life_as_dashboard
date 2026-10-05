// Full-page details for a habit or a task (opened from Today and Home, see components/detail.js).
import { h } from '../core/dom.js';
import { state, save } from '../core/store.js';
import { todayKey, keyOffset, parseKey, mondayKeyOf, fmt } from '../core/dates.js';
import { openDetail, closeDetail } from '../components/detail.js';
import { check, seg, chip } from '../components/ui.js';
import { dropdown, datePicker, friendlyDate, confirmDelete } from '../components/overlay.js';
import { icon } from '../core/icons.js';
import { tick, toast } from '../core/fx.js';
import {
  currentStreak, bestStreak, weekCount, toggleHabit, deleteHabit,
  updateTask, deleteTask, PRIORITIES
} from '../core/model.js';

const PRIO_COLOR = { high: 'var(--flare)', med: 'var(--amber)', low: 'var(--ink-3)' };
const stat = (k, v, small) => h('div.stat', h('div.k', k), h('div.v', v, small ? h('small', small) : null));
const section = (title, ...children) => h('section.detail-sec', h('h3.micro', title), ...children);
const fieldRow = (label, control, hint) => h('div.detail-field', h('div', h('div.title', label), hint ? h('div.sub', hint) : null), control);

/* ---------- habit ---------- */

export function openHabit(hb, from) {
  openDetail({ from, key: 'habit:' + hb.id, label: hb.label, render: () => habitBody(hb.id) });
}

/* 26 weeks of days, Monday rows, clickable. */
function heatmap(hb) {
  const tk = todayKey();
  const start = keyOffset(mondayKeyOf(parseKey(tk)), -25 * 7);
  const months = h('div.hm-months');
  const grid = h('div.hm-grid', { role: 'group', 'aria-label': 'History, last 26 weeks' });
  let lastMonth = -1;
  for (let w = 0; w < 26; w++) {
    const mon = keyOffset(start, w * 7);
    const m = parseKey(mon).getMonth();
    months.append(h('span', m !== lastMonth ? parseKey(mon).toLocaleDateString('en-GB', { month: 'short' }) : ''));
    lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const dk = keyOffset(mon, d);
      const future = dk > tk;
      grid.append(h('button.hm-day' + (hb.history[dk] ? '.on' : '') + (dk === tk ? '.today' : ''), {
        type: 'button', disabled: future, 'aria-pressed': String(!!hb.history[dk]),
        title: friendlyDate(dk) + (hb.history[dk] ? ' · done' : ''), 'aria-label': friendlyDate(dk),
        style: { gridColumn: w + 1, gridRow: d + 1 },
        onclick: () => { tick(hb.history[dk] ? 'tap' : 'ok'); toggleHabit(hb, dk); }
      }));
    }
  }
  return h('div.heatmap', h('div.hm-wd', ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map(d => h('span', d))), h('div.hm-main', months, grid));
}

function habitBody(id) {
  const hb = state.habits.find(x => x.id === id);
  if (!hb) return [h('div.empty', h('b', 'This habit was deleted.'))];
  const tk = todayKey();
  const weekly = hb.mode === 'weekly';
  const days30 = Array.from({ length: 30 }, (_, i) => keyOffset(tk, -i));
  const rate = Math.round(days30.filter(d => hb.history[d]).length / 30 * 100);
  const total = Object.values(hb.history).filter(Boolean).length;
  const set = patch => { Object.assign(hb, patch); save(); };

  return [
    h('header.detail-head',
      h('input.detail-emoji', { value: hb.icon || '◆', maxLength: 4, 'aria-label': 'Icon (emoji)', title: 'Icon: type or paste an emoji',
        onchange: e => set({ icon: e.target.value.trim() || '◆' }) }),
      h('div.grow',
        h('input.detail-title', { value: hb.label, 'aria-label': 'Habit name', onchange: e => { const v = e.target.value.trim(); if (v) set({ label: v }); } }),
        h('input.detail-sub', { value: hb.sub || '', placeholder: 'What counts? e.g. “At least 20 minutes”', 'aria-label': 'Description', onchange: e => set({ sub: e.target.value.trim() }) })),
      h('button.btn.detail-today' + (hb.history[tk] ? '.primary' : ''), { type: 'button', onclick: () => { tick(hb.history[tk] ? 'tap' : 'ok'); toggleHabit(hb); } },
        icon('check'), hb.history[tk] ? 'Done today' : 'Mark done today')),
    h('div.detail-stats',
      weekly ? stat('This week', String(weekCount(hb, tk)), '/ ' + (hb.target || 1)) : stat('Current streak', String(currentStreak(hb)), 'days'),
      stat('Best streak', String(bestStreak(hb.history)), 'days'),
      stat('Last 30 days', rate + '%'),
      stat('Done in total', String(total), total === 1 ? 'time' : 'times')),
    section('History', h('div.hint', 'Click a day to tick or untick it.'), heatmap(hb)),
    section('Settings',
      fieldRow('Frequency', seg([{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Times per week' }], hb.mode || 'daily', v => set({ mode: v, target: v === 'weekly' ? hb.target || 3 : hb.target }), 'Frequency'),
        weekly ? 'Counts toward a weekly target instead of a daily streak.' : 'Builds a streak: one tick per day.'),
      weekly ? fieldRow('Target per week', h('div.stepper',
        h('button.btn.icon.sm', { type: 'button', 'aria-label': 'Fewer', disabled: (hb.target || 1) <= 1, onclick: () => set({ target: Math.max(1, (hb.target || 1) - 1) }) }, '−'),
        h('span.data', String(hb.target || 1)),
        h('button.btn.icon.sm', { type: 'button', 'aria-label': 'More', disabled: (hb.target || 1) >= 7, onclick: () => set({ target: Math.min(7, (hb.target || 1) + 1) }) }, '+'))) : null,
      hb.createdAt ? fieldRow('Tracking since', h('span.data.muted', friendlyDate(hb.createdAt))) : null),
    h('footer.detail-foot',
      h('button.btn.danger', { type: 'button', onclick: () => confirmDelete(hb.label, () => { closeDetail(); deleteHabit(hb); toast('Habit deleted'); }, { kind: 'habit', detail: 'Its whole history goes with it, on all your devices. This can’t be undone.' }) }, icon('trash'), 'Delete habit'))
  ];
}

/* ---------- task ---------- */

export function openTask(t, from) {
  openDetail({ from, key: 'task:' + t.id, label: t.title, render: () => taskBody(t.id) });
}

function taskBody(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t.deleted) return [h('div.empty', h('b', 'This task was deleted.'))];
  const notes = h('textarea.field.detail-notes', { rows: 8, placeholder: 'Notes, links, next steps…', 'aria-label': 'Notes',
    oninput: e => { t.notes = e.target.value; }, onchange: e => updateTask(t, { notes: e.target.value }) }, t.notes || '');
  return [
    h('header.detail-head',
      check(t.done, () => updateTask(t, { done: !t.done }), t.done ? 'Mark not done' : 'Complete task'),
      h('div.grow',
        h('input.detail-title' + (t.done ? '.done' : ''), { value: t.title, 'aria-label': 'Task', onchange: e => { const v = e.target.value.trim(); if (v) updateTask(t, { title: v }); } }),
        h('div.detail-meta', 'created ' + fmt.ago(t.createdAt), t.done && t.completedAt ? ' · done ' + fmt.ago(t.completedAt) : '', t.source && t.source !== 'app' ? h('span', ' · from ', chip(t.source, 'plain')) : null))),
    h('div.detail-grid',
      fieldRow('Priority', dropdown({ options: PRIORITIES.map(p => ({ value: p.key, label: p.label, color: PRIO_COLOR[p.key] })), value: t.priority, onChange: v => updateTask(t, { priority: v }), label: 'Priority' })),
      fieldRow('Due', datePicker({ value: t.due, onChange: v => updateTask(t, { due: v }), label: 'Due date', placeholder: 'No due date' }),
        t.due && t.due < todayKey() && !t.done ? h('span', { style: { color: 'var(--flare)' } }, 'Overdue') : null)),
    section('Notes', notes),
    h('footer.detail-foot',
      h('button.btn', { type: 'button', onclick: () => updateTask(t, { done: !t.done }) }, icon('check'), t.done ? 'Reopen' : 'Complete'),
      h('span.grow'),
      h('button.btn.danger', { type: 'button', onclick: () => confirmDelete(t.title, () => { closeDetail(); deleteTask(t); toast('Task deleted'); }, { kind: 'task' }) }, icon('trash'), 'Delete task'))
  ];
}
