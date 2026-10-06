import { h } from '../core/dom.js';
import { state, save, notify } from '../core/store.js';
import { todayKey, keyOffset, pad2, fmt, parseKey, hm } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { createChronosphere } from '../components/chronosphere.js';
import { check, empty, meter, chip } from '../components/ui.js';
import { dropdown, friendlyDate } from '../components/overlay.js';
import { draggable } from '../components/drag.js';
import { agendaFor, dueTasksOn } from '../core/agenda.js';
import { upNextPlan, nextUp } from '../core/upnext.js';
import {
  liveTasks, weekCount, trainingHabit, dayScore,
  liveJobs, jobsAppliedThisWeek, QUOTES, toggleHabit, currentStreak
} from '../core/model.js';
import { go } from '../core/router.js';
import { decode, tick, toast } from '../core/fx.js';
import { icon } from '../core/icons.js';
import { typeOf, liveCaptures, unsorted, captureText, setType, updateCapture } from '../features/capture/captures.js';
import { typeOptions } from './captures.js';
import { taskRow } from './today.js';
import { aiData, toneFor, vendorName } from './ai-models.js';
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

/* ---------- sorting by drag: pull a capture onto Tasks, Habits or Up next ---------- */
const DROP_LABEL = { task: 'Drop to add as a task', habit: 'Drop to track as a daily habit', event: 'Drop to put it on the calendar' };
let arrived = null;   // { id, at, flashed }: what the last drop created, so its panel shows it

function dropZone(el, kind, day) {
  el.dataset.drop = kind;
  el.dataset.dropLabel = DROP_LABEL[kind];
  if (day) el.dataset.day = day;
  el.style.setProperty('--drop-c', typeOf(kind).color);
  return el;
}
const dropDay = (c, zone) => c.date || zone.dataset.day;   // a date written in the capture wins
const when = (dk, time) => friendlyDate(dk) + (time ? ' ' + time : '');

function dropHint(c, zone) {
  if (!zone) return 'Drop on Tasks, Habits or Up next';
  return '→ ' + (zone.dataset.drop === 'event' ? 'Calendar · ' + when(dropDay(c, zone), c.time) : typeOf(zone.dataset.drop).label);
}
function dropCapture(c, zone) {
  const kind = zone.dataset.drop;
  if (kind === 'event') updateCapture(c, { type: 'event', date: dropDay(c, zone) });
  else if (c.type !== kind) setType(c, kind);
  arrived = c.ref ? { id: c.ref.id, at: Date.now(), flashed: false } : null;
  tick('ok');
  toast(kind === 'task' ? 'Moved to Tasks' : kind === 'habit' ? 'Now a daily habit' : 'On the calendar · ' + when(c.date, c.time), 'pulse');
}
/* The item a drop just made stays in view for a minute and lights up once. */
const isArrival = id => !!arrived && arrived.id === id && Date.now() - arrived.at < 60000;
function arrive(el, id) {
  if (isArrival(id) && !arrived.flashed) { el.classList.add('arrived'); arrived.flashed = true; }
  return el;
}

function capturesPanel() {
  const all = unsorted().sort((a, b) => b.createdAt - a.createdAt);
  const list = all.slice(0, 5);
  const rows = h('div.rows');
  list.forEach(c => {
    const t = typeOf(c.type);
    const row = h('div.row.cap-mini', { style: { '--c': t.color } },
      dropdown({ options: typeOptions(), value: c.type, onChange: v => setType(c, v), label: 'Type of ' + c.text, cls: 'sm type-dd mini' }),
      h('div.grow', h('div.title', c.text), h('div.sub', fmt.ago(c.createdAt) + (c.date ? ' · ' + fmt.short(c.date) + (c.time ? ' ' + c.time : '') : ''))),
      icon('grip', 'grip'));
    draggable(row, { label: c.text, color: t.color, hint: z => dropHint(c, z), drop: z => dropCapture(c, z) });
    rows.append(row);
  });
  if (!list.length) rows.append(liveCaptures().length
    ? empty('All sorted', 'New captures land here. Drag them onto Tasks, Habits or Up next.')
    : empty('Nothing captured', 'Type anything in the capture box. It lands here unsorted.'));
  return panel({ title: 'Captures', readout: h('span', h('b', String(all.length)), ' unsorted'), actions: [h('button.btn.sm.ghost', { type: 'button', onclick: () => go('captures') }, 'Sort')] }, rows,
    list.length ? h('div.hint', (all.length > list.length ? `+ ${all.length - list.length} more · ` : '') + 'Drag onto Tasks, Habits or Up next to sort.') : null);
}

/* ---------- Up next: today, and tomorrow once today is over (or from 20:00) ---------- */
const fmtIn = m => m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad2(m % 60);
const clock = m => pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60);
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

