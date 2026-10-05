import { h } from '../core/dom.js';
import { state, save, notify } from '../core/store.js';
import { todayKey, keyOffset, mondayKeyOf, parseKey, isoWeek, fmt, pad2, dateKey, uid } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, seg, iconBtn, check, removeBtn, empty, chip } from '../components/ui.js';
import { agendaFor, dueTasksOn, SOURCE_COLORS } from '../core/agenda.js';
import { ensureCalRange } from '../core/calendar-sync.js';
import { createChronosphere } from '../components/chronosphere.js';
import { addTask } from '../core/model.js';
import { toast } from '../core/fx.js';
import * as chrono from 'chrono-node';

const DAY_START = 6 * 60, DAY_END = 24 * 60, HOUR_PX = 52;
let mode = matchMedia('(max-width: 860px)').matches ? 'day' : 'week';   // week | day | planner — phones start on Day
let anchor = todayKey();    // any day inside the shown range
let selected = null;        // event detail
let clock = null;

const y = min => (min - DAY_START) / 60 * HOUR_PX;

/* Lay out overlapping timed items into side-by-side lanes. */
function lanes(items) {
  const timed = items.filter(i => i.start != null).sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex(end => end <= it.start);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = it.end; it._col = c;
    }
    cluster.forEach(it => { it._cols = cols.length; });
    cluster = [];
  };
  for (const it of timed) {
    if (it.start >= clusterEnd && cluster.length) flush();
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return timed;
}

function eventBlock(it) {
  const top = Math.max(0, y(it.start)), height = Math.max(20, y(Math.min(it.end, DAY_END)) - top - 2);
  const w = 100 / it._cols;
  return h('button.ev-block' + (it.kind === 'plan' && it.done ? '.done' : '') + (height < 34 ? '.short' : ''), {
    type: 'button',
    style: { top: top + 'px', height: height + 'px', left: `calc(${it._col * w}% + 2px)`, width: `calc(${w}% - 4px)`, '--c': it.color },
    onclick: e => { e.stopPropagation(); selected = it; notify(); }
  },
    h('span.ev-title', it.title),
    height >= 34 ? h('span.ev-time', `${it.time}${it.end ? '–' + pad2(Math.floor(it.end / 60) % 24) + ':' + pad2(it.end % 60) : ''}${it.location ? ' · ' + it.location : ''}`) : null);
}

function timeGrid(days) {
  const tk = todayKey();
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const hours = [];
  for (let m = DAY_START; m < DAY_END; m += 60) hours.push(m);
  const head = h('div.cg-head', h('div.cg-corner', h('span.micro', 'KW ' + isoWeek(parseKey(days[0])))),
    days.map(dk => h('div.cg-day' + (dk === tk ? '.today' : ''), h('span.cg-wd', fmt.weekday(dk)), h('span.cg-dn', String(parseKey(dk).getDate())))));
  const allDay = h('div.cg-allday', h('div.cg-corner', h('span.micro', 'all day')),
    days.map(dk => h('div.cg-ad-cell',
      agendaFor(dk).filter(i => i.allDay).map(i => h('button.ad-pill', { type: 'button', style: { '--c': i.color }, onclick: () => { selected = i; notify(); } }, i.title)),
      dueTasksOn(dk).map(t => h('div.ad-pill.task' + (t.done ? '.done' : ''), { style: { '--c': SOURCE_COLORS.todo } }, '☐ ' + t.title)))));
  const gutter = h('div.cg-gutter', hours.map(m => h('div.cg-hour', { style: { top: y(m) + 'px' } }, h('span', pad2(m / 60)))));
  const cols = days.map(dk => {
    const col = h('div.cg-col' + (dk === tk ? '.today' : ''), {
      ondblclick: e => {
        const rect = col.getBoundingClientRect();
        const min = Math.round((DAY_START + (e.clientY - rect.top) / HOUR_PX * 60) / 15) * 15;
        const title = prompt(`New block on ${fmt.short(dk)} at ${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`);
        if (title) addBlock(dk, `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`, title);
      }
    });
    hours.forEach(m => col.append(h('div.cg-line', { style: { top: y(m) + 'px' } })));
    lanes(agendaFor(dk)).forEach(it => { if (it.end > DAY_START) col.append(eventBlock(it)); });
    if (dk === tk && nowMin >= DAY_START) col.append(h('div.now-line', { style: { top: y(nowMin) + 'px' } }, h('span.now-pill', pad2(now.getHours()) + ':' + pad2(now.getMinutes()))));
    return col;
  });
  const body = h('div.cg-body', { style: { height: y(DAY_END) + 'px' } }, gutter, h('div.cg-cols', { style: { '--n': days.length } }, cols));
  // one scroller for both axes: the day header sticks to the top, the hour gutter to the left
  // (on phones the week is wider than the screen and scrolls sideways, day by day)
  const scroller = h('div.cg-scroll', h('div.cg-top', head, allDay), body);
  requestAnimationFrame(() => {
    scroller.scrollTop = Math.max(0, y(Math.max(DAY_START, Math.min(nowMin, 22 * 60)) - 90));
    const today = scroller.querySelector('.cg-col.today');
    if (today) scroller.scrollLeft = today.offsetLeft;
  });
  return h('div.cal-grid' + (days.length > 1 ? '.multi' : ''), { style: { '--n': days.length } }, scroller);
}

