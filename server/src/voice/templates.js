// Lina's prepared commands. The things Kevin says most (add something to the calendar, move or cancel it, add / change /
// finish a task, "give me an overview") are recognised here in a few milliseconds, with fixed patterns in English and
// German, and turned into the same tool calls the model would make. No model call, no thinking: the answer is a template.
// Anything that is not an unambiguous match returns null and goes to the model as before, so a wrong guess never
// replaces asking. Outward effects (cancelling an event, changing one other people are on) still wait for his yes.
import { db } from '../db.js';
import { listOpenTodos } from '../routes/todos.js';
import { localDate, localTime, addDays } from '../lib/time.js';

/* ---------- small helpers ---------- */

// \b does not know ä/ö/ü; these do.
const B = '(?<![\\p{L}\\p{N}_])', E = '(?![\\p{L}\\p{N}_])';
const re = (src, flags = 'iu') => new RegExp(B + '(?:' + src + ')' + E, flags);
const full = src => new RegExp('^(?:' + src + ')$', 'iu');

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  ein: 1, eins: 1, eine: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, 'zwölf': 12 };
const NUMW = Object.keys(NUM).join('|');
const num = s => (/^\d+$/.test(s) ? +s : NUM[String(s).toLowerCase()]);
const DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6 };
const MONTHS = { jan: 1, feb: 2, mar: 3, 'mär': 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12 };
const MON = Object.keys(MONTHS).join('|');
const dow = date => new Date(date + 'T12:00:00Z').getUTCDay();
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);
const mins = t => +t.slice(0, 2) * 60 + +t.slice(3);
const hhmm = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

/* "at 3" for a meeting means 15:00; 7 and later stay as said; pm / am are taken literally. */
function clock(h, mi, x) {
  h = num(h);
  if (!(h >= 0 && h <= 23)) return null;
  x = (x || '').toLowerCase();
  if (x === 'pm' && h < 12) h += 12;
  else if (x === 'am' && h === 12) h = 0;
  else if (!x && h >= 1 && h <= 6) h += 12;
  return `${pad(h)}:${mi || '00'}`;
}

/**
 * Pulls the day, start / end time and length out of a phrase and returns what is left: {date, time, endTime, bad, rest}.
 * bareTo: also read "to 4" as a time (move the dentist to 4). bad = the phrase named two times it could not tell apart.
 */
