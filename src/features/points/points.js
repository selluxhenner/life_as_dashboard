// Rank / points system. Disabled by default (settings.flags.points). Data (state.ledger) is kept either way.
import { h } from '../../core/dom.js';
import { state, persist } from '../../core/store.js';
import { uid, todayKey, keyOffset, parseKey, fmt } from '../../core/dates.js';
import { routineItems, streakAsOf, weekCount, bestStreak, currentStreak } from '../../core/model.js';
import { panel } from '../../components/panel.js';
import { viewHead, meter } from '../../components/ui.js';

export const RANKS = [
  { min: 0, name: 'Recruit', ins: '▪' }, { min: 30, name: 'Private', ins: '▮' },
  { min: 70, name: 'Private first class', ins: '▮▪' }, { min: 120, name: 'Lance corporal', ins: '▮▮' },
  { min: 180, name: 'Corporal', ins: '▮▮▪' }, { min: 260, name: 'Sergeant', ins: '▮▮▮' },
  { min: 360, name: 'Staff sergeant', ins: '▰▮▮' }, { min: 480, name: 'Master sergeant', ins: '▰▰▮' },
  { min: 620, name: 'Warrant officer', ins: '▰▰▰' }, { min: 780, name: 'Lieutenant', ins: '★' },
  { min: 960, name: 'First lieutenant', ins: '★★' }, { min: 1200, name: 'Captain', ins: '★★★' }
];
const STREAK_BONUS = { 3: 3, 7: 7, 14: 10, 21: 15, 30: 20, 50: 25, 100: 50 };

export const pointsOn = () => !!state.settings.flags.points;
export function addLedger(label, delta, dk, detail) {
  state.ledger.push({ id: uid(), date: dk || todayKey(), label, delta, detail: detail || '' });
}
export const totalPoints = () => state.ledger.reduce((s, e) => s + e.delta, 0);
export function rankFor(points) {
  const p = Math.max(0, points);
  let current = RANKS[0], next = null;
  for (const r of RANKS) { if (p >= r.min) current = r; else { next = r; break; } }
  return { current, next, points, progress: next ? Math.round((p - current.min) / (next.min - current.min) * 100) : 100 };
}

export function computeDaySettlement(dk) {
  const res = { delta: 0, habitsDone: 0, habitsTotal: 0, planDone: 0, planTotal: 0, routineDone: 0, routineTotal: 0, reflected: false, milestones: [] };
  let dailyDone = 0, dailyTotal = 0;
  state.habits.forEach(hb => {
    if (hb.createdAt && hb.createdAt > dk) return;
    res.habitsTotal++;
    if (hb.mode === 'weekly') { if (hb.history[dk]) { res.habitsDone++; res.delta += 1; } return; }
    dailyTotal++;
    if (hb.history[dk]) {
      res.habitsDone++; dailyDone++; res.delta += 1;
      const s = streakAsOf(hb.history, dk);
      if (STREAK_BONUS[s]) res.milestones.push({ habit: hb.label, streak: s, bonus: STREAK_BONUS[s] });
    }
  });
  if (dailyTotal > 0 && dailyDone === dailyTotal) res.delta += 3;
  routineItems(dk).forEach(it => { res.routineTotal++; if (it.done) { res.routineDone++; res.delta += 1; } });
  (state.dayplan[dk] || []).forEach(b => { res.planTotal++; if (b.done) { res.planDone++; res.delta += 1; } });
  const r = state.reflections[dk];
  res.reflected = !!(r && ((r.mood !== null && r.mood !== undefined) || (r.good || '').trim() || (r.improve || '').trim() || (r.grateful || '').trim()));
  if (res.reflected) res.delta += 2;
  return res;
}

