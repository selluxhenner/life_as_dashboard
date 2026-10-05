import { h } from '../core/dom.js';
import { state, save, notify } from '../core/store.js';
import { todayKey, pad2, fmt, parseKey } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { createChronosphere } from '../components/chronosphere.js';
import { check, empty, meter, chip } from '../components/ui.js';
import { agendaFor } from '../core/agenda.js';
import {
  liveTasks, toggleTask, weekCount, trainingHabit, dayScore,
  liveJobs, jobsAppliedThisWeek, QUOTES, toggleHabit, currentStreak
} from '../core/model.js';
import { go } from '../core/router.js';
import { decode, tick, toast } from '../core/fx.js';
import { icon } from '../core/icons.js';
import { TYPES, typeOf, liveCaptures, unsorted, captureText, setType } from '../features/capture/captures.js';
import { briefingPanel } from './briefing-panel.js';
import { worldPulsePanel } from './news.js';
import { rankCard } from '../features/points/points.js';
import { phoneQuery, isPhone } from '../core/platform.js';

let chrono = null;

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Still up' : hr < 11 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

function captureBar() {
  const input = h('input.field.capture', {
    placeholder: 'Capture anything. Sort it later.',
    'aria-label': 'Quick capture',
    onkeydown: e => { if (e.key === 'Enter' && input.value.trim()) { const v = input.value; input.value = ''; captureText(v, { from: 'home' }); tick('ok'); toast('Captured', 'pulse'); } },
    onpaste: e => {
      const t = (e.clipboardData || window.clipboardData).getData('text');
      if (!/\n/.test(t.trim())) return;   // single line: normal paste; several lines: one capture each
      e.preventDefault();
      const made = captureText(t, { from: 'home' });
      toast(made.length + ' captures added', 'pulse');
    }
  });
  const n = unsorted().length;
  return h('div.capture-bar', input,
    h('button.btn.capture-count' + (n ? '.has' : ''), { type: 'button', onclick: () => go('captures'), title: 'Open captures' },
      h('span.data', String(n)), 'to sort', icon('right')));
}

function capturesPanel() {
  const list = liveCaptures().slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const rows = h('div.rows');
  list.forEach(c => {
    const t = typeOf(c.type);
    rows.append(h('div.row.cap-mini', { style: { '--c': t.color } },
      h('label.type-pick.sm', { style: { '--c': t.color } }, h('i'),
        h('select', { 'aria-label': 'Type of ' + c.text, onchange: e => setType(c, e.target.value) }, TYPES.map(x => h('option', { value: x.key, selected: x.key === c.type }, x.label)))),
      h('div.grow', h('div.title', c.text), h('div.sub', fmt.ago(c.createdAt) + (c.date ? ' · ' + fmt.short(c.date) + (c.time ? ' ' + c.time : '') : '')))));
  });
  if (!list.length) rows.append(empty('Nothing captured', 'Type anything in the capture box. It lands here unsorted.'));
  return panel({ title: 'Captures', readout: h('span', h('b', String(unsorted().length)), ' unsorted'), actions: [h('button.btn.sm.ghost', { type: 'button', onclick: () => go('captures') }, 'Sort')] }, rows);
}