function addBlock(dk, time, title) {
  if (!state.dayplan[dk]) state.dayplan[dk] = [];
  state.dayplan[dk].push({ id: uid(), time, label: title, done: false });
  save();
}

/* Natural language: "Lunch with Ana fri 13:00", "Call Mia tomorrow 9am for 30 min", "Pay rent on the 1st" (no time → task). */
function quickAdd(text) {
  const res = chrono.en.GB.parse(text, new Date(), { forwardDate: true })[0];
  if (!res) { addTask(text); toast('Added as a task'); return; }
  const title = (text.slice(0, res.index) + text.slice(res.index + res.text.length)).replace(/\s+/g, ' ').replace(/\s(at|on|for)$/i, '').trim() || text;
  const s = res.start.date();
  const dk = dateKey(s);
  if (res.start.isCertain('hour')) {
    const time = pad2(s.getHours()) + ':' + pad2(s.getMinutes());
    if (!state.dayplan[dk]) state.dayplan[dk] = [];
    const block = { id: uid(), time, label: title, done: false };
    if (res.end) block.end = pad2(res.end.date().getHours()) + ':' + pad2(res.end.date().getMinutes());
    state.dayplan[dk].push(block);
    save();
    toast(`Planned “${title}” · ${fmt.short(dk)} ${time}`);
  } else {
    addTask(title, 'med', { due: dk });
    toast(`Task “${title}” due ${fmt.short(dk)}`);
  }
  anchor = dk;
}

function detail() {
  if (!selected) return null;
  const it = selected;
  const close = () => { selected = null; notify(); };
  return panel({ title: it.title, cls: 'ev-detail', style: { '--c': it.color }, actions: [iconBtn('x', 'Close', close, 'sm ghost')] },
    h('div.rows',
      h('div.row', h('span.micro', 'When'), h('div.grow.data', it.allDay ? 'All day' : `${it.time}${it.end ? ' – ' + pad2(Math.floor(it.end / 60) % 24) + ':' + pad2(it.end % 60) : ''}`)),
      h('div.row', h('span.micro', 'Source'), h('div.grow', it.kind === 'plan' ? 'Agentic OS plan block' : it.kind === 'lesson' ? 'School (Fuxam)' : (it.calendar || 'Calendar') + (it.account ? ' · ' + it.account : ''))),
      it.location ? h('div.row', h('span.micro', 'Where'), h('div.grow', it.location)) : null),
    h('div.input-row', { style: { marginTop: '12px' } },
      it.kind === 'plan' ? h('button.btn', { type: 'button', onclick: () => { it.ref.done = !it.ref.done; save(); close(); } }, it.done ? 'Mark not done' : 'Mark done') : null,
      it.kind === 'plan' ? h('button.btn.danger', { type: 'button', onclick: () => { for (const k of Object.keys(state.dayplan)) state.dayplan[k] = state.dayplan[k].filter(b => b.id !== it.id); save(); close(); } }, 'Delete') : null,
      it.link ? h('a.btn', { href: it.link, target: '_blank', rel: 'noopener' }, 'Open in Google Calendar') : null));
}

