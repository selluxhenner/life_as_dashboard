// Hands-free listening in the app, the way the phone does it (LinaService): the microphone stays open for the whole
// conversation and each turn records until Kevin pauses. A simple energy detector with a moving noise floor ends a
// turn 0.6 s after the last speech, or later when what he said so far is not a finished request (finished()). At the
// first short pause (0.25 s) onPause gets what he said so far, so the server can start on it before the turn is over;
// onResume says he went on talking after all. Audio is 16 kHz mono WAV.

const RATE = 16000;
export const END_MS = 600, PAUSE_MS = 250;
// finished() says whether what he said so far is a whole request (the server read it at the pause): true ends the turn
// at FINISHED_MS, false ("Hey Lina, add a task.") waits for the rest up to OPEN_MS, null (not read yet) up to UNSURE_MS.
export const FINISHED_MS = 450, UNSURE_MS = 1200, OPEN_MS = 2500;

/** Opens the microphone. close() releases it (the browser's mic indicator goes off). */
export async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);              // runs everywhere, also in the Android WebView
  const mic = {
    sink: null, stop: null,
    close() {
      mic.sink = null;
      try { src.disconnect(); node.disconnect(); } catch { /* already */ }
      stream.getTracks().forEach(t => t.stop());
      ctx.close().catch(() => {});
    }
  };
  node.onaudioprocess = e => { if (mic.sink) mic.sink(e.inputBuffer.getChannelData(0), ctx.sampleRate); };
  src.connect(node);
  node.connect(ctx.destination);                                    // a script node only runs when connected (it outputs silence)
  return mic;
}

/* Float samples at the device rate → 16 kHz 16-bit, by averaging. */
function downsample(f32, rate) {
  const ratio = rate / RATE, n = Math.floor(f32.length / ratio), out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += f32[k];
    out[i] = Math.max(-32768, Math.min(32767, Math.round((s / (b - a)) * 32767)));
  }
  return out;
}

function wav(parts, n) {
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const p of parts) { new Int16Array(buf, o, p.length).set(p); o += p.length * 2; }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * One turn: resolves to the WAV of what he said, or null when he said nothing within waitMs. mic.stop() ends it now
 * (the Send button). At most 25 s, like the phone.
 */
export function record(mic, { waitMs = 8000, maxMs = 25000, onPause, onResume, onSpeech, onAudio, finished } = {}) {
  return new Promise(resolve => {
    const parts = [];
    let n = 0, floor = 250, speech = false, quiet = 0, ms = 0, paused = false, over = false;
    const done = () => {
      if (over) return;
      over = true; mic.sink = null; mic.stop = null;
      resolve(speech ? wav(parts, n) : null);
    };
    mic.stop = done;
    mic.sink = (f32, rate) => {
      const s = downsample(f32, rate);
      parts.push(s); n += s.length;
      onAudio?.(s);                                                  // live transcription
      const dur = (s.length * 1000) / RATE;
      ms += dur;
      let sum = 0;
      for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
      const rms = Math.sqrt(sum / (s.length || 1));
      if (rms > Math.max(600, floor * 2.5)) {
        if (!speech) onSpeech?.();
        speech = true; quiet = 0;
        if (paused) { paused = false; onResume?.(); }
      } else {
        quiet += dur;
        floor = floor * 0.95 + rms * 0.05;
      }
      if (speech && !paused && quiet >= PAUSE_MS && quiet < END_MS) { paused = true; onPause?.(wav(parts, n)); }
      if (speech && quiet >= FINISHED_MS) {
        const f = finished ? finished() : undefined;              // no finished(): the plain rule, END_MS of quiet
        const need = f === undefined ? END_MS : f === true ? FINISHED_MS : f === false ? OPEN_MS : UNSURE_MS;
        if (quiet >= need) return done();
      }
      if ((!speech && ms >= waitMs) || ms >= maxMs) done();
    };
  });
}
