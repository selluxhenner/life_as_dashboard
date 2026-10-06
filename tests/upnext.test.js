import { describe, it, expect } from 'vitest';
import { upNextPlan, leftToday, nextUp, EVENING } from '../src/core/upnext.js';

const at = (hh, mm = 0) => hh * 60 + mm;
const ev = (start, end, extra = {}) => ({ kind: 'event', start: at(...start), end: end ? at(...end) : null, ...extra });
const block = (extra = {}) => ({ kind: 'plan', start: null, end: null, done: false, ...extra });
const allDay = { kind: 'event', start: null, end: null, allDay: true };

describe('upNextPlan', () => {
  const day = [allDay, ev([9], [10]), ev([14], [15, 30])];

  it('shows only today while something is still coming', () => {
    expect(upNextPlan(day, at(8))).toEqual({ over: false, today: day, tomorrow: false });
    expect(upNextPlan(day, at(15))).toMatchObject({ over: false, tomorrow: false });   // 14:00 block still running
  });

  it('rolls over to tomorrow once the last item has ended', () => {
    const p = upNextPlan(day, at(15, 30));
    expect(p.over).toBe(true);
    expect(p.tomorrow).toBe(true);
    expect(p.today).toEqual([]);
  });

  it('rolls over at 20:00 and keeps what is still left today', () => {
    const late = ev([21], [22]);
    const p = upNextPlan([...day, late], EVENING);
    expect(p).toMatchObject({ over: true, tomorrow: true });
    expect(p.today).toEqual([late]);
    expect(upNextPlan([...day, late], at(19, 59)).over).toBe(false);
  });

  it('counts an item without an end as one hour long', () => {
    expect(upNextPlan([ev([18])], at(18, 59)).over).toBe(false);
    expect(upNextPlan([ev([18])], at(19)).over).toBe(true);
  });

  it('keeps an empty day on today and adds a look at tomorrow', () => {
    expect(upNextPlan([], at(9))).toEqual({ over: false, today: [], tomorrow: true });
    expect(upNextPlan([allDay, block()], at(9))).toMatchObject({ over: false, tomorrow: true });
  });

  it('carries open untimed plan blocks into the evening', () => {
    const open = block({ title: 'Groceries' });
    const p = upNextPlan([ev([9], [10]), open, block({ done: true })], at(21));
    expect(p.today).toEqual([open]);
  });
});

describe('leftToday / nextUp', () => {
  it('drops all-day items and finished ones', () => {
    const running = ev([12], [13]);
    expect(leftToday([allDay, ev([9], [10]), running], at(12, 30))).toEqual([running]);
  });
  it('finds the next item that has not started', () => {
    const a = ev([9], [10]), b = ev([11], [12]);
    expect(nextUp([allDay, a, b], at(9, 30))).toBe(b);
    expect(nextUp([a, b], at(12))).toBe(null);
  });
});
