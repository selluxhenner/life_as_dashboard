// Live transcription: the app streams the microphone to Scribe Realtime with a single-use token from the server,
// and a commit at a pause hands back everything said so far.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/api.js', () => ({ apiConfig: () => ({ url: 'https://srv.test', token: 'dev-token' }) }));

let sockets = [];
class FakeSocket {
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; this.listeners = {}; sockets.push(this); setTimeout(() => this.open(), 5); }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  emit(t, e) { if (t === 'message') this.onmessage?.(e); if (t === 'close') this.onclose?.(e); (this.listeners[t] || []).forEach(f => f(e)); }
  open() { this.readyState = 1; this.emit('message', { data: JSON.stringify({ message_type: 'session_started', session_id: 's1' }) }); }
  send(m) { this.sent.push(JSON.parse(m)); }
  say(type, text) { this.emit('message', { data: JSON.stringify({ message_type: type, text }) }); }
  close() { this.readyState = 3; this.emit('close', {}); }
}

beforeEach(() => {
  sockets = [];
  globalThis.WebSocket = FakeSocket;
  globalThis.fetch = vi.fn(async url => {
    expect(url).toBe('https://srv.test/api/voice/live-token');
    return new Response(JSON.stringify({ token: 'sutkn_1', url: 'wss://eleven.test/v1/speech-to-text/realtime' }));
  });
});

describe('openLive', () => {
  it('connects with the single-use token, streams PCM and commits at a pause', async () => {
    const { openLive } = await import('../src/voice/live.js');
    const partials = [];
    const live = await openLive({ onPartial: t => partials.push(t) });
    const ws = sockets[0];
    const q = new URL(ws.url).searchParams;
    expect(Object.fromEntries(q)).toEqual({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', commit_strategy: 'manual', token: 'sutkn_1' });

    live.send(new Int16Array([1, 2, 3]));
    expect(ws.sent[0]).toMatchObject({ message_type: 'input_audio_chunk', commit: false, sample_rate: 16000 });
    expect(atob(ws.sent[0].audio_base_64).length).toBe(6);              // 3 samples, 16-bit

    ws.say('partial_transcript', 'Hey Lina, add a');
    expect(partials).toEqual(['Hey Lina, add a']);
    const first = live.commit();
    expect(ws.sent.at(-1)).toMatchObject({ commit: true });
    ws.say('committed_transcript', 'Hey Lina, add a task.');
    expect(await first).toBe('Hey Lina, add a task.');

    // he goes on: the next commit has all of it
    ws.say('partial_transcript', 'Buy some groceries');
    const second = live.commit();
    ws.say('committed_transcript', 'Buy some groceries.');
    expect(await second).toBe('Hey Lina, add a task. Buy some groceries.');

    live.reset();                                                          // the next turn starts empty
    expect(live.text()).toBe('');
  });

  it('a commit nobody answers falls back to the partial; an error closes it; no token means null', async () => {
    const { openLive } = await import('../src/voice/live.js');
    const live = await openLive();
    sockets[0].say('partial_transcript', 'what is on tomorrow');
    expect(await live.commit()).toBe('what is on tomorrow');               // after COMMIT_WAIT

    sockets[0].emit('message', { data: JSON.stringify({ message_type: 'quota_exceeded', error: 'no credits' }) });
    expect(live.ok).toBe(false);

    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 }));
    expect(await openLive()).toBe(null);                                  // server without ElevenLabs: recordings as before
  });
});
