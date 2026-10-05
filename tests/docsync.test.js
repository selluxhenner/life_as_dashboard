// Two devices against an in-memory copy of the server's /api/docs/sync.
import { describe, it, expect } from 'vitest';
import { freshState, migrate } from '../src/core/migrations.js';
import { scan, outbox, acknowledge, receive, firstMerge } from '../src/core/docsync.js';

function server() {
  const rows = new Map(); let rev = 0;
  return {
    sync({ since, upserts }) {
      if (upserts.length) {
        rev++;
        for (const d of upserts) {
          const cur = rows.get(d.key);
          if (!cur || d.updatedAt > cur.updatedAt) rows.set(d.key, { ...structuredClone(d), rev });
        }
      }
      const docs = [...rows.values()].filter(r => r.rev > since).sort((a, b) => a.rev - b.rev);
      return { docs: docs.map(({ rev: _, ...d }) => structuredClone(d)), cursor: Math.max(since, ...docs.map(d => d.rev)) };
    }
  };
}

/* The same steps syncDocs() in sync.js runs, minus the network. */
function device(srv, state = migrate(freshState())) {
  return {
    state,
    run(now) {
      const s = state.sync;
      if (!s.docsReady) {
        s.docs = {}; s.docsDirty = {};
        const r = srv.sync({ since: 0, upserts: [] });
        firstMerge(state, r.docs);
        s.docsCursor = r.cursor; s.docsReady = true;
      }
      scan(state, now);
      const sent = outbox(state);
      const r = srv.sync({ since: s.docsCursor, upserts: sent });
      acknowledge(state, sent);
      receive(state, r.docs);
      s.docsCursor = r.cursor;
    }
  };
}

describe('document sync between two devices', () => {
  it('second device gets the first one’s data without doubling default habits', () => {
    const srv = server();
    const phone = device(srv);
    phone.state.dayplan['2026-10-05'] = [{ id: 'b1', time: '09:00', label: 'Deep work', done: false }];
    phone.state.habits[0].history['2026-10-05'] = true;
    phone.state.captures.unshift({ id: 'c1', text: 'Call Lena', type: 'none' });
    phone.run(1000);

    const desk = device(srv);                     // fresh install: same habit names, different ids
    desk.state.habits[0].history['2026-10-04'] = true;
    desk.run(2000);

    expect(desk.state.habits.length).toBe(3);
    expect(desk.state.habits[0].history).toEqual({ '2026-10-04': true, '2026-10-05': true });
    expect(desk.state.dayplan['2026-10-05'][0].label).toBe('Deep work');
    expect(desk.state.captures.map(c => c.id)).toContain('c1');

    phone.run(3000);                              // the combined habit flows back
    expect(phone.state.habits[0].history).toEqual({ '2026-10-04': true, '2026-10-05': true });
    expect(phone.state.habits.length).toBe(3);
  });

  it('edits and deletes travel both ways; the newer edit wins', () => {
    const srv = server();
    const a = device(srv); a.run(1000);
    const b = device(srv); b.run(1100);

    a.state.dayplan['2026-10-06'] = [{ id: 'x', time: '10:00', label: 'Gym', done: false }];
    a.state.captures.unshift({ id: 'c2', text: 'Buy milk', type: 'none' });
    a.run(2000); b.run(2100);
    expect(b.state.dayplan['2026-10-06'][0].label).toBe('Gym');

    b.state.dayplan['2026-10-06'][0].done = true;
    b.state.captures = b.state.captures.filter(c => c.id !== 'c2');
    b.run(3000); a.run(3100);
    expect(a.state.dayplan['2026-10-06'][0].done).toBe(true);
    expect(a.state.captures.some(c => c.id === 'c2')).toBe(false);

    // both change the weight; the later change wins on both
    a.state.fitness.weight = 68; a.run(4000);
    b.state.fitness.weight = 69; b.run(5000);
    a.run(5100);
    expect(a.state.fitness.weight).toBe(69);
    expect(b.state.fitness.weight).toBe(69);
  });

  it('keeps per-device settings local', () => {
    const srv = server();
    const a = device(srv); a.state.settings.theme = 'ember'; a.state.settings.sound = true; a.run(1000);
    const b = device(srv); b.run(2000);
    expect(b.state.settings.theme).toBe('ember');
    expect(b.state.settings.sound).toBe(false);
  });
});
