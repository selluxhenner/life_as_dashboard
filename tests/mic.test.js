// Hands-free turns: the recorder ends a turn when Kevin pauses, hands over what he said at the first short pause,
// and takes that back when he goes on talking.
import { describe, it, expect } from 'vitest';
import { record, END_MS, PAUSE_MS, FINISHED_MS, UNSURE_MS, OPEN_MS } from '../src/voice/mic.js';

const RATE = 48000, FRAME = 2048, FRAME_MS = (FRAME / RATE) * 1000;
const tone = (amp = 0.3) => Float32Array.from({ length: FRAME }, (_, i) => amp * Math.sin(i / 8));
const quiet = () => new Float32Array(FRAME).fill(0.001);

/* Feeds ms of speech / silence to the recorder like the audio node does, and logs what it reports. */
function talkTo(mic, script) {
  for (const [kind, ms] of script) for (let t = 0; t < ms && mic.sink; t += FRAME_MS) mic.sink(kind === 'speak' ? tone() : quiet(), RATE);
}

describe('record', () => {
  it('ends 0.6 s after he stops, with what he said as 16 kHz WAV', async () => {
    const mic = {}, events = [];
    const p = record(mic, { onPause: w => events.push(['pause', w.size]), onResume: () => events.push(['resume']) });
    talkTo(mic, [['quiet', 300], ['speak', 1200], ['quiet', 1000]]);
    const wav = await p;
    expect(wav.type).toBe('audio/wav');
    // 16-bit at 16 kHz: about 32 bytes per ms, from the start until END_MS after the speech
    const ms = (wav.size - 44) / 32;
    expect(ms).toBeGreaterThan(300 + 1200 + END_MS - 50);
    expect(ms).toBeLessThan(300 + 1200 + END_MS + 150);              // whole 43 ms frames
    expect(events.map(e => e[0])).toEqual(['pause']);
    expect(mic.sink).toBe(null);                                // the turn is over: frames are ignored again
  });

  it('a short pause hands over what was said so far, and talking on takes it back', async () => {
    const mic = {}, events = [];
    const p = record(mic, { onPause: () => events.push('pause'), onResume: () => events.push('resume') });
    talkTo(mic, [['speak', 600], ['quiet', PAUSE_MS + 150], ['speak', 600], ['quiet', 1000]]);
    await p;
    expect(events).toEqual(['pause', 'resume', 'pause']);
  });

  it('a sentence that isn\'t finished ("add a task.") gets more time; an unknown one a little', async () => {
    const quietAfter = async (finished, script) => {
      const mic = {};
      const p = record(mic, { finished });
      talkTo(mic, script);
      const wav = await p;
      return (wav.size - 44) / 32 - 1000;                        // ms of quiet at the end
    };
    expect(await quietAfter(() => true, [['speak', 1000], ['quiet', 4000]])).toBeLessThan(FINISHED_MS + 100);   // whole 43 ms frames
    expect(await quietAfter(undefined, [['speak', 1000], ['quiet', 4000]])).toBeGreaterThan(END_MS - 50);   // no verdict: the plain rule
    expect(await quietAfter(() => null, [['speak', 1000], ['quiet', 4000]])).toBeGreaterThan(UNSURE_MS - 50);
    expect(await quietAfter(() => false, [['speak', 1000], ['quiet', 4000]])).toBeGreaterThan(OPEN_MS - 50);
    // not finished, and he goes on: one turn with all of it
    const mic = {};
    const p = record(mic, { finished: () => false });
    talkTo(mic, [['speak', 1000], ['quiet', 1500], ['speak', 1000], ['quiet', 3000]]);
    expect(Math.round(((await p).size - 44) / 32)).toBeGreaterThan(3500);
  });

  it('nothing said: null after waitMs; Send ends it at once', async () => {
    const a = {};
    const silent = record(a, { waitMs: 1000 });
    talkTo(a, [['quiet', 1500]]);
    expect(await silent).toBe(null);

    const b = {};
    const sent = record(b);
    talkTo(b, [['speak', 500]]);
    b.stop();
    expect((await sent).size).toBeGreaterThan(44);
  });
});