function upNext() {
  const tk = todayKey();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const items = agendaFor(tk).filter(i => !i.allDay);
  const allDay = agendaFor(tk).filter(i => i.allDay);
  const list = h('ol.timeline');
  if (!items.length) list.append(h('li.tl-empty', empty('Nothing scheduled', 'Capture “09:00 Deep work” and sort it as Calendar.')));
  for (const it of items) {
    const past = it.end != null && it.end <= nowMin;
    const live = it.start != null && it.start <= nowMin && (it.end ?? it.start + 60) > nowMin;
    list.append(h('li.tl-item' + (past ? '.past' : '') + (live ? '.live' : '') + (it.done ? '.done' : ''), { style: { '--c': it.color } },
      h('span.tl-time.data', it.time || '—'),
      h('span.tl-dot'),
      h('div.tl-body',
        h('div.tl-title', it.title),
        h('div.tl-meta', it.kind === 'plan' ? 'Plan block' : it.kind === 'lesson' ? 'Lesson' + (it.location ? ' · ' + it.location : '') : (it.calendar || 'Calendar') + (it.location ? ' · ' + it.location : ''))),
      it.kind === 'plan' ? check(it.done, () => { it.ref.done = !it.ref.done; save(); }, 'Mark block done') : null));
  }
  const nextItem = items.find(i => i.start != null && i.start >= nowMin);
  const readout = nextItem ? `next ${nextItem.time} · in ${fmtIn(nextItem.start - nowMin)}` : items.length ? 'day complete' : '';
  return panel({ title: 'Up next', readout, cls: 'up-next' },
    allDay.length ? h('div.allday', allDay.map(a => chip(a.title, null, 'plain'))) : null,
    list);
}
const fmtIn = m => m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad2(m % 60);

function tasksPanel() {
  const open = liveTasks().filter(t => !t.done).sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.priority] - { high: 0, med: 1, low: 2 }[b.priority]));
  const list = h('div.rows');
  open.slice(0, isPhone() ? 5 : 7).forEach(t => list.append(h('div.row', { class: 'prio-' + t.priority },
    check(false, () => toggleTask(t), 'Complete task'),
    h('div.grow', h('div.title', t.title)),
    t.priority === 'high' ? chip('high', 'alert') : t.due ? chip(fmt.short(t.due), 'plain') : null)));
  if (!open.length) list.append(empty('Inbox zero for tasks', 'Everything is done.'));
  return panel({ title: 'Tasks', readout: h('span', h('b', String(open.length)), ' open'), actions: [h('button.btn.sm.ghost', { type: 'button', onclick: () => go('today') }, 'All')] }, list,
    open.length > (isPhone() ? 5 : 7) ? h('div.hint', `+ ${open.length - (isPhone() ? 5 : 7)} more on Today`) : null);
}

function habitsPanel() {
  const tk = todayKey();
  const list = h('div.habit-chips');
  state.habits.forEach(hb => {
    const done = !!hb.history[tk];
    const sub = hb.mode === 'weekly' ? `${weekCount(hb, tk)}/${hb.target || 1} wk` : `${currentStreak(hb)}d`;
    list.append(h('button.habit-chip' + (done ? '.on' : ''), { type: 'button', 'aria-pressed': String(done), onclick: () => toggleHabit(hb) },
      h('span.hc-icon', hb.icon), h('span.hc-label', hb.label), h('span.hc-sub.data', sub)));
  });
  const s = dayScore();
  return panel({ title: 'Habits', readout: h('span', h('b', `${s.habits[0]}/${s.habits[1]}`), ' daily done') }, list);
}

function jobsPulse() {
  const jobs = liveJobs().filter(j => !j.archived);
  const active = jobs.filter(j => !['rejected'].includes(j.status));
  const interviews = jobs.filter(j => j.status === 'interview' || j.status === 'offer').length;
  const due = jobs.filter(j => j.nextActionDate && j.nextActionDate <= todayKey() && j.status !== 'rejected');
  return panel({ title: 'Job hunt · Berlin', actions: [h('button.btn.sm.ghost', { type: 'button', onclick: () => go('jobs') }, 'Open')] },
    h('div.grid.g-3.mini-stats',
      h('div.stat', h('div.k', 'Active'), h('div.v', String(active.length))),
      h('div.stat', h('div.k', 'Applied this week'), h('div.v', String(jobsAppliedThisWeek()), h('small', '/ 2'))),
      h('div.stat', h('div.k', 'Interviews'), h('div.v', String(interviews)))),
    due.length
      ? h('div.rows', { style: { marginTop: '12px' } }, due.slice(0, 3).map(j => h('div.row', h('div.grow', h('div.title', j.nextAction || 'Follow up'), h('div.sub', j.company)), chip(fmt.short(j.nextActionDate), j.nextActionDate < todayKey() ? 'alert' : 'warn'))))
      : h('div.hint', { style: { marginTop: '12px' } }, active.length ? 'No follow-ups due.' : 'Add the first Berlin role you want to apply for.'));
}