export function extractWhen(input, today, { bareTo = false } = {}) {
  let s = ' ' + input + ' ';
  const out = { date: null, time: null, endTime: null, bad: false };
  const take = rx => { const m = rx.exec(s); if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); return m; };
  let m;
  // part of the day: "tonight at 8" is 20:00, "tomorrow morning at 6" is 06:00
  const evening = re('tonight|evening|afternoon|abends?|nachmittags?|heute\\s+nacht').test(s);
  const morning = re('morning|früh|vormittags?|morgens|heute\\s+morgen').test(s);
  take(re('(?:in\\s+the|this|am)\\s+(?:morning|evening|afternoon|morgen|abend|nachmittag|vormittag)|abends|morgens|nachmittags|vormittags'));

  // --- the day
  if ((m = take(re('(\\d{4})-(\\d{2})-(\\d{2})')))) out.date = ymd(+m[1], +m[2], +m[3]);
  else if ((m = take(re('(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})?')))) {
    out.date = ymd(m[3] ? +m[3] : +today.slice(0, 4), +m[2], +m[1]);
    if (out.date && !m[3] && out.date < today) out.date = ymd(+today.slice(0, 4) + 1, +m[2], +m[1]);
  } else if ((m = take(re(`(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s+(?:of\\s+)?(${MON})[a-zäé]*\\.?`))) || (m = take(re(`(${MON})[a-zäé]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?`)))) {
    const [d, mo] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    out.date = ymd(+today.slice(0, 4), MONTHS[mo.toLowerCase().slice(0, 3)], +d);
    if (out.date && out.date < today) out.date = ymd(+today.slice(0, 4) + 1, MONTHS[mo.toLowerCase().slice(0, 3)], +d);
  } else if (take(re('day after tomorrow|übermorgen|uebermorgen'))) out.date = addDays(today, 2);
  else if (take(re('(?:heute|heut|hüt|today|this)\\s+(?:morgen|morning|abend|evening|nachmittag|afternoon)|heute|heut|hüt|today|tonight'))) out.date = today;
  else if (take(re('(?:tomorrow|morgen|morn)(?:\\s+(?:morning|evening|afternoon|night|früh|abend|vormittag|nachmittag))?'))) out.date = addDays(today, 1);
  else if ((m = take(re(`in\\s+(\\d+|${NUMW})\\s+(days?|tagen?|weeks?|wochen?)`)))) out.date = addDays(today, num(m[1]) * (/^w/i.test(m[2]) ? 7 : 1));
  else if ((m = take(re(`(?:(?:next|on|this|nächsten?|kommenden?|am|diesen)\\s+)?(${Object.keys(DAYS).join('|')})`)))) out.date = addDays(today, ((DAYS[m[1].toLowerCase()] - dow(today) + 7) % 7) || 7);

  // --- the time
  const TT = `(\\d{1,2}|${NUMW})(?:[:.]([0-5]\\d))?\\s*(am|pm|uhr)?`;
  const LEAD = '(?:(?:at|um|@|gegen|by|from|von)\\s+)?';
  if ((m = take(re(`(?:from|von|between|zwischen|at|um)\\s+${TT}\\s*(?:to|until|till|bis|und|and|-|–)\\s*${TT}`)))) {
    out.time = clock(m[1], m[2], m[3] || m[6]);
    out.endTime = clock(m[4], m[5], m[6] || m[3]);
  } else if ((m = take(re(`${LEAD}(\\d{1,2}):([0-5]\\d)\\s*(am|pm|uhr)?`)))) out.time = clock(m[1], m[2], m[3]);
  else if ((m = take(re(`${LEAD}(\\d{1,2}|${NUMW})(?:\\.([0-5]\\d))?\\s*(am|pm|uhr|o'?clock)`)))) out.time = clock(m[1], m[2], /clock/i.test(m[3]) ? '' : m[3]);
  else if ((m = take(re(`(?:at|um|@|gegen|by)\\s+(\\d{1,2}|${NUMW})(?![.:,]?\\d)`)))) out.time = clock(m[1]);
  else if ((m = take(re(`halb\\s+(\\d{1,2}|${NUMW})`)))) { const h = clock(m[1]); out.time = h && hhmm(mins(h) - 30); }
  else if (take(re('noon|midday|mittags?'))) out.time = '12:00';
  else if (bareTo && (m = take(re(`(?:to|auf|for)\\s+(\\d{1,2}|${NUMW})(?![.:,]?\\d)`)))) out.time = clock(m[1]);
  // a second time is left over ("move my 3 o'clock to 4"): which one is meant is for the model to work out
  if (/\d\s*(am|pm|uhr)|\d:\d{2}/i.test(s) || (out.time && re(`(?:at|um|to|auf|bis)\\s+(\\d{1,2}|${NUMW})(?![.:,]?\\d)`).test(s))) out.bad = true;
  const shift = (t, by) => t && hhmm(mins(t) + by);
  if (evening && out.time && out.time < '12:00') { out.time = shift(out.time, 720); out.endTime = out.endTime < '12:00' ? shift(out.endTime, 720) : out.endTime; }
  else if (morning && !evening && out.time >= '13:00' && out.time < '19:00') { out.time = shift(out.time, -720); out.endTime = out.endTime >= '13:00' ? shift(out.endTime, -720) : out.endTime; }

  if (out.time && !out.endTime && (m = take(re(`for\\s+(\\d+|an?|${NUMW})\\s+(hours?|hrs?|minutes?|mins?)|(\\d+|${NUMW})\\s+(stunden?|minuten?)|half an hour|eine halbe stunde`)))) {
    const t = m[0].toLowerCase();
    const n = /half|halbe/.test(t) ? 0.5 : (num(m[1] || m[3]) || 1);
    const unit = /min/.test(t) ? 1 : 60;
    const end = mins(out.time) + Math.round(unit === 1 ? n : n * 60);
    out.endTime = end < 24 * 60 ? hhmm(end) : null;
  }
  if (out.time && out.endTime && out.endTime <= out.time) out.endTime = null;
  out.date = out.date || null;
  out.rest = s.replace(/\s+/g, ' ').trim();
  return out;
}

