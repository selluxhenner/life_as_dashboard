// Voice: speech-to-text for push-to-talk, text-to-speech for read-aloud and spoken replies, and the voice picker.
import { Hono } from 'hono';
import { config } from '../config.js';
import { HttpError, body } from '../http.js';
import { getSetting } from '../settings.js';
import { synthesize, transcribe, ttsEngine, sttEngine, elevenChoice } from '../voice/speech.js';
import { elevenVoices, elevenAccount, ELEVEN_MODELS } from '../voice/eleven.js';
import { briefingScript } from '../jobs/briefing.js';
import { worldScript } from '../jobs/news.js';

export const voice = new Hono();

// c.body (not a bare Response) keeps the CORS headers set by the middleware; without them the apps can't play it.
// The server keeps its own audio cache; browsers must not, or a regenerated briefing would replay the old one.
const mp3 = (c, { audio, engine, cached }) => c.body(audio, 200, {
  'Content-Type': 'audio/mpeg', 'X-Voice-Engine': engine, 'X-Voice-Cached': cached ? '1' : '0', 'Cache-Control': 'no-store'
});

voice.post('/voice/stt', async c => {
  const type = c.req.header('Content-Type') || 'audio/webm';
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!buf.length) throw new HttpError(400, 'Empty recording');
  if (buf.length > 12 * 1024 * 1024) throw new HttpError(413, 'Recording too long');
  return c.json({ text: await transcribe(buf, type) });
});

voice.post('/voice/tts', async c => {
  const b = await body(c);
  const text = String(b.text || '').slice(0, 4000);
  if (!text.trim()) throw new HttpError(400, 'No text');
  const out = await synthesize({
    text, lang: b.lang === 'de' ? 'de' : 'en', openaiVoice: b.voice,
    elevenVoice: typeof b.elevenVoice === 'string' ? b.elevenVoice : undefined
  });
  return mp3(c, out);
});

/* The 30-second spoken briefing and world summary, rendered from the server's own script (with delivery directions)
   so the audio cache hits on every device. */
voice.get('/voice/briefing', async c => {
  const text = briefingScript();
  if (!text) throw new HttpError(404, 'No spoken briefing for today yet');
  return mp3(c, await synthesize({ text, lang: 'en' }));
});
voice.get('/voice/world', async c => {
  const text = worldScript();
  if (!text) throw new HttpError(404, 'No world digest yet');
  return mp3(c, await synthesize({ text, lang: 'en' }));
});

/* What the server can do, for Settings › Voice. */
voice.get('/voice/info', async c => {
  const pref = getSetting('voice');
  const tts = ttsEngine(pref);
  return c.json({
    tts, stt: sttEngine(),
    keys: { elevenlabs: !!config.elevenKey, openai: !!config.openaiKey },
    eleven: config.elevenKey ? { ...elevenChoice(pref), models: ELEVEN_MODELS, account: await elevenAccount() } : null
  });
});

voice.get('/voice/voices', async c => {
  if (!config.elevenKey) throw new HttpError(503, 'Set ELEVENLABS_API_KEY on the server to choose an ElevenLabs voice');
  try { return c.json({ voices: await elevenVoices() }); }
  catch (e) { throw new HttpError(502, e.message); }
});
