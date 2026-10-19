// Talk to Lina (the agent) from anywhere, hands-free like the phone: tap once, then just talk. She notices when you
// stop (voice/mic.js), answers in the same natural voice and listens again, until you say nothing for a few seconds or
// close the bar. Each turn is one request (/api/voice/turn: speech-to-text, Claude with all of the agent's tools,
// the voice). She starts before you're done: at your first short pause what you said so far goes up (prepareTurn),
// so the server is already transcribing it and voicing the likely answer while the app waits to be sure you stopped.
// context = what Kevin just heard ('briefing' | 'world'), so "tell me more about the second one" makes sense to the agent.
import { notify } from '../core/store.js';
import { apiConfig } from '../core/api.js';
import { toast, tick } from '../core/fx.js';
import { runSync } from '../core/sync.js';
import { speak, stopSpeaking } from './tts.js';
import { canRecord } from './stt.js';
import { openMic, record } from './mic.js';
import { voiceTurn, prepareTurn, preparedFinished, warmLina } from './turn.js';
import { chatConversationId, logVoiceExchange } from '../views/assistant.js';

const MAX_TURNS = 8;
const FIRST_WAIT = 8000, NEXT_WAIT = 6000;      // how long she waits for you to start talking
// source 'wake': the desktop's "Hey Lina" (voice/wake.js) records and ends by itself in its own helper.
export const talk = { state: 'idle', context: null, heard: '', reply: '', source: null, at: 0 };
let run = 0, mic = null, endSpeech = null;
let awaiting = { ids: '', at: 0 };     // what Lina just asked yes/no about ("Shall I send Max the invite?")
const set = patch => { Object.assign(talk, patch, { at: Date.now() }); notify(); };
export const setTalk = set;
const cancelHooks = new Set();
export const onTalkCancel = fn => cancelHooks.add(fn);

export const canTalk = () => !!apiConfig() && canRecord() && !!(window.AudioContext || window.webkitAudioContext);

/** Tap to start talking. While she listens a tap sends right away; while she speaks it stops her and she listens. */
export async function toggleTalk(context = null) {
  if (talk.source === 'wake' && talk.state !== 'idle') return cancelTalk();
  if (talk.state === 'listening') { if (mic && mic.stop) mic.stop(); return; }
  if (talk.state === 'thinking') return;
  if (talk.state === 'speaking') { stopSpeaking(); if (endSpeech) endSpeech(); return; }
  if (!apiConfig()) { toast('Pair this device in Settings to talk to Lina.', 'amber'); return; }
  if (!canTalk()) { toast('This device can’t record audio here.', 'amber'); return; }
  converse(context);
}

/** Drop whatever is happening: close the microphone, stop the voice, ignore a late answer. */
export async function cancelTalk() {
  run++;
  closeMic();
  stopSpeaking();
  if (endSpeech) endSpeech();
  if (talk.source === 'wake') cancelHooks.forEach(fn => fn());
  set({ state: 'idle', heard: '', reply: '', source: null });
}

function closeMic() {
  if (!mic) return;
  if (mic.stop) mic.stop();
  mic.close();
  mic = null;
}

async function converse(context) {
  stopSpeaking();
  const my = ++run;
  set({ source: null, context, heard: '', reply: '' });
  try { mic = await openMic(); } catch { toast('Microphone permission denied.', 'flare'); set({ state: 'idle' }); return; }
  if (my !== run) { closeMic(); return; }
  warmLina();
  let last = {};                                                  // shown after the conversation ends
  try {
    for (let turn = 0; turn < MAX_TURNS && my === run; turn++) {
      tick('open');
      set({ state: 'listening', heard: '', reply: '' });
      // think ahead while we make sure he's done; the server also says whether the sentence was finished
      let prep = null, done = null;
      const wav = await record(mic, {
        waitMs: turn ? NEXT_WAIT : FIRST_WAIT,
        onPause: soFar => {
          const p = prep = prepareTurn(soFar);
          done = null;
          p.then(id => (id ? preparedFinished(id) : true)).then(f => { if (prep === p) done = f; });
        },
        onResume: () => { prep = null; done = null; },          // he went on: what was sent is out of date
        finished: () => (prep ? done : true)
      });
      if (my !== run) return;
      if (!wav) { if (!turn) toast('Didn’t catch that. Tap and try again.', 'amber'); break; }
      set({ state: 'thinking' });
      const opts = { type: 'audio/wav', conversationId: chatConversationId(), context, awaiting: Date.now() - awaiting.at < 10 * 60000 ? awaiting.ids : '' };
      let r;
      try { r = await voiceTurn(wav, { ...opts, prepared: prep ? await prep : null }); }
      catch (e) { if (my === run) toast(e.message, 'flare'); break; }
      if (my !== run) return;
      logVoiceExchange(r);
      if (r.tools && r.tools.length) runSync();                    // what she changed shows up right away
      awaiting = { ids: (r.awaiting || []).map(a => a.id).join(','), at: Date.now() };
      if (!r.heard) { if (!turn) toast('Didn’t catch that. Tap and try again.', 'amber'); break; }
      if (!r.reply) { set({ heard: r.heard }); continue; }
      last = { heard: r.heard, reply: r.reply };
      set({ state: 'speaking', ...last });
      await new Promise(done => {
        endSpeech = () => { endSpeech = null; done(); };
        speak(r.reply, () => endSpeech && endSpeech(), { what: 'talk', lang: r.lang, audioData: r.audio || undefined, onBlocked: () => endSpeech && endSpeech() });
      });
    }
  } finally {
    if (my === run) { closeMic(); set({ state: 'idle', ...last }); }
  }
}