function settleDay(dk) {
  const r = computeDaySettlement(dk);
  const detail = `Habits ${r.habitsDone}/${r.habitsTotal} · Plan ${r.planDone}/${r.planTotal} · Routine ${r.routineDone}/${r.routineTotal} · Reflection ${r.reflected ? '✓' : '✗'}`;
  if (r.delta > 0) addLedger('Daily settlement ' + fmt.short(dk), r.delta, dk, detail);
  r.milestones.forEach(m => addLedger(`🔥 ${m.streak}-day streak: ${m.habit}`, m.bonus, dk));
  if (parseKey(dk).getDay() === 0) {
    const mon = keyOffset(dk, -6);
    state.habits.forEach(hb => {
      if (hb.mode !== 'weekly' || (hb.createdAt && hb.createdAt > mon)) return;
      const c = weekCount(hb, dk), t = hb.target || 1;
      if (c >= t) addLedger(`🎯 Weekly goal reached: ${hb.label} (${c}/${t})`, 3, dk);
    });
  }
}

/* Runs on boot and on day change. With points off it only moves the marker, so turning points on never backfills. */
export function settle() {
  const yesterday = keyOffset(todayKey(), -1);
  const last = state.meta.lastSettledDay;
  if (yesterday <= last) return;
  if (pointsOn()) for (let d = keyOffset(last, 1); d <= yesterday; d = keyOffset(d, 1)) settleDay(d);
  state.meta.lastSettledDay = yesterday;
  persist();
}

/* One-time 2026-09-24 penalty cleanup, kept for old states. */
export function forgivePenalties() {
  if (state.meta.noPenalties20260924) return;
  state.meta.noPenalties20260924 = true;
  state.ledger = state.ledger.filter(e => {
    if (e.label.indexOf('Tagesabrechnung') === 0) e.delta = computeDaySettlement(e.date).delta;
    return e.delta > 0;
  });
}

export function rankCard() {
  const r = rankFor(totalPoints());
  return panel({ title: 'Rank', readout: h('span', h('b', String(r.points)), ' pts') },
    h('div.rank-mini', h('span.rank-ins', r.current.ins), h('span', r.current.name)),
    meter(r.progress, 'var(--amber)'),
    h('div.hint', r.next ? `Next: ${r.next.name} at ${r.next.min}` : 'Highest rank reached'));
}

export const rankView = {
  id: 'rank',
  render(root) {
    const pts = totalPoints(), r = rankFor(pts), today = computeDaySettlement(todayKey());
    root.append(h('div.view',
      viewHead('Rank', 'Points for consistency. Missed days never cost anything.'),
      h('div.grid.g-2',
        panel({ title: r.current.name, readout: h('span', h('b', String(pts)), ' pts') },
          h('div.rank-big', r.current.ins),
          meter(r.progress, 'var(--amber)'),
          h('div.hint', r.next ? `Next rank: ${r.next.name} at ${r.next.min} pts` : 'Highest rank reached'),
          h('div.hint', `Today so far: +${today.delta} · habits ${today.habitsDone}/${today.habitsTotal} · plan ${today.planDone}/${today.planTotal}`),
          h('div.rows', { style: { marginTop: '16px' } }, RANKS.map(k => h('div.row' + (pts >= k.min ? '' : '.done'), h('span.data', k.ins), h('div.grow', k.name), h('span.data.muted', k.min))))),
        h('div.stack',
          panel({ title: 'Streaks' }, h('div.rows', state.habits.map(hb => h('div.row', h('span', hb.icon), h('div.grow', hb.label),
            h('span.data', hb.mode === 'weekly' ? `${weekCount(hb, todayKey())}/${hb.target || 1}` : `${currentStreak(hb)}d · best ${bestStreak(hb.history)}d`))))),
          panel({ title: 'Ledger', readout: state.ledger.length + ' entries' },
            h('div.rows', state.ledger.slice().reverse().slice(0, 40).map(e => h('div.row', h('span.data.muted', fmt.short(e.date)), h('div.grow', h('div.title', e.label), e.detail ? h('div.sub', e.detail) : null), h('span.data', (e.delta >= 0 ? '+' : '') + e.delta)))))))));
  }
};
