// ElevenLabs: the natural voice (text-to-speech), Scribe speech-to-text, the account's voices and its credit balance.
// Eleven v4 (Sept 2026) is the most natural model, but it runs through the Text to Dialogue API (max 2,000 characters).
// Longer texts, and accounts where v4 is refused, use Multilingual v2 on the classic text-to-speech endpoint.
import { config } from '../config.js';
import { PACE, stripTags } from './script.js';

const API = config.elevenApi;

export const ELEVEN_MODELS = [
  { id: 'eleven_v4', label: 'Eleven v4', note: 'most natural', usdPer1k: 0.08 },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2', note: 'steady narrator', usdPer1k: 0.08 },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5', note: 'fastest, half the credits', usdPer1k: 0.04 }
];
export const ELEVEN_MODEL_IDS = ELEVEN_MODELS.map(m => m.id);
// Jessica: a bright, playful, warm premade voice that sounds awake rather than narrated (Kevin found the calm Lily too
// flat). If an account doesn't have it, the first premade voice is used instead.
export const DEFAULT_ELEVEN_VOICE = 'cgSgspJ2msm6clMCkdW9';
const DIALOGUE_MAX = 1900;

class ElevenError extends Error {
  constructor(status, detail, path = '') {
    const d = (detail && typeof detail === 'object' && detail.detail) || {};
    super(`ElevenLabs ${status}: ${d.message || (typeof detail === 'string' ? detail.slice(0, 160) : 'request failed')}`);
    this.status = status;
    this.code = d.status || '';
    this.path = path;
  }
}

async function post(path, payload) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text; try { detail = JSON.parse(text); } catch { /* plain text */ }
    throw new ElevenError(res.status, detail, path);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function get(path) {
  const res = await fetch(API + path, { headers: { 'xi-api-key': config.elevenKey }, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ElevenError(res.status, data, path);
  return data;
}

let v4BlockedUntil = 0;
const isVoiceMissing = e => e instanceof ElevenError &&
  (/voice_not_found|voice_does_not_exist/i.test(e.code) || (e.status === 404 && e.path.startsWith('/v1/text-to-speech/')));

async function render(text, lang, voiceId, model) {
  if (model === 'eleven_v4' && text.length <= DIALOGUE_MAX && Date.now() > v4BlockedUntil) {
    // v4 has no speed setting; a leading direction sets a quick, lively delivery for anything that doesn't bring its own.
    const directed = /^\s*\[/.test(text) ? text : `[${PACE}] ${text}`;
    try {
      const audio = await post('/v1/text-to-dialogue?output_format=mp3_44100_128', {
        inputs: [{ text: directed, voice_id: voiceId }], model_id: 'eleven_v4', language_code: lang, settings: { stability: 0.5 }
      });
      return { audio, model: 'eleven_v4' };
    } catch (e) {
      // Bad key, empty quota or an outage is not a model problem: report it instead of retrying another model.
      if (!(e instanceof ElevenError) || isVoiceMissing(e) || ![400, 403, 404, 422].includes(e.status)) throw e;
      v4BlockedUntil = Date.now() + 3600000;
      console.warn('voice: Eleven v4 refused, using Multilingual v2 for an hour —', e.message);
    }
  }
  // These models would read [directions] out loud; they get speed and style settings instead (lower stability, more style = livelier).
  const m = model === 'eleven_flash_v2_5' ? model : 'eleven_multilingual_v2';
  const audio = await post(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    text: stripTags(text), model_id: m, ...(m === 'eleven_flash_v2_5' ? { language_code: lang } : {}),
    voice_settings: { stability: 0.35, similarity_boost: 0.75, style: 0.45, use_speaker_boost: true, speed: 1.1 }
  });
  return { audio, model: m };
}

/** Text to mp3. Returns {audio: Buffer, model, voiceId}. */
export async function elevenSpeech({ text, lang = 'en', voiceId = DEFAULT_ELEVEN_VOICE, model = 'eleven_v4' }) {
  try {
    return { ...(await render(text, lang, voiceId, model)), voiceId };
  } catch (e) {
    if (!isVoiceMissing(e)) throw e;
    const fallback = (await elevenVoices()).find(v => v.category === 'premade' && v.id !== voiceId);
    if (!fallback) throw e;
    return { ...(await render(text, lang, fallback.id, model)), voiceId: fallback.id };
  }
}

/** Scribe v2 speech-to-text. Detects the language itself (Kevin mixes German and English). */
export async function elevenTranscribe(buf, type = 'audio/webm') {
  const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  form.append('file', new Blob([buf], { type }), 'speech.' + ext);
  form.append('tag_audio_events', 'false');
  const res = await fetch(API + '/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': config.elevenKey }, body: form, signal: AbortSignal.timeout(60000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ElevenError(res.status, data);
  return (data.text || '').trim();
}

let voiceCache = null;
/** The account's voices (premade, cloned and saved library voices), cached for an hour. */
export async function elevenVoices() {
  if (voiceCache && Date.now() - voiceCache.at < 3600000) return voiceCache.list;
  const data = await get('/v2/voices?page_size=100');
  const list = (data.voices || []).map(v => {
    const l = v.labels || {};
    return {
      id: v.voice_id, name: v.name, category: v.category || '',
      accent: l.accent || '', gender: l.gender || '', age: l.age || '',
      tone: l.descriptive || l.description || '', useCase: l.use_case || l.usecase || '',
      description: (v.description || '').slice(0, 200), preview: v.preview_url || ''
    };
  });
  voiceCache = { at: Date.now(), list };
  return list;
}

/** Plan and credits used this period, or null when the key may not read the account. */
export async function elevenAccount() {
  try {
    const s = await get('/v1/user/subscription');
    return { tier: s.tier || '', used: s.character_count ?? null, limit: s.character_limit ?? null, resetsAt: s.next_character_count_reset_unix ? s.next_character_count_reset_unix * 1000 : null };
  } catch { return null; }
}
