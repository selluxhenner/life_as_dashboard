// Lina's hands-free turn: one request per spoken exchange ("Hey Lina, …" on the phone or the desktop), so the caller
// needs no streaming. Audio in → transcript → agent (or a spoken yes/no to a waiting invite) → reply + mp3 out.
// The yes/no to an outward action is matched here with fixed word lists, never by the model, so nothing an email or a
// web page says can approve anything: only Kevin's own short spoken answer right after Lina's question.
import { db } from '../db.js';
import { runAgent, runDirect, recordExchange, decideAction, quickFor, warmQuick } from '../agent/runner.js';
import { getSetting } from '../settings.js';
import { planCommand, loadWorld } from './templates.js';
import { asData } from '../ai/claude.js';
import { briefingSpeech } from '../jobs/briefing.js';
import { worldSpeech } from '../jobs/news.js';
import { synthesize, transcribe } from './speech.js';

/* What Kevin was just listening to, so a spoken follow-up like "tell me more about the second one" makes sense. */
export function voiceContext(kind) {
  const heard = kind === 'briefing' ? briefingSpeech() : kind === 'world' ? worldSpeech() : null;
  if (!heard) return '';
  return (kind === 'briefing'
    ? 'Kevin just listened to his spoken morning briefing (below). He may ask follow-ups about it; look details up with tools.\n'
    : 'Kevin just listened to the spoken world news summary (below). For details use get_news.\n') + asData(kind + '_heard', heard);
}

/* "Hey Lina," / "Hoi Lina" / "Hallo Leena" at the start of a transcript (the phone sends the wake word along). */
const WAKE = /^\s*(?:(?:hey|hi|hoi|hallo|hello|okay|ok|he|hej)[\s,!.]+)?l(?:i|ee|e|ea|y)n+a\b[\s,!.:;-]*/i;
export const stripWake = text => String(text || '').replace(WAKE, '').trim();
/* The phone's keyword spotter errs on the side of waking up; the transcript has the last word. "Hey Linda" is not her. */
export const saidLina = text => /^\W*(?:[\p{L}']+[\s,!.]+){0,3}l(?:i|ee|e|ea|y)n+a\b/iu.test(String(text || ''));

const norm = s => String(s).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const FILLER = new Set(['lina', 'please', 'bitte', 'thanks', 'thank', 'you', 'danke', 'merci', 'oh', 'ah', 'äh', 'ähm', 'um', 'uh', 'well', 'also']);
const YES_START = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'go', 'send', 'do', 'absolutely', 'definitely', 'correct', 'right',
  'ja', 'jo', 'jep', 'jup', 'jawohl', 'klar', 'gern', 'gerne', 'gärn', 'genau', 'mach', 'machs', "mach's", 'schick', 'schicks', 'passt', 'sicher', 'logo']);
const NO_START = new Set(['no', 'nope', 'nah', "don't", 'dont', 'cancel', 'stop', 'never',
  'nein', 'nei', 'nai', 'nö', 'nee', 'ne', 'nöd', 'nid', 'nicht', 'lass', 'abbrechen', 'stopp']);
// any of these and it is not a plain yes ("yes, but make it 4", "ja, aber später")
const BUT = new Set(['but', 'not', "don't", 'dont', 'change', 'instead', 'later', 'wait', 'move', 'make', 'aber', 'nicht', 'nöd', 'nid', 'später', 'ändere', 'ändern', 'verschieb', 'statt', 'warte', 'doch']);
const GERMAN = new Set(['ja', 'jo', 'jep', 'jup', 'jawohl', 'klar', 'gern', 'gerne', 'gärn', 'genau', 'mach', 'machs', "mach's", 'schick', 'schicks', 'passt', 'sicher', 'logo',
  'nein', 'nei', 'nai', 'nö', 'nee', 'ne', 'nöd', 'nid', 'nicht', 'lass', 'abbrechen', 'stopp']);

/** 'yes' | 'no' | null for a short spoken answer to "Shall I send it?". Anything longer or hedged goes to Lina. */
export function yesNo(text) {
  const w = norm(text).split(' ').filter(x => x && !FILLER.has(x));
  if (!w.length || w.length > 5) return null;
  if (NO_START.has(w[0]) && w.length <= 4) return { answer: 'no', lang: GERMAN.has(w[0]) ? 'de' : 'en' };
  if (YES_START.has(w[0]) && !w.some(x => BUT.has(x))) return { answer: 'yes', lang: GERMAN.has(w[0]) ? 'de' : 'en' };
  return null;
}

/** en | de for the voice, from the reply itself (Lina answers in English or Standard German). */
const DE_WORDS = /\b(ich|du|dein|deine|der|die|das|und|ist|nicht|um|uhr|für|mit|habe|hab|eine?n?|heute|morgen|soll|schicke?|termin|einladung|erledigt|wann|wer|wie|gerne?)\b/gi;
const EN_WORDS = /\b(i|you|your|the|and|is|not|at|for|with|have|a|an|today|tomorrow|shall|send|meeting|invite|done|when|who|how)\b/gi;
export const guessLang = text => ((text.match(DE_WORDS) || []).length > (text.match(EN_WORDS) || []).length ? 'de' : 'en');

