// Lina's prepared commands: what Kevin says most is understood without the model, and anything unclear is left to it.
// Run: npm test (inside server/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.API_TOKEN = 'test-master-token';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'agentic-tpl-')), 'test.db');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agentic-tpl-data-'));
process.env.NO_SCHEDULER = '1';

let planCommand, extractWhen;
before(async () => { ({ planCommand, extractWhen } = await import('../src/voice/templates.js')); });

// Monday 19 October 2026, 10:00 in Berlin
const NOW = new Date('2026-10-19T08:00:00Z');
const TODAY = '2026-10-19', TOMORROW = '2026-10-20';
const world = {
  todos: [
    { id: 't_gym', title: 'Gym', due: TODAY, priority: 'med' },
    { id: 't_milk', title: 'Buy milk', due: null, priority: 'med' },
    { id: 't_report', title: 'Finish the tax report', due: '2026-10-18', priority: 'high' },
    { id: 't_mom', title: 'Mama anrufen', due: null, priority: 'med' }
  ],
  events: [
    { id: 'g1:dentist', kind: 'event', title: 'Dentist', from: TODAY, to: TODAY, time: '15:00', endTime: '16:00', allDay: false },
    { id: 'g1:standup', kind: 'event', title: 'Team standup', from: TODAY, to: TODAY, time: '09:00', endTime: '09:15', allDay: false },
    { id: 'fx:math', kind: 'lesson', title: 'Math', from: TODAY, to: TODAY, time: '11:00', endTime: '12:30', allDay: false },
    { id: 'g1:trip', kind: 'event', title: 'Zurich trip', from: TOMORROW, to: '2026-10-21', time: '', endTime: '', allDay: true }
  ]
};
const plan = text => planCommand(text, world, NOW);
const call = p => p && p.calls.map(c => [c.name, c.input]);

test('times and days, English and German', () => {
  const w = (s, o) => { const r = extractWhen(s, TODAY, o); return [r.date, r.time, r.endTime]; };
  assert.deepEqual(w('tomorrow at 3'), [TOMORROW, '15:00', null]);
  assert.deepEqual(w('morgen um 15 Uhr'), [TOMORROW, '15:00', null]);
  assert.deepEqual(w('morn am drü'), [TOMORROW, null, null]);              // Swiss "am drü" is the model's job
  assert.deepEqual(w('on friday at 9:30'), ['2026-10-23', '09:30', null]);
  assert.deepEqual(w('am Montag um halb vier'), ['2026-10-26', '15:30', null]);
  assert.deepEqual(w('from 2 to 4 pm'), [null, '14:00', '16:00']);
  assert.deepEqual(w('25.10. um 8 Uhr für 2 Stunden'), ['2026-10-25', '08:00', '10:00']);
  assert.deepEqual(w('October 3rd at 7pm'), ['2027-10-03', '19:00', null]);
  assert.deepEqual(w('übermorgen at noon'), ['2026-10-21', '12:00', null]);
  assert.deepEqual(w('to 4', { bareTo: true }), [null, '16:00', null]);
  assert.equal(extractWhen('my 3 o\'clock to 4', TODAY, { bareTo: true }).bad, true);
});

test('adding to the calendar and to the tasks', () => {
  let p = plan('Add dentist tomorrow at 3 to my calendar');
  assert.deepEqual(call(p), [['add_calendar_block', { title: 'Dentist', date: TOMORROW, time: '15:00' }]]);
  assert.equal(p.done, 'Added “Dentist” tomorrow at 3 PM.');
  assert.equal(p.expect, p.done);

  p = plan('Trag morgen um 15 Uhr Friseur in den Kalender ein');
  assert.deepEqual(call(p), [['add_calendar_block', { title: 'Friseur', date: TOMORROW, time: '15:00' }]]);
  assert.equal(p.lang, 'de');
  assert.equal(p.done, '„Friseur“ steht morgen um 15 Uhr im Kalender.');

  p = plan('schedule focus block today from 2 to 4');                   // overlaps the dentist at 3
  assert.deepEqual(call(p), [['add_calendar_block', { title: 'Focus block', date: TODAY, time: '14:00', endTime: '16:00' }]]);
  assert.match(p.done, /overlaps with “Dentist”/);

  assert.deepEqual(call(plan('add buy eggs for tomorrow')), [['create_todo', { title: 'Buy eggs', due: TOMORROW }]]);
  assert.deepEqual(call(plan('Add a task call the bank, high priority')), [['create_todo', { title: 'Call the bank', priority: 'high' }]]);
  assert.deepEqual(call(plan('Remind me to pay rent on Friday')), [['create_todo', { title: 'Pay rent', due: '2026-10-23' }]]);
  assert.deepEqual(call(plan('Neue Aufgabe Wohnung putzen morgen')), [['create_todo', { title: 'Wohnung putzen', due: TOMORROW }]]);
  assert.equal(plan('Neue Aufgabe Wohnung putzen morgen').done, 'Aufgabe „Wohnung putzen“ hinzugefügt, fällig morgen.');
  assert.deepEqual(call(plan('erinnere mich morgen daran die Miete zu zahlen')), [['create_todo', { title: 'Miete zahlen', due: TOMORROW }]]);
  assert.deepEqual(call(plan('add meeting notes review to my tasks')), [['create_todo', { title: 'Meeting notes review' }]]);
  assert.deepEqual(call(plan('add dinner tonight at 8')), [['add_calendar_block', { title: 'Dinner', date: TODAY, time: '20:00' }]]);
  assert.deepEqual(call(plan('add run tomorrow morning at 6')), [['add_calendar_block', { title: 'Run', date: TOMORROW, time: '06:00' }]]);
  assert.equal(plan('schedule dentist'), null);                                     // when? the model asks
  assert.equal(plan('add a task'), null);                                           // what? still coming
  // a task at a time: the task plus a block on the calendar
  assert.deepEqual(call(plan('add task gym tomorrow at 7')), [
    ['create_todo', { title: 'Gym', due: TOMORROW }], ['add_calendar_block', { title: 'Gym', date: TOMORROW, time: '07:00' }]]);
});

