// One spoken exchange with Lina in one request: the recording goes up, the transcript, her answer and its audio come
// back (/api/voice/turn). Used by push-to-talk and the desktop's "Hey Lina".
import { apiConfig } from '../core/api.js';

const base = cfg => cfg.url.replace(/\/+$/, '');

/** Tell the server Kevin started talking, so Lina's model is ready by the time he stops. Fire and forget. */
export function warmLina() {
  const cfg = apiConfig();
  if (!cfg) return;
  fetch(base(cfg) + '/api/voice/warm', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token } }).catch(() => {});
}

/**
 * voiceTurn(audio: Blob | Uint8Array, {type, conversationId, awaiting, wake, context})
 * -> {heard, reply, lang, conversationId, awaiting:[{id, summary}], tools, listen, audio (base64 mp3 | null), falseWake?}
 */
export async function voiceTurn(audio, { type = audio.type || 'audio/webm', conversationId = null, awaiting = '', wake = false, context = null, prepared = null } = {}) {
  const cfg = apiConfig();
  if (!cfg) throw new Error('Pair this device in Settings to talk to Lina.');
  const q = new URLSearchParams({ wake: wake ? '1' : '0' });
  if (conversationId) q.set('conversationId', conversationId);
  if (awaiting) q.set('awaiting', awaiting);
  if (context) q.set('context', context);
  // prepared: what he said was sent when he paused (prepareTurn), so only the id goes up; unknown to the server → the audio
  const send = id => fetch(base(cfg) + '/api/voice/turn?' + q + (id ? '&prepared=' + encodeURIComponent(id) : ''), {
    method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': type }, body: id ? null : audio
  });
  let res;
  try {
    res = await send(prepared);
    if (prepared && res.status === 409) res = await send(null);
  } catch { throw new Error('Lina couldn’t reach your server.'); }
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error || 'Lina couldn’t answer (' + res.status + ')');
  return r;
}

/**
 * Kevin paused: send what he said so far, so the server transcribes it and thinks the answer through while the app
 * waits to be sure he is done. Nothing is changed until voiceTurn(…, {prepared: id}). Resolves to the id, or null.
 */
export async function prepareTurn(audio, type = audio.type || 'audio/wav') {
  const cfg = apiConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(base(cfg) + '/api/voice/prepare', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': type }, body: audio });
    return res.ok ? (await res.json()).id || null : null;
  } catch { return null; }
}

/** Was the sentence up to that pause a finished request? false keeps the app listening; when unsure, true. */
export async function preparedFinished(id) {
  const cfg = apiConfig();
  try {
    const res = await fetch(base(cfg) + '/api/voice/prepare/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + cfg.token } });
    return res.ok ? (await res.json()).finished !== false : true;
  } catch { return true; }
}
