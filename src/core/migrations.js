// State shape + one-time migrations. Pure functions (no DOM), covered by tests/migrations.test.js.
// Each one-time step is guarded by a flag in state.meta so it runs exactly once per device.
import { uid, todayKey } from './dates.js';

export const STORE_KEY = 'lifeOsDashboardState_v4';
export const OLD_STORE_KEYS = ['lifeOsDashboardState_v3', 'lifeOsDashboardState_v2'];

export const JOB_STATUS = ['saved', 'applied', 'interview', 'offer', 'rejected'];
export const JOB_TYPES = ['werkstudent', 'part-time', 'startup', 'minijob', 'other'];

export function defaultSettings() {
  return {
    theme: 'orbital',
    sound: false,
    motion: 'full',                 // full | calm
    flags: { points: false, jobsAi: false, phone: false, push: false },
    home: { city: 'Berlin', lat: 52.52, lon: 13.405 },
    briefingTime: '08:00'
  };
}

export function freshState() {
  const today = todayKey();
  return {
    name: 'Kevin',
    ziele: {
      woche: [{ id: uid(), label: 'Send 2 job applications in Berlin', done: false }],
      monat: [{ id: uid(), label: 'Land a Werkstudent or startup role', done: false }],
      jahr: [{ id: uid(), label: 'Ship Agentic OS v2', done: false }]
    },
    habits: [
      { id: uid(), label: 'Deep work block', sub: 'At least one distraction-free block', icon: '🧠', history: {}, mode: 'daily', createdAt: today },
      { id: uid(), label: 'Training', sub: 'Strength or sport session', icon: '💪', history: {}, mode: 'weekly', target: 6, createdAt: today },
      { id: uid(), label: 'Meals + protein', sub: 'Breakfast, lunch, dinner + shake', icon: '🥩', history: {}, mode: 'daily', createdAt: today }
    ],
    tasks: [],
    jobs: [],
    fitness: { weight: 67.0, start: 67.0, goal: 72.0 },
    meta: {
      createdAt: today, lastSettledDay: today,
      habitRework20260731: true, bewImport20260729: true, noPenalties20260924: true,
      english20261005: true, jobHunt20261005: true, briskVoice20261006: true
    },
    dayplan: {}, weekplan: {}, weekFocus: {}, reflections: {},
    ledger: [], focus: {}, routines: {},
    sync: { cursor: 0, dirty: {}, lastSync: 0 },
    gcal: { connected: false, pushed: {}, events: [], range: null, lastFetch: 0 },
    captures: [],
    settings: defaultSettings()
  };
}

export function migrate(s) {
  const today = todayKey();
  if (!s.meta) s.meta = { createdAt: today, lastSettledDay: today };
  if (!s.meta.createdAt) s.meta.createdAt = today;
  if (!s.meta.lastSettledDay) s.meta.lastSettledDay = today;
  for (const k of ['dayplan', 'weekplan', 'weekFocus', 'reflections', 'focus', 'routines']) if (!s[k]) s[k] = {};
  if (!s.ledger) s.ledger = [];
  if (!s.ziele) s.ziele = { woche: [], monat: [], jahr: [] };
  if (!s.habits) s.habits = [];
  s.habits.forEach(h => { if (!h.createdAt) h.createdAt = s.meta.createdAt; if (!h.history) h.history = {}; });
  reworkHabits(s);
  if (!s.fitness) s.fitness = { weight: 67.0 };
  if (s.fitness.start == null) s.fitness.start = 67.0;
  if (s.fitness.goal == null) s.fitness.goal = 72.0;
  delete s.fitness.steps; delete s.fitness.calories; delete s.fitness.workouts;
  delete s.lifestyle;
  if (!s.bewerbungen && !s.meta.jobHunt20261005) s.bewerbungen = [];
  importBewerbungen(s);
  migrateTodos(s);
  if (!s.sync) s.sync = { cursor: 0, dirty: {}, lastSync: 0 };
  if (!s.gcal) s.gcal = { connected: false, pushed: {}, events: [], range: null, lastFetch: 0 };
  if (!Array.isArray(s.captures)) s.captures = [];
  delete s.health;                 // Garmin vitals were dropped
  s.settings = { ...defaultSettings(), ...(s.settings || {}) };
  s.settings.flags = { ...defaultSettings().flags, ...(s.settings.flags || {}) };
  english(s);
  jobHunt(s);
  briskVoice(s);
  return s;
}

