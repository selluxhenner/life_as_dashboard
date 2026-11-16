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