const SAY = {
  en: { no: 'Okay, I’ll leave it.', fail: 'That didn’t work: ', empty: 'Yes?', done: 'Done.' },
  de: { no: 'Okay, ich lasse es.', fail: 'Das hat nicht geklappt: ', empty: 'Ja?', done: 'Erledigt.' }
};
// what a "yes" did, per tool
const DONE = {
  send_invite: { en: 'Done, the invite is on its way.', de: 'Erledigt, die Einladung ist unterwegs.' },
  cancel_event: { en: 'Done, it’s cancelled.', de: 'Erledigt, der Termin ist abgesagt.' },
  update_event: { en: 'Done, it’s changed and the guests are told.', de: 'Erledigt, der Termin ist geändert und die Gäste wissen Bescheid.' },
  draft_email: { en: 'The email is ready: open it in the app to send it.', de: 'Die Mail ist vorbereitet: öffne sie in der App zum Senden.' },
  schedule_call: { en: 'Okay, I’ll call you.', de: 'Okay, ich rufe dich an.' }
};

const speak = (text, lang) => synthesize({ text, lang, fast: true }).then(r => r.audio.toString('base64'));

/* The prepared commands (Settings › Lina › Instant commands, on unless switched off): a plan from templates.js, run
   without the model. The sentence it will most likely say is voiced while the calls still run. */
async function instantTurn(plan, heard, cid) {
  let early = null;
  if (plan.calls.length && plan.expect) { early = speak(plan.expect, plan.lang); early.catch(() => {}); }
  let reply = plan.reply || '', pending = [], tools = [];
  if (plan.calls.length) {
    const r = await runDirect(plan.calls);
    tools = r.tools;
    const failed = r.results.find(x => x.isError);
    const waits = r.results.some(x => x.queued || x.result?.waiting);
    if (failed) reply = SAY[plan.lang].fail + failed.content.replace(/^Tool failed: /, '');
    else reply = waits ? plan.ask || plan.done : plan.done;
    if (waits) pending = db.all("SELECT id, summary FROM agent_actions WHERE run_id = ? AND status = 'pending' ORDER BY created_at", r.runId);
  }
  return { reply, lang: plan.lang, pending, tools, cid: recordExchange(cid, heard, reply), early: reply === plan.expect ? early : null };
}

/**
 * One spoken exchange. awaiting = ids of actions Lina just asked about; context = what Kevin just listened to
 * ('briefing' | 'world'). Returns {heard, reply, lang, conversationId, awaiting:[{id, summary}], tools:[{name, status,
 * summary}], listen, audio (base64 mp3 | null), voiceError, instant (answered by a prepared command), ms {stt, think, voice}}.
 */
export async function linaTurn({ audio, type, conversationId, awaiting = [], viaWake = false, context = null }) {
  warmQuick().catch(() => {});                                     // the model gets ready while Scribe listens
  const t0 = Date.now();
  const raw = await transcribe(audio, type);
  const t1 = Date.now();
  if (viaWake && !saidLina(raw)) return { heard: '', reply: '', lang: 'en', conversationId, awaiting: [], listen: false, audio: null, falseWake: true };
  const heard = stripWake(raw);
  let reply = '', lang = 'en', pending = [], cid = conversationId, early = null, plan = null;
  let tools = [];
  const waiting = awaiting.length ? db.all(`SELECT id, tool FROM agent_actions WHERE status = 'pending' AND id IN (${awaiting.map(() => '?').join(',')})`, ...awaiting) : [];
  const yn = waiting.length ? yesNo(heard) : null;

  if (!heard) {
    if (!viaWake || !raw.trim()) return { heard: '', reply: '', lang, conversationId: cid, awaiting: [], listen: false, audio: null };
    lang = /^\W*(hallo|hoi)\b/i.test(raw) ? 'de' : 'en';
    reply = SAY[lang].empty;                                       // only "Hey Lina" so far: ask what he wants
  } else if (yn) {
    lang = yn.lang;
    const errors = [];
    for (const a of waiting) {
      const r = await decideAction(a.id, yn.answer === 'yes');
      if (r.error) errors.push(r.error);
    }
    const kinds = [...new Set(waiting.map(a => a.tool))];
    reply = errors.length ? SAY[lang].fail + errors[0] : yn.answer === 'no' ? SAY[lang].no
      : kinds.length === 1 && DONE[kinds[0]] ? DONE[kinds[0]][lang] : SAY[lang].done;
  } else if (quickFor('voice') && getSetting('lina').instant !== false &&!(waiting.length && /^\W*(ja|jo|yes|yeah|nein|no|nö|nope)\b/i.test(heard)) &&
             (plan = planCommand(heard, loadWorld()))) {
    const r = await instantTurn(plan, heard, cid);
    ({ reply, lang, pending, tools, early } = r);
    cid = r.cid;
  } else {
    const onEvent = ev => { if (ev.type === 'tool') tools.push({ name: ev.name, status: ev.status, summary: ev.summary }); };
    const r = await runAgent({ message: heard, conversationId: cid, trigger: 'voice', onEvent, extraSystem: voiceContext(context) });
    cid = r.conversationId;
    reply = r.answer;
    lang = guessLang(reply);
    pending = db.all("SELECT id, summary FROM agent_actions WHERE run_id = ? AND status = 'pending' ORDER BY created_at", r.runId);
  }

  const t2 = Date.now();
  let mp3 = null, voiceError = null;
  if (reply) {
    try { mp3 = await (early || (plan || quickFor('voice') ? speak(reply, lang) : synthesize({ text: reply, lang }).then(r => r.audio.toString('base64')))); }
    catch (e) { voiceError = e.message; }                          // the device speaks it with its own voice then
  }
  return {
    heard, reply, lang, conversationId: cid, awaiting: pending, tools,
    listen: pending.length > 0 || /\?\s*$/.test(reply), audio: mp3, voiceError,
    instant: !!plan, ms: { stt: t1 - t0, think: t2 - t1, voice: Date.now() - t2 }
  };
}
