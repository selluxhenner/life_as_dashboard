// Lina's hello: a meeting in a few minutes comes first; otherwise a greeting, what matters, and a question.
import { describe, it, expect } from 'vitest';
import { greetingFor } from '../src/voice/greeting.js';

const at = (h, m) => { const d = new Date(2026, 10, 16, h, m); return d; };

describe('greetingFor', () => {
  it('warns about a meeting in the next minutes and asks if he is ready', () => {
    const line = greetingFor({}, [{ start: 9 * 60, time: '09:00', title: 'Team ToDos Weekly' }], at(8, 55));
    expect(line).toMatch(/In 5 Minuten startet Team ToDos Weekly\. Bist du bereit\?$/);
  });
  it('otherwise greets by time of day, names what matters and asks a question', () => {
    const line = greetingFor({ approvals: 2, unread: 0, server: { status: 'ok' } }, [], at(8, 0));
    expect(line).toMatch(/Morgen/);
    expect(line).toMatch(/2 Freigaben warten auf dich/);
    expect(line).toMatch(/\?$/);
  });
  it('works without any status', () => {
    expect(greetingFor(null, [], at(14, 0))).toMatch(/Kevin.*\?$/);
  });
});

import { pageBrief } from '../src/voice/greeting.js';
describe('pageBrief', () => {
  it('asks about what is new on content pages and stays quiet on settings', () => {
    expect(pageBrief('calendar')).toMatch(/Kalender/);
    expect(pageBrief('inbox')).toMatch(/Inbox/);
    expect(pageBrief('settings')).toBe(null);
  });
});

import { askLine } from '../src/voice/greeting.js';
describe('askLine', () => {
  const ask = (kind, yes, extra = {}) => askLine({ kind, title: 'IN3-Z1 is blocked', task: 'IN3-Z1', yes, ...extra });
  it('asks exactly what a plain yes would do', () => {
    expect(ask('task-blocked', { id: 'retry', label: 'Restart' })).toMatch(/neu starten\?$/);
    expect(ask('task-blocked', { id: 'suggestion', label: 'Do as it proposes' })).toMatch(/wie er vorschlägt\?$/);
    expect(ask('pull-request', { id: 'merge', label: 'Agree and merge' })).toMatch(/IN3-Z1 .*gemergt werden\?$/);
  });
  it('still asks about a kind and an option it does not know', () => {
    expect(ask('haupt-start', { id: 'start', label: 'Start Hauptplan' }, { title: 'FAB · Die Fabrik' })).toBe('Kurz zu Workbench: FAB , Die Fabrik. Soll ich „Start Hauptplan“ bestätigen?');
  });
  it('never invites a yes when there is none', () => {
    expect(ask('session-waiting', null, { words: true })).toMatch(/antworten\?$/);
    expect(ask('session-waiting', null)).toMatch(/in Workbench\.$/);
    expect(askLine({ kind: 'x', title: 'a', yes: null }, 3)).toMatch(/braucht dich 3 Mal/);
  });
});