const EDGE = 'on|at|for|to|um|am|auf|für|zum|zur|bis|von|from|by|the|a|an|and|und|in|im|then|also|dann|den|die|das|der|dem|my|mein|meine|meinen|please|bitte';
const trimEdges = s => s.replace(new RegExp(`^(?:(?:${EDGE})\\s+)+`, 'iu'), '').replace(new RegExp(`(?:\\s+(?:${EDGE}|hinzu|dazu|ein))+$`, 'iu'), '').replace(/^[\s:,.-]+|[\s:,.-]+$/g, '').trim();
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---------- speaking ---------- */

const LANGS = { en: 'en-GB', de: 'de-DE' };
const quote = (t, lang) => (lang === 'de' ? `„${t}“` : `“${t}”`);
function sayTime(t, lang) {
  const h = +t.slice(0, 2), m = t.slice(3);
  if (lang === 'de') return m === '00' ? `${h} Uhr` : `${h}:${m} Uhr`;
  return `${h % 12 || 12}${m === '00' ? '' : ':' + m} ${h < 12 ? 'AM' : 'PM'}`;
}
function sayDay(date, today, lang) {
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  if (diff === 0) return lang === 'de' ? 'heute' : 'today';
  if (diff === 1) return lang === 'de' ? 'morgen' : 'tomorrow';
  const d = new Date(date + 'T12:00:00Z');
  if (diff > 1 && diff < 7) return d.toLocaleDateString(LANGS[lang], { weekday: 'long', timeZone: 'UTC' });
  return d.toLocaleDateString(LANGS[lang], { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
const sayWhen = (date, time, today, lang) => [date && sayDay(date, today, lang), time && (lang === 'de' ? 'um ' : date ? 'at ' : '') + sayTime(time, lang)].filter(Boolean).join(' ');
const sayList = (items, lang) => (items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + (lang === 'de' ? ' und ' : ' and ') + items.at(-1));
const plural = (n, one, many) => (n === 1 ? one : many);

/* ---------- finding what he means ---------- */

const STOP = new Set(('my the a an this that it its task tasks todo todos to-do to do aufgabe aufgaben event events meeting meetings appointment appointments termin termine calendar kalender ' +
  'please mark as is are was i ive im i\'ve i\'m have has with off from out of on at for into onto um am auf zum zur zu von bis in im mein meine meinen meiner meinem dem die der das den ein eine einen ich ' +
  'habe hab bin ist sind mit als noch bitte lina also then and und now delete remove cancel drop scrap trash done finished finish complete completed move reschedule push postpone shift change rename edit ' +
  'update make set priority prio high low medium hohe niedrige tiefe lösche lösch entferne streiche sage ab verschiebe verlege ändere erledigt fertig ab').split(/\s+/));
const tok = s => String(s).toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [];
const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/* The one item whose title fits the words Kevin said, or null when none does or two do about equally well. */
function pick(query, items) {
  const q = tok(query).filter(w => !STOP.has(w));
  if (!q.length) return null;
  const scored = items.map(it => {
    const c = tok(it.title), used = new Set();
    let hit = 0;
    for (const w of q) {
      const i = c.findIndex((x, k) => !used.has(k) && same(w, x));
      if (i >= 0) { used.add(i); hit++; }
    }
    return { it, cover: hit / q.length, dice: (2 * hit) / (q.length + c.length) };
  }).filter(s => s.cover >= (q.length <= 2 ? 0.99 : 0.67)).sort((a, b) => b.dice - a.dice);
  if (!scored.length || (scored[1] && scored[0].dice - scored[1].dice < 0.1)) return null;
  return scored[0];
}

/* ---------- the commands ---------- */

const KIND_TODO = 'task|todo|to-do|to do|aufgabe|erinnerung|reminder';
const KIND_EVENT = 'event|appointment|meeting|calendar entry|block|termin|ereignis|eintrag';
const ADD_LEAD = new RegExp('^(?:(?:please|can you|could you|bitte|kannst du|könntest du)\\s+)?' +
  '(?:(?:add|create|schedule|book|put|set up|new|remind me to|remind me|füge|fuge|trag|trage|erstelle|erstell|lege|leg|plane|buche|neue[rn]?|neu|erinner(?:e)?\\s+mich(?:\\s+daran|\\s+an)?)\\s+)' +
  '(?:(?:mir|mich)\\s+)?(?:(?:a|an|the|my|new|another|einen|eine|ein|den|die|das|neue|neuen|neuer|mein|meinen|meine)\\s+)*' +
  `(?:(?<tk>${KIND_TODO})\\s+|(?<ek>${KIND_EVENT})\\s+)?(?:(?:called|named|for|to|about|that|namens|für|zu|daran|dass)\\s+)?`, 'iu');
const CAL_BOX = re('(?:to|in|on|into|onto|at|zum|zu|in|im|ins|auf)\\s+(?:my |the |our |den |die |das |dem |meinen |meine |meinem )*(?:calendar|kalender)(?:\\s+(?:hinzu|ein|dazu))?');
const TASK_BOX = re('(?:to|in|on|into|onto|zu|zur|zum|in|auf|ins)\\s+(?:my |the |our |den |die |das |dem |meinen |meine |meiner )*(?:tasks?(?:\\s+list)?|to-?do(?:s|\\s+list)?|todos|list|aufgaben(?:liste)?|todo-?(?:liste|s)?|liste)(?:\\s+(?:hinzu|ein|dazu))?');
const PRIO = re('(urgent|dringend)|(high|low|med(?:ium)?|hohe?|niedrige?|tiefe?)\\s+(?:priority|prio\\w*|priorität)');
const priorityOf = w => (/^(urgent|dringend|high|hohe?)$/i.test(w) ? 'high' : /^(low|niedrige?|tiefe?)$/i.test(w) ? 'low' : 'med');
const NEEDS_PEOPLE = /\b(with|mit|invite|einlad\w*|video|zoom|teams|google meet|call(?:ing)? (?:with|mit)|anruf mit)\b/i;

const DE_WORDS = /\b(ich|mein\w*|mir|mich|bitte|termin\w*|aufgabe\w*|füge|fuge|trag\w*|lösch\w*|verschieb\w*|verleg\w*|erledigt|morgen|heute|übermorgen|hüt|uhr|zum|zur|für|und|das|die|der|den|dem|eine?n?|neue\w*|streich\w*|erinner\w*|was|habe|steht|überblick|übersicht|nächste\w*|ändere|benenn\w*|absag\w*|kalender|hinzu|ist|fertig|abgehakt|hake)\b/gi;
const EN_WORDS = /\b(i|my|me|the|and|to|at|add|delete|remove|move|cancel|tomorrow|today|task|tasks|todo|meeting|appointment|calendar|done|finished|please|what|have|overview|rename|change|reschedule|for|on)\b/gi;
const langOf = t => ((t.match(DE_WORDS) || []).length > (t.match(EN_WORDS) || []).length ? 'de' : 'en');

const OVERVIEW = [
  full('(?:(?:give|tell|show|read)\\s+me\\s+)?(?:an?\\s+|my\\s+|the\\s+)?(?:(?:quick|short|daily)\\s+)?(?:overview|summary|rundown|agenda)(?:\\s+(?:of|for)\\s+.*)?'),
  full('what(?:\'s|\\s+is)?\\s+(?:on|up|happening)(?:\\s+.*)?'),
  full('what\\s+do\\s+i\\s+have(?:\\s+.*)?'),
  full('what(?:\'s|\\s+is|\\s+are)?\\s+(?:on\\s+)?my\\s+(?:day|schedule|calendar|plan|agenda|week)(?:\\s+.*)?'),
  full('how\\s+(?:does|is)\\s+my\\s+(?:day|week|schedule)\\s+look(?:\\s+.*)?'),
  full('(?:gib(?:\\s+mir)?|zeig(?:\\s+mir)?|sag(?:\\s+mir)?)?\\s*(?:einen\\s+|eine\\s+|meinen\\s+|meine\\s+|die\\s+|den\\s+)?(?:(?:kurzen|kleinen|schnellen)\\s+)?(?:überblick|ueberblick|übersicht|uebersicht|tagesübersicht|zusammenfassung|tagesplan)(?:\\s+.*)?'),
  full('was\\s+(?:steht|habe\\s+ich|hab\\s+ich|liegt|ist\\s+los)\\b.*'),
  full('wie\\s+sieht\\s+mein\\s+(?:tag|heute|morgen|plan|kalender)\\b.*')
];
const TASKS_ASK = full('(?:what(?:\'s|\\s+is|\\s+are)?|which|list|show|read|tell|give)\\b.*\\b(?:tasks|todos|to-dos|open tasks)|(?:was|welche|zeig|lies|nenn|sag)\\b.*\\b(?:aufgaben|todos)');

function overview(low, world, today, lang) {
  const w = extractWhen(low, today);
  const date = w.date || today;
  const dayWord = date === today ? (lang === 'de' ? 'heute' : 'today') : sayDay(date, today, lang);
  const tasksOnly = TASKS_ASK.test(low) && !/\b(calendar|kalender|schedule|day|tag|termin\w*|meetings?|events?)\b/i.test(low);
  const parts = [];
  if (!tasksOnly) {
    const evs = world.events.filter(e => e.from <= date && date <= e.to).sort((a, b) => (a.allDay ? '' : a.time).localeCompare(b.allDay ? '' : b.time));
    if (!evs.length) parts.push(lang === 'de' ? `${cap(dayWord)} ist nichts im Kalender.` : `Nothing on your calendar ${dayWord}.`);
    else {
      const shown = evs.slice(0, 4).map(e => `${e.title || (lang === 'de' ? 'Ohne Titel' : 'Untitled')} ${e.allDay ? (lang === 'de' ? 'ganztägig' : 'all day') : (lang === 'de' ? 'um ' : 'at ') + sayTime(e.time, lang)}`);
      if (evs.length > 4) shown.push(lang === 'de' ? `${evs.length - 4} weitere` : `${evs.length - 4} more`);
      parts.push((lang === 'de' ? `${evs.length} ${plural(evs.length, 'Termin', 'Termine')} ${dayWord}: ` : `${evs.length} ${plural(evs.length, 'event', 'events')} ${dayWord}: `) + sayList(shown, lang) + '.');
    }
  }
  const open = world.todos;
  const rank = t => (t.priority === 'high' ? 0 : 1);
  const due = open.filter(t => (tasksOnly ? true : t.due && t.due <= date)).sort((a, b) => rank(a) - rank(b) || String(a.due || '9').localeCompare(String(b.due || '9')));
  if (due.length) {
    const names = due.slice(0, 3).map(t => t.title);
    if (due.length > 3) names.push(lang === 'de' ? `${due.length - 3} weitere` : `${due.length - 3} more`);
    parts.push(tasksOnly
      ? (lang === 'de' ? `${due.length} offene ${plural(due.length, 'Aufgabe', 'Aufgaben')}: ` : `${due.length} open ${plural(due.length, 'task', 'tasks')}: `) + sayList(names, lang) + '.'
      : (lang === 'de' ? `${due.length} ${plural(due.length, 'Aufgabe', 'Aufgaben')} fällig: ` : `${due.length} ${plural(due.length, 'task', 'tasks')} due: `) + sayList(names, lang) + '.');
  } else if (open.length) parts.push(lang === 'de' ? `Keine Aufgaben fällig, ${open.length} offen insgesamt.` : `No tasks due, ${open.length} open in total.`);
  else parts.push(lang === 'de' ? 'Keine offenen Aufgaben.' : 'No open tasks.');
  return { lang, calls: [], reply: parts.join(' '), kind: 'overview' };
}

function planAdd(text, today, nowTime, world, lang) {
  const lead = ADD_LEAD.exec(text);
  if (!lead) return null;
  const remind = /^(?:please\s+)?(?:remind me|erinner)/i.test(text);
  let body = text.slice(lead[0].length);
  const w = extractWhen(body, today);
  if (w.bad) return null;
  body = w.rest;
  const taskBox = TASK_BOX.test(body), calBox = CAL_BOX.test(body) || /\b(calendar|kalender)\b/i.test(body);
  let ek = !!lead.groups.ek;
  if (ek && taskBox && !calBox) { body = lead.groups.ek + ' ' + body; ek = false; }   // "add meeting notes to my tasks"
  const cal = ek || calBox || /^(?:please\s+)?(?:schedule|book|plane|buche)\b/i.test(text);
  const task = !!lead.groups.tk || taskBox || remind;
  body = body.replace(CAL_BOX, ' ').replace(TASK_BOX, ' ');
  let priority;
  const p = PRIO.exec(body);
  if (p) { priority = priorityOf(p[1] || p[2]); body = body.replace(PRIO, ' '); }
  let title = trimEdges(body.replace(/\s+/g, ' ').trim().replace(/^(?:daran|dass|an)\s+/i, ''));
  if (remind) title = trimEdges(title.replace(/\s+zu\s+([\p{L}]+)$/u, ' $1'));          // "die Miete zu zahlen" → "Miete zahlen"
  if (title.length < 2 || title.length > 120 || /^(it|that|this|das|es|dies)$/i.test(title)
      || new RegExp(`^(?:new\\s+|neue[nr]?\\s+)?(?:${KIND_TODO}|${KIND_EVENT})s?$`, 'i').test(title)) return null;   // "add a task": which one is still to come
  const T = cap(title);

  if (cal || w.time) {
    if (!w.time || NEEDS_PEOPLE.test(text)) return null;       // no time: ask; guests / video: the model prepares the invite
    const date = w.date || (w.time > nowTime ? today : null);
    if (!date) return null;
    const end = w.endTime || hhmm(Math.min(mins(w.time) + 60, 23 * 60 + 59));
    const clash = world.events.filter(e => !e.allDay && e.from <= date && date <= e.to && e.time < end && e.endTime > w.time)[0];
    const when = sayWhen(date, w.time, today, lang);
    const calls = [{ name: 'add_calendar_block', input: { title: T, date, time: w.time, ...(w.endTime ? { endTime: w.endTime } : {}) } }];
    if (task && !cal) calls.unshift({ name: 'create_todo', input: { title: T, due: date, ...(priority ? { priority } : {}) } });
    const note = clash ? (lang === 'de' ? ` Achtung, das überschneidet sich mit ${quote(clash.title, lang)}.` : ` Heads-up, that overlaps with ${quote(clash.title, lang)}.`) : '';
    const done = calls.length === 2
      ? (lang === 'de' ? `Aufgabe ${quote(T, lang)} angelegt und ${when} im Kalender geblockt.` : `Added ${quote(T, lang)} as a task and blocked ${when}.`)
      : (lang === 'de' ? `${quote(T, lang)} steht ${when} im Kalender.` : `Added ${quote(T, lang)} ${when}.`);
    return { lang, calls, done: done + note, kind: 'add_event' };
  }
  if (NEEDS_PEOPLE.test(text) && !task) return null;
  const input = { title: T, ...(w.date ? { due: w.date } : {}), ...(priority ? { priority } : {}) };
  const due = w.date ? sayDay(w.date, today, lang) : null;
  return {
    lang, calls: [{ name: 'create_todo', input }], kind: 'add_todo',
    done: lang === 'de' ? `Aufgabe ${quote(T, lang)} hinzugefügt${due ? `, fällig ${due}` : ''}.` : `Added ${quote(T, lang)}${due ? ` for ${due}` : ''}.`
  };
}

const DEL = re('delete|remove|drop|scrap|trash|cancel|lösch\\w*|entfern\\w*|streich\\w*|absag\\w*|storn\\w*');
const DONE = re('done|finish(?:ed)?|completed?|check(?:ed)?\\s+off|tick(?:ed)?\\s+off|cross(?:ed)?\\s+off|erledigt|fertig|abgehakt|abhaken|hake?|abschließ\\w*|schließe?\\w*\\s+ab');
const MOVE = re('move|reschedule|push|postpone|shift|delay|verschieb\\w*|verleg\\w*|versetz\\w*|change|edit|update|ändere?\\w*|änder\\w*');
const RENAME = /^(?:please\s+|bitte\s+)?(?:rename|umbenenn\w*|benenn\w*)\s+(.+?)\s+(?:to|into|zu|in|auf)\s+(.+)$/iu;
const SETPRIO = /\b(?:make|set|mark|change|setze?|mach\w*|änder\w*)\b/i;
const IS_TASK = re('tasks?|todos?|to-do|aufgabe\\w*'), IS_EVENT = re('events?|meetings?|appointments?|calendar|termin\\w*|kalender');

function planEdit(text, today, world, lang) {
  const rename = RENAME.exec(text);
  const prio = PRIO.exec(text);
  const kind = IS_TASK.test(text) ? 'todo' : IS_EVENT.test(text) ? 'event' : null;
  let verb = null;
  if (rename) verb = 'rename';
  else if (prio && SETPRIO.test(text)) verb = 'priority';
  else if (DONE.test(text)) verb = 'done';
  else if (DEL.test(text)) verb = 'delete';
  else if (MOVE.test(text)) verb = 'move';
  if (!verb) return null;

  const w = extractWhen(rename ? rename[1] : text, today, { bareTo: verb === 'move' });
  if (w.bad) return null;
  const query = [DEL, DONE, MOVE, PRIO].reduce((q, r) => q.replace(new RegExp(r.source, 'giu'), ' '), w.rest);
  const todos = kind === 'event' ? [] : world.todos;
  let events = kind === 'todo' || verb === 'done' || verb === 'priority' ? [] : world.events.filter(e => e.kind !== 'lesson' && String(e.id).includes(':'));
  if (verb !== 'move' && verb !== 'rename') {                  // a day / time named while deleting selects the event
    if (w.date) events = events.filter(e => e.from <= w.date && w.date <= e.to);
    if (w.time) events = events.filter(e => !e.allDay && e.time === w.time);
  }
  let hit = null, which = null;
  const t = pick(query, todos), e = pick(query, events);
  if (t && e) { if (Math.abs(t.dice - e.dice) < 0.1) return null; }
  if (t && (!e || t.dice > e.dice)) { hit = t.it; which = 'todo'; }
  else if (e) { hit = e.it; which = 'event'; }
  else if (verb === 'delete' && !tok(query).some(x => !STOP.has(x)) && w.time && events.length === 1) { hit = events[0]; which = 'event'; }   // "cancel my 3 o'clock"
  if (!hit) return null;
  const name = quote(hit.title, lang);
  const de = lang === 'de';

  if (verb === 'done') {
    if (which !== 'todo') return null;
    return { lang, calls: [{ name: 'complete_todo', input: { id: hit.id } }], done: de ? `${name} ist abgehakt.` : `Marked ${name} as done.`, kind: 'complete' };
  }
  if (verb === 'priority') {
    if (which !== 'todo') return null;
    const level = priorityOf(prio[1] || prio[2]);
    return { lang, calls: [{ name: 'update_todo', input: { id: hit.id, priority: level } }], done: de ? `${name} hat jetzt ${level === 'high' ? 'hohe' : level === 'low' ? 'niedrige' : 'normale'} Priorität.` : `${name} is now ${level === 'med' ? 'normal' : level} priority.`, kind: 'priority' };
  }
  if (verb === 'delete') {
    if (which === 'todo') return { lang, calls: [{ name: 'delete_todo', input: { id: hit.id, title: hit.title } }], done: de ? `${name} gelöscht.` : `Deleted ${name}.`, kind: 'delete_todo' };
    const ask = de ? `Soll ich ${name} absagen?` : `Shall I cancel ${name}?`;
    return { lang, calls: [{ name: 'cancel_event', input: { id: hit.id, title: hit.title } }], ask, expect: ask, kind: 'cancel_event' };
  }
  if (verb === 'rename') {
    const title = cap(trimEdges(rename[2].trim()));
    if (title.length < 2) return null;
    const calls = which === 'todo' ? [{ name: 'update_todo', input: { id: hit.id, title } }] : [{ name: 'move_event', input: { id: hit.id, title } }];
    return { lang, calls, done: de ? `${name} heißt jetzt ${quote(title, lang)}.` : `Renamed ${name} to ${quote(title, lang)}.`,
      ask: de ? `Bei ${name} sind Gäste eingeladen. Soll ich ändern und sie informieren?` : `${name} has guests. Shall I change it and tell them?`, kind: 'rename' };
  }
  // move / reschedule
  if (!w.date && !w.time) return null;
  if (which === 'todo') {
    if (w.time || !w.date) return null;
    return { lang, calls: [{ name: 'update_todo', input: { id: hit.id, due: w.date } }], done: de ? `${name} ist jetzt ${sayDay(w.date, today, lang)} fällig.` : `Moved ${name} to ${sayDay(w.date, today, lang)}.`, kind: 'move_todo' };
  }
  const input = { id: hit.id, ...(w.date ? { date: w.date } : {}), ...(w.time ? { time: w.time } : {}), ...(w.endTime ? { endTime: w.endTime } : {}) };
  const when = sayWhen(w.date, w.time, today, lang);
  return {
    lang, calls: [{ name: 'move_event', input }], kind: 'move_event',
    done: de ? `${name} ist jetzt ${when}.` : `Moved ${name} to ${when}.`,
    ask: de ? `Bei ${name} sind Gäste eingeladen. Soll ich ihn verschieben, ${when}, und sie informieren?` :`${name} has guests. Shall I move it to ${when} and tell them?`
  };
}

const FLUFF = /^(?:(?:hey|hi|hoi|hallo|okay|ok|lina|please|bitte|can you|could you|would you|kannst du|könntest du|kannst du mir|würdest du)[\s,]+)+/iu;

/**
 * planCommand(heard, world, now) -> null | {lang, kind, calls:[{name, input}], done?, ask?, expect?, reply?}
 * world = {todos:[{id,title,due,priority}], events:[{id,kind,title,from,to,time,endTime,allDay}]}.
 * No calls: reply is the whole answer. With calls: done is said when they went through, ask when something waits for
 * his OK, expect is the sentence worth speaking while the calls still run (nothing else could come out of them).
 */
export function planCommand(heard, world, now = new Date()) {
  const raw = String(heard || '').trim();
  if (!raw || raw.length > 160) return null;
  let text = raw.replace(/[“”„"]/g, '').replace(/[?!]+\s*$/, '').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  text = text.replace(FLUFF, '').replace(/\s+(?:please|bitte|thanks|danke)$/i, '').trim();
  if (!text) return null;
  const today = localDate(now), nowTime = localTime(now);
  const lang = langOf(text);
  // two commands in one breath: the model
  if (/\b(?:and|und|then|dann|also|außerdem)\s+(?:add|delete|remove|move|cancel|mark|complete|rename|lösch\w*|füge|trag\w*|verschieb\w*|streich\w*|erinner\w*)\b/i.test(text)) return null;
  if (OVERVIEW.some(r => r.test(text)) || (TASKS_ASK.test(text) && !ADD_LEAD.test(text) && !DEL.test(text))) return overview(text.toLowerCase(), world, today, lang);
  const plan = ADD_LEAD.test(text) ? planAdd(text, today, nowTime, world, lang) : planEdit(text, today, world, lang);
  if (plan && !plan.reply && !plan.done && !plan.ask) return null;
  if (plan && plan.done && !plan.expect) plan.expect = plan.done;
  return plan;
}

/** What the templates see: open todos and the calendar from yesterday to two weeks out, as plain objects. */
export function loadWorld(now = new Date()) {
  const today = localDate(now);
  const todos = listOpenTodos().map(t => ({ id: t.id, title: t.title, due: t.due, priority: t.priority }));
  const rows = db.all('SELECT id, kind, title, start, end, all_day FROM calendar_events WHERE start < ? AND end >= ? ORDER BY start LIMIT 200', addDays(today, 15), addDays(today, -1));
  const events = rows.map(e => {
    if (e.all_day) {
      const from = String(e.start).slice(0, 10), last = addDays(String(e.end).slice(0, 10), -1);
      return { id: e.id, kind: e.kind, title: e.title, from, to: last > from ? last : from, time: '', endTime: '', allDay: true };
    }
    const s = new Date(e.start), end = new Date(e.end);
    return { id: e.id, kind: e.kind, title: e.title, from: localDate(s), to: localDate(s), time: localTime(s), endTime: localTime(end), allDay: false };
  });
  return { todos, events };
}