test('changing, finishing and deleting', () => {
  assert.deepEqual(call(plan('Move the dentist to tomorrow at 4')), [['move_event', { id: 'g1:dentist', date: TOMORROW, time: '16:00' }]]);
  assert.equal(plan('Move the dentist to tomorrow at 4').ask, '“Dentist” has guests. Shall I move it to tomorrow at 4 PM and tell them?');
  assert.deepEqual(call(plan('verschieb den Zahnarzt Termin auf 17 Uhr')), null);    // "Zahnarzt" is not "Dentist": the model
  assert.deepEqual(call(plan('verschiebe Team Standup auf morgen')), [['move_event', { id: 'g1:standup', date: TOMORROW }]]);
  assert.deepEqual(call(plan('move buy milk to friday')), [['update_todo', { id: 't_milk', due: '2026-10-23' }]]);
  assert.deepEqual(call(plan('mark gym as done')), [['complete_todo', { id: 't_gym' }]]);
  assert.deepEqual(call(plan('Mama anrufen ist erledigt')), [['complete_todo', { id: 't_mom' }]]);
  assert.equal(plan('Mama anrufen ist erledigt').done, '„Mama anrufen“ ist abgehakt.');
  assert.deepEqual(call(plan('I finished the tax report')), [['complete_todo', { id: 't_report' }]]);
  assert.deepEqual(call(plan('delete the gym task')), [['delete_todo', { id: 't_gym', title: 'Gym' }]]);
  assert.deepEqual(call(plan('lösche Milch kaufen')), null);                           // no such task: the model
  const c = plan('cancel the dentist');
  assert.deepEqual(call(c), [['cancel_event', { id: 'g1:dentist', title: 'Dentist' }]]);
  assert.equal(c.ask, 'Shall I cancel “Dentist”?');
  assert.equal(c.expect, c.ask);
  assert.deepEqual(call(plan('cancel my 3 pm')), [['cancel_event', { id: 'g1:dentist', title: 'Dentist' }]]);
  assert.deepEqual(call(plan('rename buy milk to buy oat milk')), [['update_todo', { id: 't_milk', title: 'Buy oat milk' }]]);
  assert.deepEqual(call(plan('make the tax report low priority')), [['update_todo', { id: 't_report', priority: 'low' }]]);
});

test('an overview is answered from what is already there', () => {
  const p = plan('Give me an overview');
  assert.deepEqual(p.calls, []);
  assert.equal(p.reply, '3 events today: Team standup at 9 AM, Math at 11 AM and Dentist at 3 PM. 2 tasks due: Finish the tax report and Gym.');
  assert.equal(plan('what\'s on tomorrow').reply, '1 event tomorrow: Zurich trip all day. 2 tasks due: Finish the tax report and Gym.');
  assert.equal(planCommand('what\'s on tomorrow', { todos: [world.todos[1]], events: [] }, NOW).reply, 'Nothing on your calendar tomorrow. No tasks due, 1 open in total.');
  assert.match(plan('Gib mir einen Überblick').reply, /^3 Termine heute: Team standup um 9 Uhr/);
  assert.match(plan('what are my tasks').reply, /^4 open tasks: Finish the tax report, Gym, Buy milk and 1 more\.$/);
});

test('anything unclear goes to the model', () => {
  for (const s of [
    'schedule a meeting with Max tomorrow at 3',      // guests: the invite flow
    'add dentist',                                   // calendar or task? fine as a task …
    'move my 3 o\'clock to 4',                        // two times
    'delete it',
    'add milk and delete the gym task',               // two commands
    'what did Max write me',
    'note that the wifi password changed',
    'move the dentist',                              // to when?
    'cancel math'                                    // a school lesson is read-only
  ].slice(0)) {
    const p = plan(s);
    if (s === 'add dentist') assert.deepEqual(call(p), [['create_todo', { title: 'Dentist' }]]);
    else assert.equal(p, null, s);
  }
});
