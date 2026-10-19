// Talk to Lina (the agent) from anywhere, hands-free like the phone: tap once, then just talk. She notices when you
// stop (voice/mic.js), answers in the same natural voice and listens again, until you say nothing for a few seconds or
// close the bar. Each turn is one request (/api/voice/turn: speech-to-text, Claude with all of the agent's tools,
// the voice). She starts before you're done: your words are transcribed live while you talk (voice/live.js), and at your
// first short pause they go up (prepareText; without live transcription the recording, prepareTurn), so the server
// already plans and voices the likely answer while the app waits to be sure you stopped.
// context = what Kevin just heard ('briefing' | 'world'), so "tell me more about the second one" makes sense to the agent.
import { notify } from '../core/store.js';
import { apiConfig } from '../core/api.js';
import { toast, tick } from '../core/fx.js';
import { runSync } from '../core/sync.js';
import { speak, stopSpeaking } from './tts.js';
import { canRecord } from './stt.js';
import { openMic, record } from './mic.js';
import { voiceTurn, prepareTurn, prepareText, preparedFinished, preparedVoice, warmLina } from './turn.js';
import { openLive } from './live.js';
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

/* Speaks a reply (base64 mp3 from the server when there is one) and resolves when it ends or is stopped. */
function say(text, lang, audio) {
  return new Promise(done => {
    endSpeech = () => { endSpeech = null; done(); };
    speak(text, () => endSpeech && endSpeech(), { what: 'talk', lang, audioData: audio || undefined, onBlocked: () => endSpeech && endSpeech() });
  });
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
  // Live transcription (voice/live.js): his words are written down while he talks. Audio from before it is connected
  // waits in `early` and goes up once it is; without it (no ElevenLabs key, no connection) recordings go up as before.
  let live = null, early = [], peeked = { text: '', at: 0 };
  openLive({
    onPartial: text => {
      // thinking while he talks: a partial that may already be the whole request gets its answer voiced ahead
      if (talk.state !== 'listening' || text === peeked.text || Date.now() - peeked.at < 400 || text.split(/\s+/).length < 3) return;
      peeked = { text, at: Date.now() };
      prepareText(text);
    }
  }).then(l => {
    if (my !== run || !l) { l?.close(); early = null; return; }
    live = l; early.forEach(a => l.send(a)); early = null;
  });
  let last = {};                                                  // shown after the conversation ends
  try {
    for (let turn = 0; turn < MAX_TURNS && my === run; turn++) {
      tick('open');
      set({ state: 'listening', heard: '', reply: '' });
      live?.reset();
      // think ahead while we make sure he's done; the server also says whether the sentence was finished, and
      // ahead is the answer it expects if this pause is the end, with its voice (spoken the moment he stops)
      let prep = null, done = null, ahead = null;
      const wav = await record(mic, {
        waitMs: turn ? NEXT_WAIT : FIRST_WAIT,
        onAudio: pcm => { if (live && live.ok) live.send(pcm); else if (early) early.push(pcm); },
        onPause: soFar => {
          done = null;
          if (live && live.ok) {                                  // the words are already there: send them, not audio
            const p = live.commit().then(text => (text ? prepareText(text) : null));
            const mine = prep = p.then(x => x && x.id);
            p.then(x => {
              if (prep !== mine) return;
              done = x ? x.finished : true;
              if (x && x.finished && x.say) ahead = { id: x.id, text: x.say, lang: x.lang, heard: x.heard, audio: preparedVoice(x.id) };
            });
            return;
          }
          const p = prep = prepareTurn(soFar);
          p.then(id => (id ? preparedFinished(id) : true)).then(f => { if (prep === p) done = f; });
        },
        onResume: () => { prep = null; done = null; ahead = null; },   // he went on: what was sent is out of date
        finished: () => (prep ? done : true)
      });
      if (my !== run) return;
      if (!wav) { if (!turn) toast('Didn’t catch that. Tap and try again.', 'amber'); break; }
      set({ state: 'thinking' });
      const opts = { type: 'audio/wav', conversationId: chatConversationId(), context, awaiting: Date.now() - awaiting.at < 10 * 60000 ? awaiting.ids : '' };
      const id = prep ? await prep : null;
      // "Zack, zack": the expected answer is already voiced, so she says it now while the turn saves the change
      const said = ahead && ahead.id === id ? await Promise.race([ahead.audio, new Promise(r => setTimeout(() => r(null), 150))]) : null;
      const pending = voiceTurn(wav, { ...opts, prepared: id });
      pending.catch(() => {});
      if (said) {
        last = { heard: ahead.heard, reply: ahead.text };
        set({ state: 'speaking', ...last });
        await say(ahead.text, ahead.lang, said);
        if (my !== run) return;
      }
      let r;
      try { r = await pending; }
      catch (e) { if (my === run) toast(e.message, 'flare'); break; }
      if (my !== run) return;
      logVoiceExchange(r);
      if (r.tools && r.tools.length) runSync();                    // what she changed shows up right away
      awaiting = { ids: (r.awaiting || []).map(a => a.id).join(','), at: Date.now() };
      if (said) {
        if (r.reply === ahead.text) continue;                     // it went as she said: listen again
        set({ state: 'thinking' });                               // it didn't (a calendar error …): say what happened
      }
      if (!r.heard) { if (!turn) toast('Didn’t catch that. Tap and try again.', 'amber'); break; }
      if (!r.reply) { set({ heard: r.heard }); continue; }
      last = { heard: r.heard, reply: r.reply };
      set({ state: 'speaking', ...last });
      await say(r.reply, r.lang, r.audio);
    }
  } finally {
    live?.close(); early = null;
    if (my === run) { closeMic(); set({ state: 'idle', ...last }); }
  }
}
