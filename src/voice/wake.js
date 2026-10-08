// "Hey Lina" on the Windows app. lina-wake.exe (started by the shell, src-tauri/src/lina.rs) hears the wake word and
// records what Kevin says until he pauses; this module sends that as one spoken turn to the server (/api/voice/turn,
// the same as the phone), plays Lina's answer, shows both in the voice bar and listens again when she asked back
// ("Shall I send Max the invite?" → "Yes"). The on/off switch and sensitivity are kept on this device.
import { state, save, notify } from '../core/store.js';
import { platform } from '../core/platform.js';
import { apiConfig } from '../core/api.js';
import { toast, tick } from '../core/fx.js';
import { runSync } from '../core/sync.js';
import { speak, stopSpeaking } from './tts.js';
import { talk, setTalk, onTalkCancel } from './talk.js';
import { voiceTurn, warmLina } from './turn.js';

export const desktopWake = { available: platform.isTauri, status: 'off', error: '' };
let send = () => {};
let conversation = { id: null, at: 0 }, awaiting = '';

export const wakeSettings = () => ({ wake: false, sensitivity: 'normal', ...(state.settings.lina || {}) });

/** Switch listening on or off (and save it), or restart it with a new sensitivity. */
export async function setDesktopWake(patch) {
  state.settings.lina = { ...wakeSettings(), ...patch };
  save();
  await apply();
}

async function apply() {
  if (!platform.isTauri) return;
  const s = wakeSettings();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const on = await invoke('lina_wake', { on: !!s.wake, sensitivity: s.sensitivity });
    Object.assign(desktopWake, { status: on ? 'starting' : 'off', error: '' });
  } catch (e) {
    Object.assign(desktopWake, { status: 'error', error: String(e) });
    if (s.wake) toast('“Hey Lina” couldn’t start: ' + e, 'flare');
  }
  notify();
}

const back = () => { setTalk({ state: 'idle', source: null }); send('resume'); };

async function turn(b64, viaWake) {
  const cfg = apiConfig();
  if (!cfg) { toast('Pair this device in Settings to talk to Lina.', 'amber'); return back(); }
  setTalk({ state: 'thinking', source: 'wake' });
  let r;
  try {
    r = await voiceTurn(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), {
      type: 'audio/wav', wake: viaWake, awaiting,
      conversationId: conversation.id && Date.now() - conversation.at < 10 * 60000 ? conversation.id : null
    });
  } catch (e) { toast(e.message, 'flare'); return back(); }
  if (r.tools && r.tools.length) runSync();                            // what she changed shows up right away
  if (talk.source !== 'wake') return send('resume');                  // closed while she was thinking
  if (r.falseWake || !r.reply) return back();                          // not "Lina" after all
  conversation = { id: r.conversationId, at: Date.now() };
  awaiting = (r.awaiting || []).map(a => a.id).join(',');
  setTalk({ state: 'speaking', heard: r.heard, reply: r.reply });
  await new Promise(done => speak(r.reply, done, { lang: r.lang, what: 'talk', audioData: r.audio || undefined }));
  if (talk.source !== 'wake' || talk.state !== 'speaking') return send('resume');
  if (r.listen) { tick('open'); setTalk({ state: 'listening', heard: '' }); send('listen'); }
  else { setTalk({ state: 'idle', source: null }); send('resume'); }
}

export async function initDesktopWake() {
  if (!platform.isTauri) return;
  const [{ listen }, { invoke }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core')]);
  send = cmd => invoke('lina_send', { cmd }).catch(() => {});
  onTalkCancel(() => { stopSpeaking(); awaiting = ''; send('resume'); });
  listen('lina://wake', () => {
    stopSpeaking();
    warmLina();
    tick('open');
    awaiting = '';
    setTalk({ state: 'listening', source: 'wake', context: null, heard: '', reply: '' });
  });
  listen('lina://speech', e => turn(e.payload, talk.state === 'listening' && !talk.reply));
  listen('lina://nospeech', () => back());
  listen('lina://status', e => {
    const line = String(e.payload || '');
    if (line === 'READY') Object.assign(desktopWake, { status: 'listening', error: '' });
    else if (line === 'STOPPED') { if (desktopWake.status !== 'off') desktopWake.status = 'stopped'; }
    else if (line.startsWith('ERROR')) Object.assign(desktopWake, { status: 'error', error: line.slice(6) });
    notify();
  });
  if (wakeSettings().wake) apply();
}
