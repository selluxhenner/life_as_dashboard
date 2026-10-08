import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// captures.js works on the app store, which lives in localStorage
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);

let state, takeCaptures, settleCaptures;
beforeAll(async () => {
  ({ state } = await import('../src/core/store.js'));
  ({ takeCaptures, settleCaptures } = await import('../src/features/capture/captures.js'));
});
beforeEach(() => { state.captures = []; });

/* What the Android Capture widget writes (android/…/pulse/Captures.java). */
const fromWidget = (id, text, createdAt) => ({
  id, text, type: 'none', date: '', time: '', end: '', horizon: 'woche', priority: 'med',
  createdAt, updatedAt: createdAt, archived: false, ref: null, from: 'widget', parse: true
});
const wed = new Date(2026, 9, 7, 20, 0).getTime();   // Wed 7 Oct 2026, 20:00

describe('captures from the Capture widget', () => {
  it('reads dates against the moment they were written, not when the app sees them', () => {
    takeCaptures([fromWidget('id_a', 'Call Anna tomorrow 15:00', wed)]);
    const c = state.captures[0];
    expect(c).toMatchObject({ date: '2026-10-08', time: '15:00', type: 'none' });
    expect(c.parse).toBeUndefined();
  });

  it('adds each capture once, newest first, and keeps what is already there', () => {
    state.captures = [{ ...fromWidget('id_a', 'already synced', wed), parse: undefined }];
    takeCaptures([fromWidget('id_a', 'already synced', wed), fromWidget('id_b', 'older', wed - 5000), fromWidget('id_c', 'newer', wed + 5000)]);
    expect(state.captures.map(c => c.id)).toEqual(['id_c', 'id_b', 'id_a']);
    expect(state.captures[2].text).toBe('already synced');
  });

  it('settles captures that arrived by sync and leaves sorted ones alone', () => {
    state.captures = [fromWidget('id_d', 'Meeting Friday 9:00', wed), { ...fromWidget('id_e', 'Lunch tomorrow 12:00', wed), type: 'note' }];
    expect(settleCaptures()).toBe(2);
    expect(state.captures[0]).toMatchObject({ date: '2026-10-09', time: '09:00' });
    expect(state.captures[1].date).toBe('');
    expect(state.captures.some(c => c.parse)).toBe(false);
    expect(settleCaptures()).toBe(0);
  });
});
