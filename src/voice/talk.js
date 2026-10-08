// Talk to Lina (the agent) from anywhere: tap to speak, tap again to send, and the answer comes back in the same natural voice.
// One request does it all (/api/voice/turn: speech-to-text, Claude with all of the agent's tools, the voice), and the
// server gets the model ready while Kevin is still talking. Every exchange also lands in the Agent chat.
// context = what Kevin just heard ('briefing' | 'world'), so "tell me more about the second one" makes sense to the agent.
import { notify } from '../core/store.js';
import { apiConfig } from '../core/api.js';
import { toast, tick } from '../core/fx.js';
import { speak, stopSpeaking } from './tts.js';
import { canRecord, startRecording, stopRecording } from './stt.js';
import { voiceTurn, warmLina } from './turn.js';
import { chatConversationId, logVoiceExchange } from '../views/assistant.js';

const MAX_MS = 60000;                 // a question longer than a minute is sent anyway
// source 'wake': the desktop's "Hey Lina" (voice/wake.js) records and ends by itself, there is no Send.
export const talk = { state: 'idle', context: null, heard: '', reply: '', source: null, at: 0 };
let timer = null, run = 0;
let awaiting = { ids: '', at: 0 };     // what Lina just asked yes/no about ("Shall I send Max the invite?")
const set = patch => { Object.assign(talk, patch, { at: Date.now() }); notify(); };
export const setTalk = set;
const cancelHooks = new Set();
export const onTalkCancel = fn => cancelHooks.add(fn);

export const canTalk = () => !!apiConfig() && canRecord();

/** Tap once to start listening, again to send; while it speaks, a tap stops it. */
export async function toggleTalk(context = null) {
  if (talk.source === 'wake' && talk.state !== 'idle') return cancelTalk();
  if (talk.state === 'listening') return finishListening();
  if (talk.state === 'thinking') return;
  if (talk.state === 'speaking') { stopSpeaking(); set({ state: 'idle' }); return; }
  if (!apiConfig()) { toast('Pair this device in Settings to talk to Lina.', 'amber'); return; }
  if (!canRecord()) { toast('This device can’t record audio here.', 'amber'); return; }
  stopSpeaking();
  const my = ++run;
  set({ source: null });
  try { await startRecording(); } catch { toast('Microphone permission denied.', 'flare'); return; }
  if (my !== run) { stopRecording(); return; }
  warmLina();
  tick('open');
  set({ state: 'listening', context, heard: '', reply: '' });
  timer = setTimeout(finishListening, MAX_MS);
}

/** Drop whatever is happening: discard the recording, stop the voice, ignore a late answer. */
export async function cancelTalk() {
  run++;
  clearTimeout(timer);
  if (talk.state === 'listening' && talk.source !== 'wake') await stopRecording();
  stopSpeaking();
  if (talk.source === 'wake') cancelHooks.forEach(fn => fn());
  set({ state: 'idle', heard: '', reply: '', source: null });
}

async function finishListening() {
  if (talk.state !== 'listening') return;
  clearTimeout(timer);
  const my = run;
  set({ state: 'thinking' });
  const blob = await stopRecording();
  const missed = () => { set({ state: 'idle' }); toast('Didn’t catch that. Tap and try again.', 'amber'); };
  if (my !== run) return;
  if (!blob || blob.size < 1000) return missed();
  let r;
  try {
    r = await voiceTurn(blob, {
      conversationId: chatConversationId(), context: talk.context,
      awaiting: Date.now() - awaiting.at < 10 * 60000 ? awaiting.ids : ''
    });
  } catch (e) { if (my === run) { set({ state: 'idle' }); toast(e.message, 'flare'); } return; }
  logVoiceExchange(r);
  awaiting = { ids: (r.awaiting || []).map(a => a.id).join(','), at: Date.now() };
  if (my !== run) return;
  if (!r.heard) return missed();
  if (!r.reply) { set({ state: 'idle', heard: r.heard }); return; }
  set({ state: 'speaking', heard: r.heard, reply: r.reply });
  speak(r.reply, () => { if (my === run && talk.state === 'speaking') set({ state: 'idle' }); }, { what: 'talk', lang: r.lang, audioData: r.audio || undefined });
}
