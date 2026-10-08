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
export async function voiceTurn(audio, { type = audio.type || 'audio/webm', conversationId = null, awaiting = '', wake = false, context = null } = {}) {
  const cfg = apiConfig();
  if (!cfg) throw new Error('Pair this device in Settings to talk to Lina.');
  const q = new URLSearchParams({ wake: wake ? '1' : '0' });
  if (conversationId) q.set('conversationId', conversationId);
  if (awaiting) q.set('awaiting', awaiting);
  if (context) q.set('context', context);
  let res;
  try {
    res = await fetch(base(cfg) + '/api/voice/turn?' + q, {
      method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': type }, body: audio
    });
  } catch { throw new Error('Lina couldn’t reach your server.'); }
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error || 'Lina couldn’t answer (' + res.status + ')');
  return r;
}