/* 2026-07-31: precise habit definitions (kept so very old states still upgrade correctly). */
export function reworkHabits(s) {
  if (s.meta.habitRework20260731) return;
  s.meta.habitRework20260731 = true;
  const kept = [];
  s.habits.forEach(h => {
    const l = (h.label || '').toLowerCase();
    if (l.includes('deep work')) { Object.assign(h, { label: 'Deep Work Block', sub: 'Mind. 1×25-min Focus-Session', mode: 'daily', link: 'focus' }); kept.push(h); }
    else if (l.includes('training') || l.includes('sport')) { Object.assign(h, { label: 'Training / Bewegung', sub: 'Kraft oder Sport-Einheit', mode: 'weekly', target: 6 }); kept.push(h); }
    else if (l.includes('protein') || l.includes('mahlzeit')) { Object.assign(h, { label: 'Mahlzeiten + Protein', sub: 'Frühstück · Mittag · Nachtessen + Shake/Wrap', mode: 'daily' }); kept.push(h); }
    else if (l.includes('lesen') || l.includes('lernen')) { /* dropped */ }
    else { if (!h.mode) h.mode = 'daily'; kept.push(h); }
  });
  s.habits = kept;
}

export function makeTask(f) {
  const now = Date.now();
  return {
    id: f.id || uid(), title: f.title, notes: f.notes || '', done: !!f.done,
    priority: f.priority || 'med', due: f.due || null, project: f.project || null,
    sort: f.sort || now, source: f.source || 'app', createdAt: now, updatedAt: now,
    completedAt: f.done ? now : null, deleted: false
  };
}

/* 2026-09-24: todos as one flat, syncable list. */
export function migrateTodos(s) {
  if (s.tasks) return;
  s.tasks = [];
  const now = Date.now();
  ['high', 'med', 'low'].forEach(prio => {
    ((s.todos || {})[prio] || []).forEach((t, i) => {
      s.tasks.push(makeTask({ id: t.id, title: t.label, priority: prio, done: !!t.done, sort: now + i }));
    });
  });
  delete s.todos;
}

/* 2026-07-29: Swiss application round. Kept so an old state gets the full history before jobHunt archives it. */
export function importBewerbungen(s) {
  if (s.meta.bewImport20260729) return;
  s.meta.bewImport20260729 = true;
  if (!s.bewerbungen) s.bewerbungen = [];
  const items = [
    { firma: 'Webkönig AG', rolle: 'Junior Web Publisher, 58k', status: 'beworben', date: '2026-07-26', next: 'Nachfassen ab 09.08.', notes: 'Severin Schefer · Kontaktformular' },
    { firma: 'cloudWEB', status: 'beworben', date: '2026-07-26', next: 'Nachfassen ab 09.08.', notes: 'Thomas Hasenfratz · info@cloudweb.ch' },
    { firma: 'Nordwand AG', status: 'beworben', date: '2026-07-26', next: 'Nachfassen ab 09.08.', notes: 'Silvan Widmer · info@nordwand.swiss' },
    { firma: 'RESIGN.', status: 'absage', date: '2026-07-26', next: '', notes: 'René Grob · info@resign.ch · Kein Platz' },
    { firma: 'WinWebDesign', status: 'beworben', date: '2026-07-26', next: 'Nachfassen ab 09.08.', notes: 'Jairo Thoma · info@winwebdesign.ch' },
    { firma: 'Netframe Studios', status: 'beworben', date: '2026-07-26', next: 'Nachfassen ab 09.08.', notes: 'Philipp Zähnler · kontakt@netframe-studios.ch' },
    { firma: 'BBK', status: 'beworben', date: '2026-07-26', next: 'Nachfassen ab 09.08.', notes: 'Markus Kammermann · service@agentur-bbk.ch' },
    { firma: 'Weitblick', status: 'absage', next: 'Zurück ab 03.08. · Tür offen', notes: 'Marcial Bollinger · Kein Platz (Praktikant verlängert)' },
    { firma: 'Kernbrand', status: 'absage', next: '', notes: 'Absage' },
    { firma: 'Vitamin2', status: 'absage', next: '', notes: 'R. Kappeler · Keine Kapazitäten' },
    { firma: 'Next AG', status: 'beworben', next: 'Anrufen — keine Rückmeldung (überfällig)', notes: '' },
    { firma: 'Digiplus', status: 'beworben', next: 'Anrufen — keine Rückmeldung (überfällig)', notes: '' },
    { firma: 'Liip AG', status: 'beworben', next: 'Anrufen — keine Rückmeldung (überfällig)', notes: '' },
    { firma: 'Faessler Media', status: 'beworben', next: 'Keine Rückmeldung', notes: '' }
  ];
  items.forEach(it => {
    const existing = s.bewerbungen.find(b => (b.firma || '').toLowerCase() === it.firma.toLowerCase());
    if (existing) {
      existing.status = it.status; existing.next = it.next;
      if (it.notes) existing.notes = existing.notes ? existing.notes + ' · ' + it.notes : it.notes;
      if (it.date) existing.date = it.date;
    } else {
      s.bewerbungen.push({ id: uid(), firma: it.firma, rolle: it.rolle || '', status: it.status, date: it.date || '', next: it.next || '', notes: it.notes || '' });
    }
  });
}

