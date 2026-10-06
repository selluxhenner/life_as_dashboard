// One place that turns text into speech for every feature (briefing, World, assistant replies, AI tracker).
// ElevenLabs when its key is set (the natural voice), OpenAI gpt-4o-mini-tts otherwise; if ElevenLabs fails and
// OpenAI is configured, OpenAI takes over. Audio is cached on disk, so a briefing heard on two devices is paid once.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { getSetting } from '../settings.js';
import { HttpError } from '../http.js';
import { elevenSpeech, elevenTranscribe, ELEVEN_MODELS, ELEVEN_MODEL_IDS, DEFAULT_ELEVEN_VOICE } from './eleven.js';
import { stripTags } from './script.js';

export const OPENAI_VOICES = ['marin', 'cedar', 'shimmer', 'sage', 'coral', 'ballad', 'alloy', 'ash', 'echo', 'fable', 'nova', 'onyx', 'verse'];
const LANG = {
  en: 'Speak natural, native English with neutral British pronunciation.',
  de: 'Sprich natürliches Hochdeutsch mit muttersprachlicher Aussprache, ohne englischen Akzent.'
};
const LIVELY = 'Voice: bright, warm and awake, like a sharp friend catching you up over coffee. Pace: quick and brisk, short pauses, never dragging. Tone: lively and varied: upbeat for good news, steadier for serious news, a little urgent for deadlines; real rises and falls, never monotone or announcer-like. Read numbers and times naturally; never read symbols or punctuation aloud.';

const CACHE_DIR = resolve(config.dataDir, 'tts');
const CACHE_DAYS = 14;

export const logVoice = (feature, usd) => db.run('INSERT INTO ai_usage (at, feature, model, cost_usd) VALUES (?, ?, ?, ?)', Date.now(), feature, 'voice', usd);

/** Which engine speaks: the setting when its key exists, otherwise whatever is configured (ElevenLabs first). */
export function ttsEngine(pref = getSetting('voice')) {
  if (pref.engine === 'openai' && config.openaiKey) return 'openai';
  if (pref.engine === 'elevenlabs' && config.elevenKey) return 'elevenlabs';
  return config.elevenKey ? 'elevenlabs' : config.openaiKey ? 'openai' : null;
}
export const sttEngine = () => (config.openaiKey ? 'openai' : config.elevenKey ? 'elevenlabs' : null);

export function elevenChoice(pref = getSetting('voice')) {
  return {
    voiceId: /^[A-Za-z0-9]{8,40}$/.test(pref.elevenVoice || '') ? pref.elevenVoice : (config.elevenVoice || DEFAULT_ELEVEN_VOICE),
    model: ELEVEN_MODEL_IDS.includes(pref.elevenModel) ? pref.elevenModel : 'eleven_v4'
  };
}

async function openaiSpeech(text, lang, voice) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: 'Bearer ' + config.openaiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: stripTags(text), response_format: 'mp3', instructions: LIVELY + ' ' + LANG[lang] }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new HttpError(502, 'OpenAI TTS failed (' + res.status + ')');
  logVoice('tts', (text.length / 900) * 0.015);                     // ~900 characters per spoken minute
  return Buffer.from(await res.arrayBuffer());
}

function prune() {
  const cutoff = Date.now() - CACHE_DAYS * 86400000;
  for (const f of readdirSync(CACHE_DIR)) {
    try { const p = resolve(CACHE_DIR, f); if (statSync(p).mtimeMs < cutoff) unlinkSync(p); } catch { /* raced */ }
  }
}

/**
 * synthesize({text, lang, openaiVoice?, elevenVoice?}) -> {audio: Buffer, engine, cached}
 * elevenVoice lets Settings preview a voice before saving it.
 */
export async function synthesize({ text, lang = 'en', openaiVoice, elevenVoice }) {
  const pref = getSetting('voice');
  const engine = ttsEngine(pref);
  if (!engine) throw new HttpError(503, 'No voice on the server yet: set ELEVENLABS_API_KEY (or OPENAI_API_KEY)');
  const eleven = elevenChoice({ ...pref, ...(elevenVoice ? { elevenVoice } : {}) });
  const oaVoice = OPENAI_VOICES.includes(openaiVoice) ? openaiVoice : OPENAI_VOICES.includes(pref.voice) ? pref.voice : 'marin';
  const id = engine === 'elevenlabs' ? `elevenlabs|${eleven.model}|${eleven.voiceId}` : `openai|${oaVoice}`;
  const key = createHash('sha256').update(id + '|' + lang + '|' + text).digest('hex').slice(0, 40);
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = resolve(CACHE_DIR, key + '.mp3');
  if (existsSync(file)) return { audio: readFileSync(file), engine, cached: true };

  let audio;
  if (engine === 'elevenlabs') {
    try {
      const out = await elevenSpeech({ text, lang, voiceId: eleven.voiceId, model: eleven.model });
      audio = out.audio;
      const rate = (ELEVEN_MODELS.find(m => m.id === out.model) || ELEVEN_MODELS[0]).usdPer1k;
      logVoice('tts', (text.length / 1000) * rate);
    } catch (e) {
      if (!config.openaiKey) throw new HttpError(502, e.message);
      console.warn('voice: ElevenLabs failed, OpenAI speaks instead —', e.message);
      audio = await openaiSpeech(text, lang, oaVoice);
    }
  } else audio = await openaiSpeech(text, lang, oaVoice);

  writeFileSync(file, audio);
  if (Math.random() < 0.05) prune();
  return { audio, engine, cached: false };
}

/** Push-to-talk transcription: OpenAI when its key is set (keeps the name hints), else ElevenLabs Scribe. */
export async function transcribe(buf, type = 'audio/webm') {
  const engine = sttEngine();
  if (!engine) throw new HttpError(503, 'Speech-to-text needs ELEVENLABS_API_KEY or OPENAI_API_KEY on the server');
  const minutes = buf.length / 16000 / 60;                            // ~16 kB/s opus
  if (engine === 'elevenlabs') {
    try {
      const text = await elevenTranscribe(buf, type);
      logVoice('stt', minutes * (0.22 / 60));                         // Scribe v2: $0.22 per hour
      return text;
    } catch (e) { throw new HttpError(502, 'Transcription failed: ' + e.message); }
  }
  const form = new FormData();
  const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
  form.append('file', new Blob([buf], { type }), 'speech.' + ext);
  form.append('model', 'gpt-4o-mini-transcribe');
  // No fixed language: Kevin speaks German or English, sometimes both in one sentence. The prompt keeps names right.
  form.append('prompt', 'Kevin speaks German or English and sometimes mixes both. Write it down in the language spoken. Names: Agentic OS, ServiWeb, Werkstudent, Berlin, Fuxam.');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + config.openaiKey }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, 'Transcription failed: ' + (data.error?.message || res.status));
  logVoice('stt', minutes * 0.003);                                   // $0.003 per minute
  return (data.text || '').trim();
}