function planner(monKey) {
  const tk = todayKey();
  const focus = h('input.field', { value: state.weekFocus[monKey] || '', placeholder: 'Focus of the week', 'aria-label': 'Focus of the week',
    oninput: e => { state.weekFocus[monKey] = e.target.value; save(); } });
  const board = h('div.week-board');
  for (let i = 0; i < 7; i++) {
    const dk = keyOffset(monKey, i);
    const items = state.weekplan[dk] || [];
    const input = h('input.field.sm', { placeholder: '+ add', 'aria-label': 'Add to ' + fmt.short(dk),
      onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { (state.weekplan[dk] = state.weekplan[dk] || []).push({ id: uid(), label: e.target.value.trim(), done: false }); e.target.value = ''; save(); } } });
    board.append(h('div.wb-day' + (dk === tk ? '.today' : ''),
      h('div.wb-head', h('span', fmt.weekday(dk)), h('span.data.muted', fmt.short(dk))),
      h('div.rows', items.map((it, idx) => h('div.row' + (it.done ? '.done' : ''),
        check(it.done, () => { it.done = !it.done; save(); }), h('div.grow', h('div.title', it.label)), removeBtn(() => { items.splice(idx, 1); save(); })))),
      input));
  }
  return panel({ title: 'Week planner', readout: 'loose to-dos per day' }, focus, h('div', { style: { height: '14px' } }), board);
}

export default {
  id: 'calendar',
  render(root) {
    const mon = mondayKeyOf(parseKey(anchor));
    ensureCalRange(mon);
    const days = mode === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => keyOffset(mon, i));
    const step = mode === 'day' ? 1 : 7;
    const rangeLabel = mode === 'day' ? fmt.long(parseKey(anchor)) : `${fmt.short(days[0])} – ${fmt.short(days[6])}`;
    const qa = h('input.field.qa', { placeholder: 'Quick add: “Lunch with Ana fri 13:00” or “Submit essay next Monday”', 'aria-label': 'Quick add',
      onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value.trim(); e.target.value = ''; quickAdd(v); } } });

    const legend = h('div.cal-legend',
      chip('Plan blocks', null, 'plain'), chip('Lessons', null, 'plain'), chip('Google', null, 'plain'));
    [...legend.children].forEach((c, i) => { c.classList.remove('plain'); c.style.setProperty('--c', [SOURCE_COLORS.plan, SOURCE_COLORS.lesson, SOURCE_COLORS.event][i]); });

    let side = null;
    if (mode === 'day') {
      clock = createChronosphere({ lat: state.settings.home.lat, lon: state.settings.home.lon, size: 340 });
      clock.update({ events: agendaFor(anchor).filter(a => a.start != null && !a.allDay).map(a => ({ start: a.start, end: a.end ?? a.start + 60, color: a.color, title: a.title, time: a.time })) });
      side = h('div.cal-side', panel({ cls: 'quiet' }, clock.el));
    }

    root.append(h('div.view.calendar',
      viewHead('Calendar', state.gcal.connected ? 'Google calendars, school lessons and your plan in one place.' : 'Your plan blocks. Connect Google and Fuxam in Settings to see lessons and meetings.',
        seg([{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'planner', label: 'Planner' }], mode, v => { mode = v; notify(); }, 'View'),
        iconBtn('left', 'Previous', () => { anchor = keyOffset(anchor, -step); notify(); }),
        h('button.btn', { type: 'button', onclick: () => { anchor = todayKey(); notify(); } }, 'Today'),
        iconBtn('right', 'Next', () => { anchor = keyOffset(anchor, step); notify(); })),
      h('div.cal-bar', h('span.cal-range', rangeLabel), qa, legend),
      mode === 'planner'
        ? planner(mon)
        : h('div.cal-layout' + (side ? '.with-side' : ''), panel({ cls: 'flush cal-panel' }, timeGrid(days)), side),
      detail()));
  },
  unmount() { if (clock) { clock.destroy(); clock = null; } }
};
