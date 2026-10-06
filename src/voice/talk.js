// Talk to the agent from anywhere: tap to speak, tap again to send, and the answer comes back in the same natural voice.
// Speech-to-text and the voice run on the server (ElevenLabs), the answer is Claude with all of the agent's tools.
// Every exchange also lands in the Agent chat. context = what Kevin just heard ('briefing' | 'world'), so
// "tell me more about the second one" makes sense to the agent.
import { notify } from '../core/store.js';
import { apiConfig } from '../core/api.js';
import { toast, tick } from '../core/fx.js';
import { speak, stopSpeaking } from './tts.js';
import { canRecord, startRecording, stopRecording, transcribe } from './stt.js';
import { sendToAgent } from '../views/assistant.js';

const MAX_MS = 60000;                 // a question longer than a minute is sent anyway
export const talk = { state: 'idle', context: null, heard: '', reply: '', at: 0 };
let timer = null, run = 0;
const set = patch => { Object.assign(talk, patch, { at: Date.now() }); notify(); };

export const canTalk = () => !!apiConfig() && canRecord();

/** Tap once to start listening, again to send; while it speaks, a tap stops it. */
export async function toggleTalk(context = null) {
  if (talk.state === 'listening') return finishListening();
  if (talk.state === 'thinking') return;
  if (talk.state === 'speaking') { stopSpeaking(); set({ state: 'idle' }); return; }
  if (!apiConfig()) { toast('Pair this device in Settings to talk to the assistant.', 'amber'); return; }
  if (!canRecord()) { toast('This device can’t record audio here.', 'amber'); return; }
  stopSpeaking();
  const my = ++run;
  try { await startRecording(); } catch { toast('Microphone permission denied.', 'flare'); return; }
  if (my !== run) { stopRecording(); return; }
  tick('open');
  set({ state: 'listening', context, heard: '', reply: '' });
  timer = setTimeout(finishListening, MAX_MS);
}

/** Drop whatever is happening: discard the recording, stop the voice, ignore a late answer. */
export async function cancelTalk() {
  run++;
  clearTimeout(timer);
  if (talk.state === 'listening') await stopRecording();
  stopSpeaking();
  set({ state: 'idle', heard: '', reply: '' });
}

async function finishListening() {
  if (talk.state !== 'listening') return;
  clearTimeout(timer);
  const my = run;
  set({ state: 'thinking' });
  const blob = await stopRecording();
  let text = '';
  try { text = blob ? await transcribe(blob) : ''; }
  catch (e) { if (my === run) { set({ state: 'idle' }); toast(e.message || 'Transcription failed', 'flare'); } return; }
  if (my !== run) return;
  if (!text) { set({ state: 'idle' }); toast('Didn’t catch that. Tap and try again.', 'amber'); return; }
  set({ heard: text });
  const reply = await sendToAgent(text, { viaVoice: true, context: talk.context, speakReply: false });
  if (my !== run) return;
  if (!reply) { set({ state: 'idle' }); return; }
  set({ state: 'speaking', reply });
  speak(reply, () => { if (my === run && talk.state === 'speaking') set({ state: 'idle' }); }, { what: 'talk' });
}
