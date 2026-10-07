// Morning briefing card on Home. Shows the server-generated briefing when available,
// otherwise a local summary built from what this device knows.
// "Listen" plays the spoken version: a 30-second summary of the day, never the card read aloud.
// "Ask" opens the voice agent with the briefing as context, so follow-up questions just work.
import { h } from '../core/dom.js';
import { state, notify } from '../core/store.js';
import { todayKey, fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { agendaFor } from '../core/agenda.js';
import { liveTasks, weekCount, trainingHabit, liveJobs } from '../core/model.js';
import { apiConfig, api, apiFetch, errorText } from '../core/api.js';
import { speak, stopSpeaking, speakingWhat, secondsFor } from '../voice/tts.js';
import { talk, toggleTalk, canTalk } from '../voice/talk.js';
import { icon } from '../core/icons.js';
import { chip } from '../components/ui.js';
import { toast } from '../core/fx.js';

const CACHE_KEY = 'agenticBriefing';
const AUTO_KEY = 'agenticBriefingAutoRead';
let cache = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } })();
let loading = false, lastTry = 0, spokenAsked = false;

function keep(b) {
  cache = b;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage off */ }
  notify();
}

/* Briefings written before voice existed get their spoken version once, on demand. */
async function addSpoken() {
  if (spokenAsked || !cache || cache.spoken) return;
  spokenAsked = true;
  try { const res = await apiFetch(null, '/api/briefing/spoken', {}, 'POST', { timeout: 60000 }); if (res && res.briefing) keep(res.briefing); }
  catch { /* the device-side fallback text is used */ }
}

async function refresh(force = false) {
  if (!apiConfig() || loading) return;
  if (!force && Date.now() - lastTry < 5 * 60000) return;
  loading = true; lastTry = Date.now();
  try {
    const res = force ? await apiFetch(null, '/api/briefing/generate', { force: true }, 'POST', { timeout: 180000 }) : await api.get('/api/briefing/today');
    if (res && res.briefing) keep(res.briefing);
  } catch (e) { if (force) toast(errorText(e), 'flare'); } finally { loading = false; }
  if (cache && cache.date === todayKey() && !cache.spoken) addSpoken();
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

const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Morning, Kevin!' : hr < 18 ? 'Hi Kevin!' : 'Evening, Kevin!'; };
const bulletText = x => (typeof x === 'string' ? x : x.text);
const count = (n, one, many = one + 's') => `${n === 1 ? 'one' : n} ${n === 1 ? one : many}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const listOf = xs => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0] || '');

/* No spoken script yet. A server briefing without one (an older server, or the script failed): its headline and focus,
   never this device's calendar, which may be empty and would contradict it. Offline: a short summary from what this
   device knows, counting and picking the one thing per area that matters. Never the card's bullets read out. */
function localSpoken(b) {
  if (!b.local) {
    const focus = (b.focus || []).slice(0, 3).map(f => f.charAt(0).toLowerCase() + f.slice(1));
    return [greeting(), b.headline, focus.length ? `Today's focus: ${listOf(focus)}.` : '', 'The rest is on your card.'].filter(Boolean).join(' ');
  }
  const tk = todayKey();
  const fixed = agendaFor(tk).filter(i => !i.allDay && i.start != null && i.kind !== 'plan');
  const open = liveTasks().filter(t => !t.done);
  const high = open.filter(t => t.priority === 'high');
  const overdue = open.filter(t => t.due && t.due < tk);
  const follow = liveJobs().filter(j => !j.archived && j.nextActionDate && j.nextActionDate <= tk && j.status !== 'rejected');
  const lines = [greeting()];
  lines.push(fixed.length
    ? `${cap(count(fixed.length, 'fixed thing'))} on the calendar, starting with ${fixed[0].title} at ${fixed[0].time}.`
    : 'Nothing fixed on the calendar, so the day is yours.');
  if (high.length) lines.push(`Top task: ${high[0].title}` + (high.length > 1 ? `, plus ${count(high.length - 1, 'more urgent one')}.` : '.'));
  if (overdue.length) lines.push(`${cap(count(overdue.length, 'task'))} overdue.`);
  if (follow.length) lines.push(`Follow up with ${follow[0].company} today.`);
  lines.push(open.length > high.length + overdue.length ? 'The rest can wait.' : 'That’s everything.');
  return lines.filter(Boolean).join(' ');
}

