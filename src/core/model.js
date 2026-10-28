// Domain helpers over the app state. No DOM here.
import { state, save } from './store.js';
import { uid, todayKey, keyOffset, parseKey, mondayKeyOf, pct } from './dates.js';
import { makeTask, makeJob } from './migrations.js';
import { scheduleSync } from './sync.js';

export const TIERS = [
  { key: 'woche', label: 'This week' },
  { key: 'monat', label: 'This month' },
  { key: 'jahr', label: 'This year' }
];
export const PRIORITIES = [
  { key: 'high', label: 'High' },
  { key: 'med', label: 'Medium' },
  { key: 'low', label: 'Low' }
];
export const MOODS = ['😞', '😕', '😐', '🙂', '🔥'];
export const QUOTES = [
  'Build systems that outlast motivation.',
  'Consistency over intensity.',
  'Improve a little every day.',
  'Finish what you start.',
  'Quality compounds over time.',
  'Small improvements create extraordinary long-term results.',
  'Learning over comfort.',
  'Ownership over dependence.',
  'Build more than you consume.',
  'Invest in skills before status.',
  'Systems over motivation.',
  'Long-term value over short-term recognition.'
];

/* ---------- tasks ---------- */
export const liveTasks = () => state.tasks.filter(t => !t.deleted);
/* Done before today: kept and synced (and counted in "done this week"), but Today and the Plan board no longer list it. */
export function archivedTask(t, now = new Date()) {
  if (!t.done) return false;
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  return (t.completedAt || 0) < midnight.getTime();
}
export function markDirty(t) {
  t.updatedAt = Math.max(Date.now(), (t.updatedAt || 0) + 1);
  state.sync.dirty[t.id] = true;
  scheduleSync();
}
export function addTask(title, priority = 'med', extra = {}) {
  const t = makeTask({ title, priority, ...extra });
  state.tasks.push(t);
  markDirty(t);
  save();
  return t;
}
export function toggleTask(t) {
  t.done = !t.done;
  t.completedAt = t.done ? Date.now() : null;
  markDirty(t); save();
}
export function deleteTask(t) { t.deleted = true; markDirty(t); save(); }
export function updateTask(t, patch) {
  Object.assign(t, patch);
  if ('done' in patch) t.completedAt = patch.done ? (t.completedAt || Date.now()) : null;
  markDirty(t); save();
}
/** Changes made in the Android Tasks widget (ticked off, added) that the server has not passed on yet. Newer wins. */
export function applyWidgetTasks(list) {
  let changed = false;
  for (const r of list || []) {
    if (!r || !r.id || !r.title) continue;
    const local = state.tasks.find(t => t.id === r.id);
    if (local && (local.updatedAt || 0) >= r.updatedAt) continue;
    if (local) Object.assign(local, r); else state.tasks.push(makeTask({ ...r, source: 'widget' }));
    markDirty(local || state.tasks[state.tasks.length - 1]);
    changed = true;
  }
  if (changed) save();
}
export function deleteHabit(h) { state.habits = state.habits.filter(x => x.id !== h.id); save(); }

/* ---------- task groups ---------- */
// Private, School, Business, … A task's group id is its `group` field (`project` is the Plan board's), so it syncs with the todo and the server
// (Lina, the phone's tasks widget) knows it. The list itself is the synced "taskGroups" document; until it is edited
// for the first time it does not exist and every device uses the same defaults (server/src/routes/todos.js has them too).
export const GROUP_COLORS = ['samerica', 'africa', 'europe', 'asia', 'oceania', 'namerica', 'mideast'];
export const DEFAULT_GROUPS = [
  { id: 'private', name: 'Private', color: 'samerica' },
  { id: 'school', name: 'School', color: 'africa' },
  { id: 'business', name: 'Business', color: 'europe' }
];
export const taskGroups = () => state.taskGroups || DEFAULT_GROUPS;
export const groupOf = t => (t && t.group && taskGroups().find(g => g.id === t.group)) || null;
export const groupColor = g => g && g.color ? `var(--tone-${g.color})` : 'var(--ink-3)';
/* For a dropdown: every group, then "No group" (value ''). */
export const groupOptions = () => [...taskGroups().map(g => ({ value: g.id, label: g.name, color: groupColor(g) })), { value: '', label: 'No group', color: groupColor(null) }];
function setGroups(list) { state.taskGroups = list; save(); }
export function addGroup(name) {
  const used = taskGroups().map(g => g.color);
  const color = GROUP_COLORS.find(c => !used.includes(c)) || GROUP_COLORS[taskGroups().length % GROUP_COLORS.length];
  const g = { id: uid(), name, color };
  setGroups([...taskGroups(), g]);
  return g;
}
export function updateGroup(id, patch) { setGroups(taskGroups().map(g => g.id === id ? { ...g, ...patch } : g)); }
export function moveGroup(id, by) {
  const list = taskGroups().slice(), i = list.findIndex(g => g.id === id), j = i + by;
  if (i === -1 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  setGroups(list);
}
/* The group goes, its tasks stay (without a group). */
export function deleteGroup(id) {
  liveTasks().filter(t => t.group === id).forEach(t => { t.group = null; markDirty(t); });
  setGroups(taskGroups().filter(g => g.id !== id));
}

/* ---------- habits ---------- */
export function streakAsOf(history, dk) { let s = 0, d = dk; while (history[d]) { s++; d = keyOffset(d, -1); } return s; }
export function bestStreak(history) {
  let best = 0;
  Object.keys(history).filter(k => history[k]).forEach(k => {
    if (!history[keyOffset(k, -1)]) {
      let s = 0, d = k; while (history[d]) { s++; d = keyOffset(d, 1); }
      if (s > best) best = s;
    }
  });
  return best;
}
export function weekCount(habit, anyDayKey) {
  const mon = mondayKeyOf(parseKey(anyDayKey));
  let c = 0;
  for (let i = 0; i < 7; i++) if (habit.history[keyOffset(mon, i)]) c++;
  return c;
}
export function currentStreak(h) {
  const t = todayKey();
  return streakAsOf(h.history, h.history[t] ? t : keyOffset(t, -1));
}
export function toggleHabit(h, dk = todayKey()) {
  if (h.history[dk]) delete h.history[dk]; else h.history[dk] = true;
  save();
}
export function addHabit(label) {
  state.habits.push({ id: uid(), label, icon: '◆', history: {}, mode: 'daily', createdAt: todayKey() });
  save();
}
export function lastDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(keyOffset(todayKey(), -i)); return out; }
export const trainingHabit = () => state.habits.find(h => h.mode === 'weekly') || null;

