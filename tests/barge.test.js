// Barge-in: while Lina speaks, Kevin talking over her stops her, and his first words start the next turn.
import { describe, it, expect } from 'vitest';
import { record, watchBarge, BARGE_MS, BARGE_GRACE_MS, PREROLL_MS } from '../src/voice/mic.js';

const RATE = 48000, FRAME = 2048, FRAME_MS = (FRAME / RATE) * 1000;
const tone = amp => Float32Array.from({ length: FRAME }, (_, i) => amp * Math.sin(i / 8));
const feed = (mic, amp, ms) => { for (let t = 0; t < ms && mic.sink; t += FRAME_MS) mic.sink(tone(amp), RATE); };

describe('watchBarge', () => {
  it('ignores her own quiet echo, fires when he talks for a moment', () => {
    const mic = {}; let got = null;
    watchBarge(mic, pre => { got = pre; });
    feed(mic, 0.01, BARGE_GRACE_MS + 1500);                    // echo left over after cancellation
    expect(got).toBe(null);
    feed(mic, 0.3, BARGE_MS + 200);                            // him
    expect(got).not.toBe(null);
    expect(mic.sink).toBe(null);
    const ms = got.chunks.reduce((n, c) => n + c.length, 0) / 16;
    expect(ms).toBeLessThanOrEqual(PREROLL_MS + FRAME_MS);       // only the last moment is kept
    expect(ms).toBeGreaterThan(BARGE_MS);
  });

  it('a short cough does not stop her', () => {
    const mic = {}; let fired = false;
    watchBarge(mic, () => { fired = true; });
    feed(mic, 0.01, BARGE_GRACE_MS + 200);
    feed(mic, 0.3, 90);
    feed(mic, 0.01, 800);
    expect(fired).toBe(false);
  });

  it('stop() releases the microphone without firing', () => {
    const mic = {}; let fired = false;
    const stop = watchBarge(mic, () => { fired = true; });
    stop();
    expect(mic.sink).toBe(null);
    feed(mic, 0.3, 1000);
    expect(fired).toBe(false);
  });

  it('the next turn starts with what he said over her', async () => {
    const mic = {}; let pre = null;
    watchBarge(mic, p => { pre = p; });
    feed(mic, 0.01, BARGE_GRACE_MS);
    feed(mic, 0.3, BARGE_MS + 100);
    const p = record(mic, { preroll: pre });
    feed(mic, 0.3, 400);
    feed(mic, 0.001, 1000);
    const wav = await p;
    const ms = (wav.size - 44) / 32;
    const preMs = pre.chunks.reduce((n, c) => n + c.length, 0) / 16;
    expect(ms).toBeGreaterThan(preMs + 400);
  });
});