function tlItem(it, nowMin) {
  const today = nowMin != null;
  const past = today && it.end != null && it.end <= nowMin;
  const live = today && it.start != null && it.start <= nowMin && (it.end ?? it.start + 60) > nowMin;
  // plan blocks without an explicit end only have a guessed one, so "until" is shown for real ends only
  const until = it.end != null && (it.kind !== 'plan' || it.ref.end) ? 'until ' + clock(it.end) : '';
  const what = it.kind === 'plan' ? 'Plan block' : it.kind === 'lesson' ? 'Lesson' : it.calendar || 'Calendar';
  return arrive(h('li.tl-item' + (past ? '.past' : '') + (live ? '.live' : '') + (it.done ? '.done' : ''), { style: { '--c': it.color } },
    h('span.tl-time.data', it.time || '—'),
    h('span.tl-dot'),
    h('div.tl-body',
      h('div.tl-title', it.title),
      h('div.tl-meta', [what, until].filter(Boolean).join(' · '), it.location ? h('span.tl-loc', icon('pin'), it.location) : null)),
    it.kind === 'plan' && today ? check(it.done, () => { it.ref.done = !it.ref.done; save(); }, 'Mark block done') : null), it.id);
}

/* One day inside Up next. With two days shown, each one is its own drop target. */
function dayBlock({ dk, items, nowMin = null, label, date, zone, emptyText }) {
  const allDay = items.filter(i => i.allDay);
  const list = h('ol.timeline');
  items.filter(i => !i.allDay).forEach(it => list.append(tlItem(it, nowMin)));
  if (!list.children.length) list.append(h('li.tl-empty', empty(...emptyText)));
  const due = nowMin == null ? dueTasksOn(dk).filter(t => !t.done) : [];
  const el = h('div.un-day',
    label ? h('div.un-head', h('span.micro', label), date ? h('span.un-date.data', date) : null) : null,
    allDay.length ? h('div.allday', allDay.map(a => chip(a.title, null, 'plain'))) : null,
    list,
    due.length ? h('div.un-due', h('span.micro', 'Due'), due.slice(0, 3).map(t => chip(t.title, null, 'plain')), due.length > 3 ? h('span.dim', '+' + (due.length - 3)) : null) : null);
  return zone ? dropZone(el, 'event', dk) : el;
}

function upNext() {
  const tk = todayKey(), tm = keyOffset(tk, 1);
  const nowMin = nowMinutes();
  const plan = upNextPlan(agendaFor(tk), nowMin);
  const tomorrow = plan.tomorrow ? agendaFor(tm) : [];
  const days = [];
  if (!plan.over) days.push({ dk: tk, items: plan.today, nowMin, label: plan.tomorrow ? 'Today' : null, emptyText: ['Nothing scheduled today', 'Drag a capture here, or capture “09:00 Deep work”.'] });
  else if (plan.today.length) days.push({ dk: tk, items: plan.today, nowMin, label: 'Still today' });
  if (plan.tomorrow) days.push({ dk: tm, items: tomorrow, label: 'Tomorrow', date: fmt.weekday(tm) + ' ' + fmt.short(tm), emptyText: ['Nothing scheduled tomorrow', 'Drag a capture here to plan it.'] });

  const next = nextUp(plan.today, nowMin);
  const live = plan.today.find(i => i.start != null && i.start <= nowMin && (i.end ?? i.start + 60) > nowMin);
  const first = nextUp(tomorrow, 0);
  const readout = next ? `next ${next.time} · in ${fmtIn(next.start - nowMin)}`
    : live ? 'now · until ' + clock(live.end ?? live.start + 60)
    : plan.over ? (first ? 'tomorrow from ' + first.time : 'today done')
    : '';
  const el = panel({ title: 'Up next', readout, cls: 'up-next' + (plan.over ? ' rolled' : '') },
    days.map(d => dayBlock({ ...d, zone: days.length > 1 })));
  return dropZone(el, 'event', plan.over ? tm : tk);
}

/* The readout counts minutes and the day rolls over at 20:00, so Up next rebuilds itself every minute. */
let upNextEl = null, clockTimer = 0;
function liveUpNext() {
  upNextEl = upNext();
  let minute = hm(new Date());
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    if (hm(new Date()) === minute || !upNextEl || !upNextEl.isConnected) return;
    minute = hm(new Date());
    const fresh = upNext();
    upNextEl.replaceWith(fresh);
    upNextEl = fresh;
  }, 10000);
  return upNextEl;
}

function tasksPanel() {
  const open = liveTasks().filter(t => !t.done).sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.priority] - { high: 0, med: 1, low: 2 }[b.priority]));
  const max = isPhone() ? 5 : 7;
  let shown = open.slice(0, max);
  const fresh = open.find(t => isArrival(t.id));
  if (fresh && !shown.includes(fresh)) shown = [...shown.slice(0, max - 1), fresh];   // a dropped task is always visible
  const list = h('div.rows');
  shown.forEach(t => list.append(arrive(taskRow(t, { compact: true }), t.id)));
  if (!open.length) list.append(empty('Inbox zero for tasks', 'Everything is done.'));
  return dropZone(panel({ title: 'Tasks', readout: h('span', h('b', String(open.length)), ' open'), actions: [h('button.btn.sm.ghost', { type: 'button', onclick: () => go('today') }, 'All')] }, list,
    open.length > max ? h('div.hint', `+ ${open.length - max} more on Today`) : null), 'task');
}

