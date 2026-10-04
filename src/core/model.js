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
    { key: 'sleep', part: 'morning', label: 'Sleep logged', done: hasVal(r.sleep) || hasVal(((state.health && state.health.days[dk]) || {}).sleepHours) },
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

/* ---------- focus ---------- */
export function completeFocusSession() {
  const t = todayKey();
  state.focus[t] = (state.focus[t] || 0) + 1;
  state.habits.forEach(h => { if (h.link === 'focus') h.history[t] = true; });
  save();
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
