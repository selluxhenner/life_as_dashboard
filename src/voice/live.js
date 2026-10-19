// Live transcription while Kevin talks: the microphone audio (16 kHz PCM from voice/mic.js) streams straight to
// ElevenLabs Scribe v2 Realtime, so his words are written down by the time he stops instead of after. The server hands
// out a single-use token (/api/voice/live-token); the API key never reaches the app. Kevin's own pause detection
// decides when a piece is done: commit() asks Scribe to finalise what it heard since the last commit.
// Anything that goes wrong (no ElevenLabs key, no connection, an error from Scribe) closes it, and the conversation
// falls back to sending recordings as before.
import { apiConfig } from '../core/api.js';

const RATE = 16000;
const COMMIT_WAIT = 800;              // a commit not answered in time: use the partial text instead

function b64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * openLive({onPartial}) -> live | null. live.send(int16) streams audio; live.commit() resolves to everything said
 * since reset() (committed pieces plus the newest); live.text() is the same without waiting; live.ok says it still
 * works; live.close(). onPartial(text) fires as the words come in.
 */
export async function openLive({ onPartial } = {}) {
  const cfg = apiConfig();
  if (!cfg || typeof WebSocket === 'undefined') return null;
  let token, url;
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/api/voice/live-token', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token } });
    if (!res.ok) return null;
    ({ token, url } = await res.json());
  } catch { return null; }

  const q = new URLSearchParams({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_' + RATE, commit_strategy: 'manual', token });
  const ws = new WebSocket(url + '?' + q);
  const live = { ok: true, committed: [], partial: '' };
  const queue = [];
  let started = false, waiting = [];

  const all = () => [...live.committed, live.partial].map(s => s.trim()).filter(Boolean).join(' ');
  const settle = () => { const w = waiting; waiting = []; w.forEach(fn => fn(all())); };
  const fail = () => { live.ok = false; settle(); try { ws.close(); } catch { /* closed */ } };
  const raw = msg => { if (started && ws.readyState === 1) ws.send(JSON.stringify(msg)); else queue.push(msg); };

  ws.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.message_type === 'session_started') {
      started = true;
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
    } else if (m.message_type === 'partial_transcript') {
      live.partial = m.text || '';
      onPartial?.(all());
    } else if (m.message_type === 'committed_transcript') {
      if ((m.text || '').trim()) live.committed.push(m.text.trim());
      live.partial = '';
      settle();
    } else if (/error|exceeded|limited|invalid/.test(m.message_type || '')) {
      console.warn('live transcription:', m.message_type, m.error || '');
      fail();
    }
  };
  ws.onerror = fail;
  ws.onclose = () => { live.ok = false; settle(); };

  live.send = int16 => { if (live.ok) raw({ message_type: 'input_audio_chunk', audio_base_64: b64(int16), commit: false, sample_rate: RATE }); };
  live.commit = () => new Promise(resolve => {
    if (!live.ok) return resolve(all());
    waiting.push(resolve);
    raw({ message_type: 'input_audio_chunk', audio_base_64: b64(new Int16Array(RATE / 50)), commit: true, sample_rate: RATE });   // 20 ms of silence
    setTimeout(() => { const i = waiting.indexOf(resolve); if (i >= 0) { waiting.splice(i, 1); resolve(all()); } }, COMMIT_WAIT);
  });
  live.text = all;
  live.reset = () => { live.committed = []; live.partial = ''; };
  live.close = () => { live.ok = false; try { ws.close(); } catch { /* closed */ } };

  // connected and started, or give up quickly: a turn should never wait for this
  await new Promise(r => {
    const t = setTimeout(r, 2500);
    const done = () => { clearTimeout(t); r(); };
    ws.addEventListener('message', function first(e) { if (/session_started/.test(e.data)) { ws.removeEventListener('message', first); done(); } });
    ws.addEventListener('close', done);
  });
  if (!started) { fail(); return null; }
  return live;
}