/* ---------- routines ---------- */
const hasVal = v => v !== null && v !== undefined && v !== '';
export function routineFor(dk) {
  if (!state.routines[dk]) state.routines[dk] = { sleep: null, screen: null, noPhone: false };
  return state.routines[dk];
}
export function routineItems(dk) {
  const r = state.routines[dk] || {};
  return [
    { key: 'sleep', part: 'morning', label: 'Sleep logged', done: hasVal(r.sleep) },
    { key: 'plan', part: 'morning', label: 'Day planned', done: (state.dayplan[dk] || []).length > 0 },
    { key: 'noPhone', part: 'morning', label: 'No phone for the first 30 min', done: !!r.noPhone },
    { key: 'screen', part: 'evening', label: 'Screen time logged', done: hasVal(r.screen) }
  ];
}

/* ---------- day plan ---------- */
export function planFor(dk) { return (state.dayplan[dk] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || '')); }
export function addPlanBlock(time, label, dk = todayKey()) {
  if (!state.dayplan[dk]) state.dayplan[dk] = [];
  state.dayplan[dk].push({ id: uid(), time, label, done: false });
  save();
}
export function removePlanBlock(dk, id) {
  state.dayplan[dk] = (state.dayplan[dk] || []).filter(b => b.id !== id);
  save();
}

/* ---------- reflection ---------- */
export function reflFor(dk = todayKey()) {
  if (!state.reflections[dk]) state.reflections[dk] = { mood: null, good: '', improve: '', grateful: '' };
  return state.reflections[dk];
}
export function reflHasContent(r) {
  return !!(r && ((r.mood !== null && r.mood !== undefined) || (r.good || '').trim() || (r.improve || '').trim() || (r.grateful || '').trim()));
}

/* ---------- jobs ---------- */
export const liveJobs = () => state.jobs.filter(j => !j.deleted);
function markJobDirty(j) {
  if (!state.sync.jobsDirty) state.sync.jobsDirty = {};
  state.sync.jobsDirty[j.id] = true;
  scheduleSync();
}
export function addJob(fields) { const j = makeJob(fields); state.jobs.push(j); markJobDirty(j); save(); return j; }
export function updateJob(j, patch) {
  Object.assign(j, patch, { updatedAt: Math.max(Date.now(), (j.updatedAt || 0) + 1) });
  if (patch.status === 'applied' && !j.appliedAt) j.appliedAt = todayKey();
  markJobDirty(j);
  save();
}
export function jobsAppliedThisWeek() {
  const mon = mondayKeyOf(new Date()), sun = keyOffset(mon, 6);
  return liveJobs().filter(j => j.appliedAt && j.appliedAt >= mon && j.appliedAt <= sun).length;
}

/* ---------- day score (shown on the Chronosphere + home) ---------- */
export function dayScore(dk = todayKey()) {
  const daily = state.habits.filter(h => h.mode !== 'weekly');
  const hDone = daily.filter(h => h.history[dk]).length;
  const r = routineItems(dk);
  const rDone = r.filter(i => i.done).length;
  const plan = state.dayplan[dk] || [];
  const pDone = plan.filter(b => b.done).length;
  const parts = [pct(hDone, daily.length), pct(rDone, r.length)];
  if (plan.length) parts.push(pct(pDone, plan.length));
  return {
    score: Math.round(parts.reduce((a, b) => a + b, 0) / parts.length),
    habits: [hDone, daily.length], routine: [rDone, r.length], plan: [pDone, plan.length]
  };
}