/* What is read out: the server's 30-second script when there is one, else the device's own short summary. */
export function spokenTextOf(b) {
  const sp = b.spoken;
  if (sp && sp.topics && sp.topics.length) return [sp.greeting, sp.overview, ...sp.topics.map(t => t.say), sp.outro].filter(Boolean).join(' ');
  return localSpoken(b);
}

const current = () => (cache && cache.date === todayKey() ? cache : localBriefing());

export function playBriefing({ onBlocked } = {}) {
  const b = current();
  speak(spokenTextOf(b), null, { what: 'briefing', lang: 'en', audioPath: !b.local && b.spoken ? '/api/voice/briefing' : null, onBlocked });
}

/* "Read briefing aloud automatically" (Settings › Automation): the first time the app is in front each morning,
   once today's briefing exists. If the system blocks sound without a tap, the next tap anywhere starts it. */
let autoBusy = false;
export async function autoReadBriefing() {
  const tk = todayKey(), hr = new Date().getHours();
  if (autoBusy || !apiConfig() || document.visibilityState !== 'visible' || hr < 4 || hr >= 12) return;
  if (localStorage.getItem(AUTO_KEY) === tk) return;
  autoBusy = true;
  try {
    const { settings } = await api.get('/api/settings');
    if (!settings || !settings.voice || !settings.voice.autoRead) return;
    const res = await api.get('/api/briefing/today');
    if (!res || !res.briefing) return;                       // not written yet; try again when the app comes back to front
    keep(res.briefing);
    if (!cache.spoken) await addSpoken();
    localStorage.setItem(AUTO_KEY, tk);
    playBriefing({ onBlocked: tapToPlay });
  } catch { /* offline: try again next time */ } finally { autoBusy = false; }
}

/* The system blocks sound until the first tap: the next tap anywhere starts it. */
function tapToPlay() {
  toast('Tap anywhere to hear your briefing.', 'signal');
  const go = () => { window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true); playBriefing(); };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

/* "Listen" on the phone's morning notification, lock-screen card or app shortcut: fetch today's briefing, then play it. */
export async function listenNow() {
  if (apiConfig()) {
    try {
      const res = await api.get('/api/briefing/today');
      if (res && res.briefing) { keep(res.briefing); await addSpoken(); }
    } catch { /* offline: the cached or local version */ }
  }
  playBriefing({ onBlocked: tapToPlay });
}

export function briefingPanel() {
  refresh();
  const b = current();
  const text = spokenTextOf(b);
  const playingThis = speakingWhat() === 'briefing';
  const listenBtn = h('button.btn.sm' + (playingThis ? '' : '.primary'), {
    type: 'button', title: 'The short spoken version: the few things that matter most',
    onclick: () => (playingThis ? stopSpeaking() : playBriefing())
  }, icon(playingThis ? 'pause' : 'volume'), h('span', playingThis ? 'Stop' : 'Listen'), playingThis ? null : h('span.data.muted', `${secondsFor(text)} s`));
  const asking = talk.state === 'listening' && talk.context === 'briefing';
  const askBtn = canTalk() ? h('button.btn.sm' + (asking ? '.rec' : ''), {
    type: 'button', 'aria-pressed': String(asking), title: 'Ask a follow-up by voice',
    onclick: () => toggleTalk('briefing')
  }, icon('mic'), asking ? 'Send' : 'Ask') : null;
  const readout = b.local
    ? (apiConfig() ? 'local · server briefing at ' + state.settings.briefingTime : 'local summary')
    : 'generated ' + fmt.time(new Date(b.createdAt || Date.now()));
  const topics = b.spoken && b.spoken.topics ? b.spoken.topics.filter(t => t.label) : [];
  return panel({
    title: 'Morning briefing', readout, cls: 'briefing',
    actions: [listenBtn, askBtn, apiConfig() ? h('button.btn.sm.ghost', { type: 'button', title: 'Generate again', 'aria-label': 'Generate the briefing again', onclick: () => refresh(true) }, icon('reset')) : null]
  },
    h('p.brief-head', b.headline),
    topics.length ? h('div.brief-air', { title: 'What the spoken briefing covers' }, h('span.micro', 'You’ll hear'),
      h('span.brief-air-list', topics.map((t, i) => [i ? h('span.dot-sep', '·') : null, h('span', t.label)]))) : null,
    h('div.brief-sections', b.sections.map(s => h('div.brief-sec',
      h('div.brief-k', s.title),
      h('ul', s.bullets.map(x => h('li', bulletText(x))))))),
    b.focus && b.focus.length ? h('div.brief-focus', h('span.micro', 'Focus'), b.focus.map(f => chip(f, 'signal'))) : null);
}
