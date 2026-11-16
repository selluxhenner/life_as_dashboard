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
// After this much talking he may be explaining something and just thinking between sentences: wait longer.
export const LONG_SPEECH_MS = 5000, LONG_MS = 1800;

/* How loud the microphone is right now, 0..1, smoothed: the Lina orb breathes with it. Read, never rendered from. */
export const level = { mic: 0 };
const rmsOf = s => { let sum = 0; for (let i = 0; i < s.length; i++) sum += s[i] * s[i]; return Math.sqrt(sum / (s.length || 1)); };
const toLevel = rms => Math.min(1, Math.max(0, (Math.log10(Math.max(rms, 1)) - 2.3) / 1.9));

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
 * (the Send button). At most 3 minutes, like the phone.
 */
export function record(mic, { waitMs = 8000, maxMs = 180000, onPause, onResume, onSpeech, onAudio, finished, preroll = null } = {}) {
  return new Promise(resolve => {
    const parts = [];
    let n = 0, floor = 250, speech = false, quiet = 0, ms = 0, talk = 0, paused = false, over = false;
    // preroll: what he said while Lina was still talking (barge-in), so his first words are not lost
    if (preroll && preroll.chunks.length) {
      for (const c of preroll.chunks) { parts.push(c); n += c.length; onAudio?.(c); }
      speech = true; floor = preroll.floor || floor;
    }
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
      level.mic = level.mic * 0.6 + toLevel(rms) * 0.4;
      if (speech) talk += dur;
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
        const need = talk >= LONG_SPEECH_MS ? (f === false ? OPEN_MS : LONG_MS) : f === undefined ? END_MS : f === true ? FINISHED_MS : f === false ? OPEN_MS : UNSURE_MS;
        if (quiet >= need) return done();
      }
      if ((!speech && ms >= waitMs) || ms >= maxMs) done();
    };
  });
}

/* Barge-in: while Lina speaks the microphone stays open and listens for Kevin. Her own voice is mostly removed by the
   browser's echo cancellation; what is left is quieter than him, so the bar is higher than for a normal turn and his
   voice has to last BARGE_MS. Keeps the last PREROLL_MS of audio, which the next turn starts with.
   watchBarge(mic, onBarge) -> stop(); onBarge({chunks, floor}) fires once. */
export const BARGE_MS = 280, PREROLL_MS = 900, BARGE_GRACE_MS = 450;
export function watchBarge(mic, onBarge) {
  const ring = [];
  let ringLen = 0, floor = 300, loud = 0, ms = 0, fired = false;
  mic.sink = (f32, rate) => {
    if (fired) return;
    const s = downsample(f32, rate);
    ring.push(s); ringLen += s.length;
    while (ringLen - ring[0].length > (PREROLL_MS * RATE) / 1000) ringLen -= ring.shift().length;
    const dur = (s.length * 1000) / RATE;
    ms += dur;
    const rms = rmsOf(s);
    level.mic = level.mic * 0.6 + toLevel(rms) * 0.4;
    if (ms < BARGE_GRACE_MS) { floor = floor * 0.8 + rms * 0.2; return; }     // her first syllable: learn the echo level
    if (rms > Math.max(1400, floor * 3.2)) loud += dur;
    else { loud = Math.max(0, loud - dur * 1.5); floor = floor * 0.95 + rms * 0.05; }
    if (loud >= BARGE_MS) { fired = true; mic.sink = null; onBarge({ chunks: ring.slice(), floor }); }
  };
  return () => { if (!fired) mic.sink = null; fired = true; };
}
