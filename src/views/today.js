import { h } from '../core/dom.js';
import { state, save, notify } from '../core/store.js';
import { todayKey, fmt, hm } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, check, removeBtn, addRow, empty, meter, chip } from '../components/ui.js';
import { dropdown, timePicker } from '../components/overlay.js';
import {
  planFor, addPlanBlock, removePlanBlock, liveTasks, addTask, toggleTask, deleteTask, PRIORITIES,
  lastDays, weekCount, currentStreak, toggleHabit, addHabit, routineFor, routineItems, trainingHabit
} from '../core/model.js';
import { agendaFor } from '../core/agenda.js';
import { phoneQuery, isPhone } from '../core/platform.js';
import { icon } from '../core/icons.js';
import { openHabit, openTask } from './details.js';

phoneQuery.addEventListener('change', () => notify());

let todoPrio = 'med';
let blockTime = null;
const PRIO_COLOR = { high: 'var(--flare)', med: 'var(--amber)', low: 'var(--ink-3)' };

function dayPlan() {
  const tk = todayKey();
  const nowS = hm(new Date());
  const items = agendaFor(tk);
  const rows = h('div.rows');
  for (const it of items) {
    if (it.kind === 'plan') {
      const b = it.ref;
      const overdue = !b.done && b.time && b.time < nowS;
      rows.append(h('div.row' + (b.done ? '.done' : '') + (overdue ? '.overdue' : ''),
        check(b.done, () => { b.done = !b.done; save(); }, 'Mark block done'),
        h('span.time', b.time || '—'),
        h('div.grow', h('div.title', b.label)),
        overdue ? chip('overdue', 'warn') : null,
        removeBtn(() => removePlanBlock(tk, b.id), 'Remove block', { what: b.label, kind: 'plan block' })));
    } else {
      rows.append(h('div.row.cal', { style: { '--c': it.color }, title: [it.calendar, it.location].filter(Boolean).join(' · ') },
        h('span.marker'),
        h('span.time', it.time || 'all day'),
        h('div.grow', h('div.title', it.title), h('div.sub', it.kind === 'lesson' ? 'Lesson' + (it.location ? ' · ' + it.location : '') : it.calendar || 'Calendar')),
        it.link ? h('a.btn.icon.sm.ghost', { href: it.link, target: '_blank', rel: 'noopener', 'aria-label': 'Open in calendar' }, '↗') : null));
    }
  }
  if (!items.length) rows.append(empty('No blocks yet', 'Give the day a shape: add your first time block below.'));
  if (blockTime === null) blockTime = nextHalfHour();
  const time = timePicker({ value: blockTime, onChange: v => { blockTime = v || ''; notify(); }, label: 'Start time' });
  time.classList.add('narrow');
  const blocks = planFor(tk);
  return panel({ title: 'Day plan', readout: h('span', h('b', `${blocks.filter(b => b.done).length}/${blocks.length}`), ' blocks') },
    rows,
    h('div', { style: { marginTop: '12px' } }, addRow({ placeholder: 'New block, e.g. Deep work on ServiWeb', before: [time], onSubmit: v => { addPlanBlock(blockTime || '', v); blockTime = null; } })));
}
function nextHalfHour() {
  const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return hm(d);
}

function habits() {
  const tk = todayKey();
  const days = lastDays(21);
  const list = h('div.habit-list');
  state.habits.forEach(hb => {
    const done = !!hb.history[tk];
    const card = h('div.habit', { dataset: { detail: 'habit:' + hb.id } },
      h('div.habit-top',
        check(done, () => toggleHabit(hb), 'Done today'),
        h('button.habit-open', { type: 'button', title: 'Open details', onclick: () => openHabit(hb, card) },
          h('span.habit-icon', hb.icon),
          h('span.grow', h('span.title', hb.label), hb.sub ? h('span.sub', hb.sub) : null),
          h('span.data.muted', hb.mode === 'weekly' ? `${weekCount(hb, tk)}/${hb.target || 1} this week` : `${currentStreak(hb)}d streak`),
          icon('expand', 'open-ico'))),
      h('div.ticks', { style: { '--c': hb.mode === 'weekly' ? 'var(--tone-samerica)' : 'var(--signal)' } },
        days.map(dk => h('i', { role: 'button', tabindex: 0, title: fmt.short(dk), 'aria-label': `${hb.label} on ${fmt.short(dk)}`, 'aria-pressed': String(!!hb.history[dk]),
          class: (hb.history[dk] ? 'on' : '') + (dk === tk ? ' today' : ''),
          onclick: () => toggleHabit(hb, dk), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHabit(hb, dk); } } }))));
    list.append(card);
  });
  const doneCount = state.habits.filter(hb => hb.history[tk]).length;
  return panel({ title: 'Habits', readout: h('span', h('b', `${doneCount}/${state.habits.length}`), ' today') },
    list, h('div', { style: { marginTop: '12px' } }, addRow({ placeholder: 'New habit', onSubmit: addHabit })));
}

