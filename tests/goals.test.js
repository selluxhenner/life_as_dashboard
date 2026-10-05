import { describe, it, expect } from 'vitest';
import { goalCount, goalTicks, goalProgress, toggleGoalStep, setGoalDone } from '../src/core/goals.js';

describe('goalCount', () => {
  it.each([
    ['3x Krafttraining', 3], ['3 x Krafttraining', 3], ['3×Gym', 3], ['2 Bewerbungen', 2],
    ['2 Bewerbungen schreiben', 2], ['Krafttraining 3x', 3], ['Laufen 4 mal', 4], ['5 times run', 5],
    ['Send 2 job applications in Berlin', 2], ['Gym 3x pro Woche', 3], ['Mache 3 Bewerbungen', 3]
  ])('%s → %i', (label, n) => expect(goalCount(label)).toBe(n));

  it.each(['Krafttraining', 'Read 1 book', '1 Bewerbung', '2026 plan finish', 'Lose 3 kg', 'Run 5 km', 'Read 20 pages', 'Sleep 8 hours',
    'Wake up at 6 am', 'Save 50 €', '100 push-ups', 'Ship Agentic OS v2', ''])('%s is a plain goal', label =>
    expect(goalCount(label)).toBe(1));
});

describe('steps', () => {
  it('ticks one repetition at a time and finishes the goal with the last', () => {
    const g = { label: '3x Krafttraining', done: false };
    expect(goalTicks(g)).toEqual([false, false, false]);
    toggleGoalStep(g, 0); toggleGoalStep(g, 2);
    expect(goalProgress(g)).toBe(2);
    expect(g.done).toBe(false);
    toggleGoalStep(g, 1);
    expect(g.done).toBe(true);
    toggleGoalStep(g, 1);
    expect(g.done).toBe(false);
    expect(goalTicks(g)).toEqual([true, false, true]);
  });

  it('a goal that was already done (before steps existed) shows every step ticked', () => {
    expect(goalTicks({ label: '2 Bewerbungen', done: true })).toEqual([true, true]);
  });

  it('the main checkbox sets every step', () => {
    const g = { label: '2 Bewerbungen', done: false, ticks: [true, false] };
    setGoalDone(g, true);
    expect(g.ticks).toEqual([true, true]);
    setGoalDone(g, false);
    expect(goalProgress(g)).toBe(0);
  });

  it('plain goals carry no ticks', () => {
    const g = { label: 'Krafttraining', done: false };
    setGoalDone(g, true);
    expect(g.ticks).toBeUndefined();
    expect(goalTicks(g)).toEqual([true]);
  });
});
