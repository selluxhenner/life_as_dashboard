// Push-to-talk recording -> server transcription (/api/voice/stt).
// Android WebView has no SpeechRecognition, so the server does speech-to-text everywhere.
import { apiConfig } from '../core/api.js';

let rec = null, chunks = [], stream = null;

export const canRecord = () => !!(navigator.mediaDevices && window.MediaRecorder);

export async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.start();
}

export function stopRecording() {
  return new Promise(resolve => {
    if (!rec) return resolve(null);
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      rec = null; resolve(blob);
    };
    rec.stop();
  });
}

export async function transcribe(blob) {
  const cfg = apiConfig();
  if (!cfg) throw new Error('Pair this device to use voice.');
  const res = await fetch(cfg.url.replace(/\/+$/, '') + '/api/voice/stt', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': blob.type || 'audio/webm' },
    body: blob
  });
  if (!res.ok) throw new Error('Transcription failed (' + res.status + ')');
  return (await res.json()).text || '';
}