/* 2026-10-05: English UI. Only renames what the app itself seeded; user-written text stays untouched. */
const HABIT_EN = {
  'Deep Work Block': ['Deep work block', 'At least one 25-min focus session'],
  'Training / Bewegung': ['Training', 'Strength or sport session'],
  'Mahlzeiten + Protein': ['Meals + protein', 'Breakfast, lunch, dinner + shake']
};
export function english(s) {
  if (s.meta.english20261005) return;
  s.meta.english20261005 = true;
  s.habits.forEach(h => {
    const en = HABIT_EN[h.label];
    if (en) { h.label = en[0]; h.sub = en[1]; }
  });
}

/* 2026-10-06: the voice speaks briskly. The old Slow / Soft / Normal speeds (0.9–1.05) all become Brisk once. */
export function briskVoice(s) {
  if (s.meta.briskVoice20261006) return;
  s.meta.briskVoice20261006 = true;
  const v = s.settings && s.settings.voice;
  if (v && typeof v.rate === 'number' && v.rate < 1.1) v.rate = 1.15;
}

/* 2026-10-05: Bewerbungen (Swiss internships) -> Job Hunt (Berlin). Old entries are archived, not deleted. */
const STATUS_MAP = { entwurf: 'saved', beworben: 'applied', interview: 'interview', angebot: 'offer', absage: 'rejected' };
export function makeJob(f = {}) {
  const now = Date.now();
  return {
    id: f.id || uid(), company: f.company || '', role: f.role || '', type: f.type || 'other',
    location: f.location || 'Berlin', hoursPerWeek: f.hoursPerWeek ?? null, salary: f.salary || '',
    link: f.link || '', contact: f.contact || '', status: f.status || 'saved',
    appliedAt: f.appliedAt || '', nextAction: f.nextAction || '', nextActionDate: f.nextActionDate || '',
    notes: f.notes || '', archived: !!f.archived, source: f.source || 'app',
    createdAt: f.createdAt || now, updatedAt: now, deleted: false
  };
}
export function jobHunt(s) {
  if (s.meta.jobHunt20261005) { if (!s.jobs) s.jobs = []; return; }
  s.meta.jobHunt20261005 = true;
  s.jobs = s.jobs || [];
  (s.bewerbungen || []).forEach(b => {
    s.jobs.push(makeJob({
      id: b.id, company: b.firma, role: b.rolle, status: STATUS_MAP[b.status] || 'saved',
      appliedAt: b.date, nextAction: b.next, notes: b.notes, location: 'CH', archived: true, source: 'import'
    }));
  });
  delete s.bewerbungen;
}
