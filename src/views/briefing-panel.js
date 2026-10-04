// Morning briefing card on Home. Shows the server-generated briefing when available,
// otherwise a local summary built from what this device knows.
import { h } from '../core/dom.js';
import { state, notify } from '../core/store.js';
import { todayKey, fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { agendaFor } from '../core/agenda.js';
import { liveTasks, weekCount, trainingHabit, liveJobs } from '../core/model.js';
import { apiConfig, api } from '../core/api.js';
import { speak, stopSpeaking, isSpeaking } from '../voice/tts.js';
import { icon } from '../core/icons.js';
import { chip } from '../components/ui.js';

const CACHE_KEY = 'agenticBriefing';
let cache = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } })();
let loading = false, lastTry = 0;

async function refresh(force = false) {
  if (!apiConfig() || loading) return;
  if (!force && Date.now() - lastTry < 5 * 60000) return;
  loading = true; lastTry = Date.now();
  try {
    const res = force ? await api.post('/api/briefing/generate', { force: true }) : await api.get('/api/briefing/today');
    if (res && res.briefing) {
      cache = res.briefing;
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      notify();
    }
  } catch { /* stays on local summary */ } finally { loading = false; }
}

export function localBriefing() {
  const tk = todayKey();
  const agenda = agendaFor(tk).filter(i => !i.allDay && i.start != null);
  const lessons = agenda.filter(a => a.kind === 'lesson');
  const meetings = agenda.filter(a => a.kind === 'event');
  const open = liveTasks().filter(t => !t.done);
  const high = open.filter(t => t.priority === 'high');
  const overdue = open.filter(t => t.due && t.due < tk);
  const th = trainingHabit();
  const followUps = liveJobs().filter(j => !j.archived && j.nextActionDate && j.nextActionDate <= tk && j.status !== 'rejected');
  const sections = [];
  const sched = [];
  if (lessons.length) sched.push(`${lessons.length} lesson${lessons.length > 1 ? 's' : ''}, first at ${lessons[0].time}`);
  if (meetings.length) sched.push(`${meetings.length} meeting${meetings.length > 1 ? 's' : ''}`);
  const blocks = agenda.filter(a => a.kind === 'plan');
  if (blocks.length) sched.push(`${blocks.length} planned block${blocks.length > 1 ? 's' : ''}`);
  sections.push({ id: 'schedule', title: 'Schedule', bullets: [sched.length ? sched.join(', ') + '.' : 'Nothing on the calendar yet. Plan your first block.'] });
  const tb = [`${open.length} open task${open.length === 1 ? '' : 's'}` + (high.length ? `, ${high.length} high priority: ${high.slice(0, 2).map(t => t.title).join(', ')}` : '') + '.'];
  if (overdue.length) tb.push(`${overdue.length} overdue.`);
  sections.push({ id: 'tasks', title: 'Tasks', bullets: tb });
  if (followUps.length) sections.push({ id: 'jobs', title: 'Job hunt', bullets: followUps.slice(0, 2).map(j => `${j.nextAction || 'Follow up'} with ${j.company}.`) });
  if (th) sections.push({ id: 'body', title: 'Training', bullets: [`${weekCount(th, tk)} of ${th.target || 1} sessions this week.`] });
  const headline = high[0] ? `Main thing today: ${high[0].title}.` : lessons[0] ? `School day — first lesson at ${lessons[0].time}.` : 'A clear day. Pick one thing that matters.';
  return { date: tk, headline, sections, local: true };
}

function toSpeech(b) {
  return [b.headline, ...b.sections.map(s => s.title + '. ' + s.bullets.map(x => typeof x === 'string' ? x : x.text).join(' '))].join('\n');
}

export function briefingPanel() {
  refresh();
  const b = cache && cache.date === todayKey() ? cache : localBriefing();
  const speakBtn = h('button.btn.sm', {
    type: 'button',
    onclick: () => { if (isSpeaking()) { stopSpeaking(); speakBtn.lastChild.textContent = 'Read aloud'; } else { speak(toSpeech(b), () => { speakBtn.lastChild.textContent = 'Read aloud'; }); speakBtn.lastChild.textContent = 'Stop'; } }
  }, icon('volume'), h('span', 'Read aloud'));
  const readout = b.local
    ? (apiConfig() ? 'local · server briefing at ' + state.settings.briefingTime : 'local summary')
    : 'generated ' + fmt.time(new Date(b.createdAt || Date.now()));
  return panel({ title: 'Morning briefing', readout, cls: 'briefing', actions: [speakBtn, apiConfig() ? h('button.btn.sm.ghost', { type: 'button', title: 'Generate again', onclick: () => refresh(true) }, icon('reset')) : null] },
    h('p.brief-head', b.headline),
    h('div.brief-sections', b.sections.map(s => h('div.brief-sec',
      h('div.brief-k', s.title),
      h('ul', s.bullets.map(x => h('li', typeof x === 'string' ? x : x.text)))))),
    b.focus && b.focus.length ? h('div.brief-focus', h('span.micro', 'Focus'), b.focus.map(f => chip(f, 'signal'))) : null);
}