function habitsPanel() {
  const tk = todayKey();
  const list = h('div.habit-chips');
  state.habits.forEach(hb => {
    const done = !!hb.history[tk];
    const sub = hb.mode === 'weekly' ? `${weekCount(hb, tk)}/${hb.target || 1} wk` : `${currentStreak(hb)}d`;
    list.append(arrive(h('button.habit-chip' + (done ? '.on' : ''), { type: 'button', 'aria-pressed': String(done), onclick: () => toggleHabit(hb) },
      h('span.hc-icon', hb.icon), h('span.hc-label', hb.label), h('span.hc-sub.data', sub)), hb.id));
  });
  if (!state.habits.length) list.append(empty('No habits yet', 'Drag a capture here to start tracking it daily.'));
  const s = dayScore();
  return dropZone(panel({ title: 'Habits', readout: h('span', h('b', `${s.habits[0]}/${s.habits[1]}`), ' daily done') }, list), 'habit');
}

/* Bottom of Home: Job hunt and AI. The whole card opens its page (they are not in the sidebar). */
const launch = (route, label, ...children) => h('a.launch', { href: '#/' + route, 'aria-label': 'Open ' + label }, ...children);

function jobsPulse() {
  const jobs = liveJobs().filter(j => !j.archived);
  const active = jobs.filter(j => !['rejected'].includes(j.status));
  const interviews = jobs.filter(j => j.status === 'interview' || j.status === 'offer').length;
  const due = jobs.filter(j => j.nextActionDate && j.nextActionDate <= todayKey() && j.status !== 'rejected');
  return launch('jobs', 'Job hunt', panel({ title: h('span.launch-title', icon('briefcase'), 'Job hunt · Berlin'), readout: h('span.launch-go', 'Open', icon('right')) },
    h('div.grid.g-3.mini-stats',
      h('div.stat', h('div.k', 'Active'), h('div.v', String(active.length))),
      h('div.stat', h('div.k', 'Applied this week'), h('div.v', String(jobsAppliedThisWeek()), h('small', '/ 2'))),
      h('div.stat', h('div.k', 'Interviews'), h('div.v', String(interviews)))),
    due.length
      ? h('div.rows', { style: { marginTop: '12px' } }, due.slice(0, 3).map(j => h('div.row', h('div.grow', h('div.title', j.nextAction || 'Follow up'), h('div.sub', j.company)), chip(fmt.short(j.nextActionDate), j.nextActionDate < todayKey() ? 'alert' : 'warn'))))
      : h('div.hint', { style: { marginTop: '12px' } }, active.length ? 'No follow-ups due.' : 'Add the first Berlin role you want to apply for.')));
}

function aiPulse() {
  const { data, connected } = aiData();
  const top = ((data && data.highlights) || []).slice(0, 3);
  return launch('ai', 'AI models', panel({ title: h('span.launch-title', icon('spark'), 'AI models'), readout: h('span.launch-go', 'Open', icon('right')) },
    top.length
      ? h('ol.ai-mini', top.map(u => h('li', { style: { '--c': toneFor(u.vendor) } },
          h('div.ai-mini-head', h('b', u.title), h('span.u-vendor', vendorName(u.vendor))),
          u.what ? h('p', u.what) : null)))
      : h('div.hint', connected ? 'The top changes are picked every morning at 07:30.' : 'Connect the server in Settings to track new AI models.')));
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
    upNext: liveUpNext(), tasks: tasksPanel(), habits: habitsPanel(), captures: capturesPanel(),
    world: worldPulsePanel(), extra: state.settings.flags.points ? rankCard() : principle()
  };
  const cols = WIDE.matches ? [['upNext'], ['tasks', 'habits'], ['captures'], ['world', 'extra']]
    : MID.matches ? [['upNext', 'captures'], ['tasks', 'habits'], ['world', 'extra']]
    : NARROW.matches ? [['upNext', 'tasks', 'habits'], ['captures', 'world', 'extra']]
    : [['upNext', 'captures', 'tasks', 'habits', 'world', 'extra']];
  return [
    h('div.grid.home-grid', { style: { '--cols': cols.length } }, cols.map(c => h('div.stack', c.map(k => P[k])))),
    h('div.grid.home-launch', jobsPulse(), aiPulse())
  ];
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
    h('div.stack', liveUpNext(), briefingPanel(), tasksPanel(), habitsPanel(), jobsPulse(), aiPulse())));
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
  unmount() {
    if (chrono) { chrono.destroy(); chrono = null; }
    clearInterval(clockTimer); upNextEl = null;
  }
};
