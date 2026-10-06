// Upgrading real pre-v2 states must not lose data. Run: npm test
import { describe, it, expect } from 'vitest';
import { migrate, freshState } from '../src/core/migrations.js';

const v3State = () => ({
  name: 'Kevin',
  ziele: { woche: [{ id: 'g1', label: '3x Krafttraining', done: true }], monat: [], jahr: [{ id: 'g2', label: 'Zielgewicht 72 kg', done: false }] },
  habits: [
    { id: 'h1', label: 'Deep Work', icon: '🧠', history: { '2026-09-01': true } },
    { id: 'h2', label: 'Training', icon: '💪', history: {} },
    { id: 'h3', label: 'Lesen', icon: '📚', history: {} },
    { id: 'h4', label: 'Protein', icon: '🥩', history: {} }
  ],
  todos: { high: [{ id: 't1', label: 'Tiger Wil Redesign', done: false }], med: [{ id: 't2', label: 'Trinkstube planen', done: true }], low: [] },
  fitness: { weight: 68.2, steps: 1000 },
  meta: { createdAt: '2026-07-01', lastSettledDay: '2026-09-30' },
  bewerbungen: [{ id: 'b1', firma: 'Weitblick', rolle: 'Praktikum Plus', status: 'interview', date: '', next: 'Nachfassen', notes: 'gut', awarded: { beworben: true } }],
  ledger: [{ id: 'l1', date: '2026-09-01', label: 'Tagesabrechnung 01.09.', delta: 5 }]
});

describe('migrate', () => {
  it('upgrades a v3 state without losing tasks, habits, goals or ledger', () => {
    const s = migrate(v3State());
    expect(s.tasks.map(t => t.title).sort()).toEqual(['Tiger Wil Redesign', 'Trinkstube planen']);
    expect(s.tasks.find(t => t.id === 't2').done).toBe(true);
    expect(s.todos).toBeUndefined();
    expect(s.habits.map(h => h.label)).toEqual(['Deep work block', 'Training', 'Meals + protein']);
    expect(s.habits[0].history['2026-09-01']).toBe(true);
    expect(s.ziele.woche[0].label).toBe('3x Krafttraining');      // user text untouched
    expect(s.ledger).toHaveLength(1);
    expect(s.fitness.weight).toBe(68.2);
    expect(s.fitness.steps).toBeUndefined();
  });

  it('turns every Bewerbung (incl. the Swiss import) into an archived job with mapped status', () => {
    const s = migrate(v3State());
    expect(s.bewerbungen).toBeUndefined();
    expect(s.jobs.length).toBe(14);                 // Weitblick merged with the 14-company import
    const wb = s.jobs.find(j => j.company === 'Weitblick');
    expect(wb.status).toBe('rejected');             // import set Weitblick to "absage"
    expect(s.jobs.every(j => j.archived && j.location === 'CH')).toBe(true);
    const map = Object.fromEntries(s.jobs.map(j => [j.company, j.status]));
    expect(map['Webkönig AG']).toBe('applied');
    expect(map['Kernbrand']).toBe('rejected');
  });

  it('moves an old slow voice speed to Brisk once, then leaves the choice alone', () => {
    const st = v3State();
    st.settings = { voice: { rate: 0.97, provider: 'auto' } };
    const s = migrate(st);
    expect(s.settings.voice.rate).toBe(1.15);
    s.settings.voice.rate = 1;                        // picked Calm afterwards: kept
    expect(migrate(s).settings.voice.rate).toBe(1);
  });

  it('is idempotent', () => {
    const once = migrate(v3State());
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice.jobs).toHaveLength(once.jobs.length);
    expect(twice.tasks).toHaveLength(once.tasks.length);
    expect(twice.habits.map(h => h.label)).toEqual(once.habits.map(h => h.label));
  });

  it('defaults the points flag to off and keeps settings on later runs', () => {
    const s = migrate(v3State());
    expect(s.settings.flags.points).toBe(false);
    s.settings.flags.points = true; s.settings.theme = 'ember';
    const again = migrate(s);
    expect(again.settings.flags.points).toBe(true);
    expect(again.settings.theme).toBe('ember');
  });

  it('fresh state is English and already migrated', () => {
    const s = migrate(freshState());
    expect(s.jobs).toEqual([]);
    expect(s.meta.english20261005).toBe(true);
  });
});