function routines() {
  const tk = todayKey();
  const r = routineFor(tk);
  const items = routineItems(tk);
  const num = (label, key, unit) => {
    const val = r[key];
    const input = h('input.field.num', { type: 'number', step: '0.1', min: 0, max: 24, value: val ?? '', placeholder: '—', 'aria-label': label,
      onchange: e => { const v = parseFloat(e.target.value); r[key] = isNaN(v) ? null : v; save(); } });
    return h('div.row' + (val != null && val !== '' ? '.done-soft' : ''), check(val != null && val !== '', () => input.focus(), label), h('div.grow', h('div.title', label)), input, h('span.data.muted', unit));
  };
  const auto = (label, done, onClick) => h('div.row', check(done, onClick || (() => {}), label), h('div.grow', h('div.title', label)), chip('auto', 'plain'));
  return panel({ title: 'Routines', readout: h('span', h('b', `${items.filter(i => i.done).length}/${items.length}`), ' done') },
    h('div.micro', { style: { margin: '0 0 4px' } }, 'Morning'),
    h('div.rows',
      num('Sleep last night', 'sleep', 'h'),
      auto('Day planned', (state.dayplan[tk] || []).length > 0),
      h('div.row', check(!!r.noPhone, () => { r.noPhone = !r.noPhone; save(); }, 'No phone first 30 min'), h('div.grow', h('div.title', 'No phone for the first 30 min')))),
    h('div.micro', { style: { margin: '14px 0 4px' } }, 'Evening'),
    h('div.rows',
      num('Screen time today', 'screen', 'h')));
}

function fitness() {
  const f = state.fitness;
  const th = trainingHabit();
  const pctW = Math.max(0, Math.min(100, (f.weight - f.start) / (f.goal - f.start) * 100));
  return panel({ title: 'Weight & training', readout: `goal ${f.goal} kg` },
    h('div.grid.g-2',
      h('div.stat', h('div.k', 'Training this week'), h('div.v', th ? `${weekCount(th, todayKey())}` : '—', h('small', th ? `/ ${th.target || 1}` : ''))),
      h('div.stat', h('div.k', 'Weight (kg)'),
        h('input.field.weight', { type: 'number', step: '0.1', value: f.weight.toFixed(1), 'aria-label': 'Weight in kg',
          onchange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { f.weight = v; save(); } } }))),
    h('div', { style: { marginTop: '14px' } }, meter(pctW, 'var(--tone-samerica)')),
    h('div.hint', `${f.weight.toFixed(1)} → ${f.goal} kg · ${Math.max(0, f.goal - f.weight).toFixed(1)} kg to go`));
}

/* A task row; the title opens the full task. Shared with Home. */
export function taskRow(t, { compact = false } = {}) {
  const row = h('div.row.task-row' + (t.done ? '.done' : ''), { class: 'prio-' + t.priority, dataset: { detail: 'task:' + t.id } },
    check(t.done, () => toggleTask(t), 'Complete task'),
    h('button.row-open', { type: 'button', title: 'Open task', onclick: () => openTask(t, row) },
      h('span.title', t.title),
      !compact && t.due ? h('span.sub', 'due ' + fmt.short(t.due)) : null,
      !compact && t.notes ? h('span.sub.note-hint', t.notes.split('\n')[0].slice(0, 80)) : null),
    compact ? (t.priority === 'high' ? chip('high', 'alert') : t.due ? chip(fmt.short(t.due), 'plain') : null)
      : t.source && t.source !== 'app' ? chip(t.source, 'plain') : null,
    compact ? null : removeBtn(() => deleteTask(t), 'Delete task', { what: t.title }));
  return row;
}

function tasks() {
  const cols = h('div.todo-cols');
  let open = 0;
  for (const p of PRIORITIES) {
    const list = liveTasks().filter(t => t.priority === p.key).sort((a, b) => a.done - b.done);
    open += list.filter(t => !t.done).length;
    cols.append(h('div.todo-col.prio-' + p.key,
      h('div.todo-col-head', h('i'), p.label, h('span.data.muted', String(list.filter(t => !t.done).length))),
      h('div.rows', list.length ? list.map(t => taskRow(t)) : h('div.hint', 'Nothing here.'))));
  }
  return panel({ title: 'Tasks', readout: h('span', h('b', String(open)), ' open · synced') },
    cols,
    h('div', { style: { marginTop: '14px' } }, addRow({
      placeholder: 'New task, Enter to add',
      before: [dropdown({ options: PRIORITIES.map(p => ({ value: p.key, label: p.label, color: PRIO_COLOR[p.key] })), value: todoPrio, onChange: v => { todoPrio = v; notify(); }, label: 'Priority', cls: 'narrow' })],
      onSubmit: v => addTask(v, todoPrio)
    })));
}

export default {
  id: 'today',
  render(root) {
    // Phone: just the day. Plan, tasks, habits, routines. Weight stays on desktop.
    if (isPhone()) {
      root.append(h('div.view.today-phone',
        viewHead('Today', fmt.long(new Date())),
        h('div.stack', dayPlan(), tasks(), habits(), routines())));
      return;
    }
    root.append(h('div.view',
      viewHead('Today', fmt.long(new Date())),
      h('div.grid.g-today', dayPlan(), habits()),
      h('div.grid.g-2.today-row', routines(), fitness()),
      h('div', { style: { marginTop: '16px' } }, tasks())));
  }
};
