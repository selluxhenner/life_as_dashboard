// Voice: speech-to-text for push-to-talk, text-to-speech for read-aloud and spoken replies.
import { Hono } from 'hono';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError, body } from '../http.js';
import { getSetting } from '../settings.js';

const logVoice = (feature, usd) => db.run('INSERT INTO ai_usage (at, feature, model, cost_usd) VALUES (?, ?, ?, ?)', Date.now(), feature, 'voice', usd);

export const voice = new Hono();

voice.post('/voice/stt', async c => {
  if (!config.openaiKey) throw new HttpError(503, 'Speech-to-text needs OPENAI_API_KEY on the server');
  const type = c.req.header('Content-Type') || 'audio/webm';
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!buf.length) throw new HttpError(400, 'Empty recording');
  if (buf.length > 12 * 1024 * 1024) throw new HttpError(413, 'Recording too long');
  const form = new FormData();
  const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
  form.append('file', new Blob([buf], { type }), 'speech.' + ext);
  form.append('model', 'gpt-4o-mini-transcribe');
  // No fixed language: Kevin speaks German or English, sometimes both in one sentence. The prompt keeps names right.
  form.append('prompt', 'Kevin speaks German or English and sometimes mixes both. Write it down in the language spoken. Names: Agentic OS, ServiWeb, Werkstudent, Berlin, Fuxam.');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + config.openaiKey }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, 'Transcription failed: ' + (data.error?.message || res.status));
  logVoice('stt', (buf.length / 16000 / 60) * 0.003);                 // ~16 kB/s opus, $0.003 per minute
  return c.json({ text: (data.text || '').trim() });
});

/* Soft read-aloud in the language of the text: English stays English, German stays German, no accent bleed. */
const VOICES = ['marin', 'cedar', 'shimmer', 'sage', 'coral', 'ballad', 'alloy', 'ash', 'echo', 'fable', 'nova', 'onyx', 'verse'];
const LANG = {
  en: 'Speak natural, native English with neutral British pronunciation.',
  de: 'Sprich natürliches Hochdeutsch mit muttersprachlicher Aussprache, ohne englischen Akzent.'
};
const SOFT = 'Voice: soft, warm and close, like a calm friend sitting next to you. Pace: unhurried, with small natural pauses between sentences. Tone: gentle and reassuring, a quiet smile in the voice, never announcer-like. Read numbers and times naturally; never read symbols or punctuation aloud.';

voice.post('/voice/tts', async c => {
  const b = await body(c);
  const text = String(b.text || '').slice(0, 4000);
  if (!text.trim()) throw new HttpError(400, 'No text');
  const lang = b.lang === 'de' ? 'de' : 'en';
  const pref = getSetting('voice');
  if (config.elevenKey && config.elevenVoice && pref.provider === 'elevenlabs') {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.elevenVoice}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': config.elevenKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', language_code: lang,
        voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true } })
    });
    if (!res.ok) throw new HttpError(502, 'ElevenLabs TTS failed (' + res.status + ')');
    logVoice('tts', text.length * 0.00015);
    return new Response(res.body, { headers: { 'Content-Type': 'audio/mpeg' } });
  }
  if (!config.openaiKey) throw new HttpError(503, 'Premium voice needs OPENAI_API_KEY on the server');
  const voiceId = VOICES.includes(b.voice) ? b.voice : VOICES.includes(pref.voice) ? pref.voice : 'marin';
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: 'Bearer ' + config.openaiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voiceId, input: text, response_format: 'mp3',
      instructions: SOFT + ' ' + LANG[lang] })
  });
  if (!res.ok) throw new HttpError(502, 'TTS failed (' + res.status + ')');
  logVoice('tts', (text.length / 900) * 0.015);                          // ~900 chars per spoken minute
  return new Response(res.body, { headers: { 'Content-Type': 'audio/mpeg' } });
});