function principle() {
  const idx = Math.floor(parseKey(todayKey()).getTime() / 86400000) % QUOTES.length;
  const th = trainingHabit();
  return panel({ title: 'Principle of the day', cls: 'principle' },
    h('blockquote.quote', QUOTES[idx]),
    th ? h('div.fit', h('span.dim', 'Training this week'), h('span.data', `${weekCount(th, todayKey())}/${th.target || 1}`), meter(weekCount(th, todayKey()) / (th.target || 1) * 100, 'var(--tone-samerica)')) : null);
}

/* Column count follows the screen: 4 on wide monitors, 3 on laptops, 2 on small laptops, 1 on phones. */
const WIDE = matchMedia('(min-width: 1680px)');
const MID = matchMedia('(min-width: 1181px)');
const NARROW = matchMedia('(min-width: 861px)');
[WIDE, MID, NARROW, phoneQuery].forEach(q => q.addEventListener('change', () => notify()));
function columns() {
  const P = {
    upNext: upNext(), tasks: tasksPanel(), habits: habitsPanel(), captures: capturesPanel(),
    world: worldPulsePanel(), jobs: jobsPulse(), extra: state.settings.flags.points ? rankCard() : principle()
  };
  const cols = WIDE.matches ? [['upNext'], ['tasks', 'habits'], ['captures', 'jobs'], ['world', 'extra']]
    : MID.matches ? [['upNext', 'captures'], ['tasks', 'habits'], ['world', 'jobs', 'extra']]
    : NARROW.matches ? [['upNext', 'tasks', 'habits'], ['captures', 'world', 'jobs', 'extra']]
    : [['upNext', 'captures', 'tasks', 'habits', 'world', 'jobs', 'extra']];
  return h('div.grid.home-grid', { style: { '--cols': cols.length } }, cols.map(c => h('div.stack', c.map(k => P[k]))));
}

/* Phone: a short overview only. What's next, what to do, habits. Notes and Today have their own tabs. */
function phoneOverview(root) {
  const s = dayScore();
  const title = h('h1.hero-title');
  root.append(h('div.view.home.home-phone',
    h('section.phone-hero',
      title,
      h('div.hero-sub', fmt.long(new Date()) + ' · ' + state.settings.home.city, h('span.day-score.data', 'Day ' + s.score + '%'))),
    captureBar(),
    h('div.stack', upNext(), briefingPanel(), tasksPanel(), habitsPanel())));
  return title;
}

export default {
  id: 'home',
  render(root) {
    if (isPhone()) {
      const title = phoneOverview(root);
      title.textContent = greeting() + ', ' + state.name + '.';
      return;
    }
    const tk = todayKey();
    const agenda = agendaFor(tk).filter(i => !i.allDay && i.start != null);
    chrono = createChronosphere({ lat: state.settings.home.lat, lon: state.settings.home.lon, size: 400 });
    chrono.update({ events: agenda.map(a => ({ start: a.start, end: a.end ?? a.start + 60, color: a.color, title: a.title, time: a.time })) });

    const title = h('h1.hero-title');
    const s = dayScore();
    root.append(h('div.view.home',
      h('section.hero',
        h('div.hero-clock', chrono.el,
          h('div.score-readout', h('span.micro', 'Day'), h('span.data', s.score + '%'))),
        h('div.hero-side',
          h('div.hero-greet', title, h('div.hero-sub', fmt.long(new Date()) + ' · ' + state.settings.home.city)),
          captureBar(),
          briefingPanel())),
      columns()));
    const text = greeting() + ', ' + state.name + '.';
    if (!this._greeted) { decode(title, text, 520); this._greeted = true; } else title.textContent = text;
  },
  unmount() { if (chrono) { chrono.destroy(); chrono = null; } }
};
