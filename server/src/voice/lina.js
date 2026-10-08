// Lina's hands-free turn: one request per spoken exchange ("Hey Lina, …" on the phone or the desktop), so the caller
// needs no streaming. Audio in → transcript → agent (or a spoken yes/no to a waiting invite) → reply + mp3 out.
// The yes/no to an outward action is matched here with fixed word lists, never by the model, so nothing an email or a
// web page says can approve anything: only Kevin's own short spoken answer right after Lina's question.
import { db } from '../db.js';
import { runAgent, decideAction } from '../agent/runner.js';
import { synthesize, transcribe } from './speech.js';

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

/**
 * One spoken exchange. awaiting = ids of actions Lina just asked about. Returns
 * {heard, reply, lang, conversationId, awaiting:[{id, summary}], listen, audio (base64 mp3 | null), voiceError}.
 */
export async function linaTurn({ audio, type, conversationId, awaiting = [], viaWake = false }) {
  const raw = await transcribe(audio, type);
  if (viaWake && !saidLina(raw)) return { heard: '', reply: '', lang: 'en', conversationId, awaiting: [], listen: false, audio: null, falseWake: true };
  const heard = stripWake(raw);
  let reply = '', lang = 'en', pending = [], cid = conversationId;
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
    const tools = [...new Set(waiting.map(a => a.tool))];
    reply = errors.length ? SAY[lang].fail + errors[0] : yn.answer === 'no' ? SAY[lang].no
      : tools.length === 1 && DONE[tools[0]] ? DONE[tools[0]][lang] : SAY[lang].done;
  } else {
    const r = await runAgent({ message: heard, conversationId: cid, trigger: 'voice' });
    cid = r.conversationId;
    reply = r.answer;
    lang = guessLang(reply);
    pending = db.all("SELECT id, summary FROM agent_actions WHERE run_id = ? AND status = 'pending' ORDER BY created_at", r.runId);
  }

  let mp3 = null, voiceError = null;
  if (reply) {
    try { mp3 = (await synthesize({ text: reply, lang })).audio.toString('base64'); }
    catch (e) { voiceError = e.message; }                          // the device speaks it with its own voice then
  }
  return {
    heard, reply, lang, conversationId: cid, awaiting: pending,
    listen: pending.length > 0 || /\?\s*$/.test(reply), audio: mp3, voiceError
  };
}
