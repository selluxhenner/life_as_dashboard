// Text-to-speech with a quick, lively voice. English by default; optionally each text in its own language.
// Speed is one setting for every engine: playback rate for server audio, utterance rate for device voices.
// 1. Premium (server: ElevenLabs Eleven v4 when its key is set, else OpenAI gpt-4o-mini-tts): natural, English and German.
//    The spoken briefing and world summary come pre-rendered from the server (audioPath), so every device hits one cache.
// 2. System voice: the best installed voice whose language matches the text ("Online (Natural)" voices
//    in Edge/WebView2 rank first). A German voice never reads English text, and vice versa.
// 3. Android app: the native TTS plugin with the detected language.
import { state, notify } from '../core/store.js';
import { apiConfig } from '../core/api.js';
import { toast } from '../core/fx.js';

export const PREMIUM_VOICES = [
  { id: 'marin', label: 'Marin', note: 'warm, natural (default)' },
  { id: 'shimmer', label: 'Shimmer', note: 'soft, light' },
  { id: 'sage', label: 'Sage', note: 'calm, even' },
  { id: 'coral', label: 'Coral', note: 'friendly, bright' },
  { id: 'ballad', label: 'Ballad', note: 'gentle, low' },
  { id: 'cedar', label: 'Cedar', note: 'deep, relaxed' }
];
// language: 'en' speaks everything in English (default); 'auto' matches the language of each text.
export const VOICE_DEFAULTS = { provider: 'auto', premiumVoice: 'marin', rate: 1.15, language: 'en', system: {} };
export const SPEEDS = [{ value: 1, label: 'Calm' }, { value: 1.15, label: 'Brisk' }, { value: 1.3, label: 'Fast' }];
const clampRate = r => Math.max(0.8, Math.min(1.5, Number(r) || VOICE_DEFAULTS.rate));
/* Roughly how long a text takes at the current speed (~160 words a minute at 1×). */
export const secondsFor = text => Math.max(5, Math.round((String(text).match(/\S+/g) || []).length / (160 * clampRate(voiceSettings().rate) / 60)));
export const voiceSettings = () => ({ ...VOICE_DEFAULTS, ...(state.settings.voice || {}), system: { ...((state.settings.voice || {}).system || {}) } });

const LOCALE = { en: 'en-GB', de: 'de-DE' };
export const VOICE_SAMPLES = {
  en: 'Morning, Kevin! Busy one today: deep work at nine, a call with Anna at three, and training tonight. Everything else can wait.',
  de: 'Guten Morgen, Kevin! Volles Programm heute: Deep Work um neun, ein Anruf mit Anna um drei und am Abend Training.'
};

/* ---------- language ---------- */
const DE_WORDS = /\b(der|die|das|und|ist|nicht|ich|du|wir|ihr|mit|für|auf|ein|eine|einen|zu|heute|morgen|noch|auch|aber|oder|wenn|dann|schon|bitte|danke|termin|uhr|woche|habe|hast|sind|wird|kein|keine)\b/gi;
const EN_WORDS = /\b(the|and|is|are|you|your|to|of|for|with|on|today|tomorrow|this|that|it|be|have|has|not|no|one|week|open|tasks?|nothing|session|sessions)\b/gi;
export function detectLang(text) {
  const t = ' ' + text + ' ';
  const de = (t.match(DE_WORDS) || []).length + (t.match(/[äöüß]/gi) || []).length * 0.5;
  const en = (t.match(EN_WORDS) || []).length;
  return de > en ? 'de' : 'en';
}

/* Strip what should not be read out: markdown, links, emoji, UI symbols. */
export function speakable(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>]+/g, '')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s*[·•|]\s*/g, ', ')
    .replace(/\s*(→|->)\s*/g, ' to ')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1 of $2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/* Sentence-sized chunks: Chrome cuts long utterances off, and pauses between sentences sound calmer. */
function chunks(text) {
  const parts = text.split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length <= 220) { out.push(p); continue; }
    let rest = p;
    while (rest.length > 220) { const cut = Math.max(rest.lastIndexOf(', ', 220), rest.lastIndexOf(' ', 220)); out.push(rest.slice(0, cut)); rest = rest.slice(cut + 1).trim(); }
    if (rest) out.push(rest);
  }
  return out;
}

/* ---------- system voices ---------- */
const SOFT = /\b(ava|emma|jenny|aria|sonia|libby|maisie|michelle|ana|seraphina|katja|amala|louisa|tanja|google uk english female|google deutsch)\b/i;
let voicesReady = null;
export function systemVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  voicesReady = voicesReady || new Promise(res => {
    const done = () => res(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  return voicesReady;
}
export function voiceScore(v, lang) {
  const multi = /multilingual/i.test(v.name);
  if (!v.lang.toLowerCase().startsWith(lang) && !multi) return -1;
  let s = 0;
  if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 50;
  if (multi) s += 10;
  if (SOFT.test(v.name)) s += 15;
  if (lang === 'en' && /en-GB/i.test(v.lang)) s += 4;
  if (!v.localService) s += 3;
  return s;
}
export async function bestVoice(lang) {
  const all = await systemVoices();
  const pref = voiceSettings().system[lang];
  const chosen = pref && all.find(v => v.name === pref);
  if (chosen) return chosen;
  return all.map(v => [voiceScore(v, lang), v]).filter(x => x[0] >= 0).sort((a, b) => b[0] - a[0]).map(x => x[1])[0] || null;
}

/* ---------- playback ---------- */
let audio = null, speaking = false, gen = 0, playing = null;
const cache = new Map();          // premium audio, so replaying the briefing is instant and free
export const isSpeaking = () => speaking;
/* What is being read right now ('briefing', 'world', 'talk' …), so a view can turn its Listen button into Stop. */
export const speakingWhat = () => (speaking ? playing : null);
export function clearVoiceCache() { for (const u of cache.values()) URL.revokeObjectURL(u); cache.clear(); }

export function stopSpeaking() {
  gen++;
  if (speaking) { speaking = false; playing = null; notify(); }
  if (audio) { audio.pause(); audio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech;
  if (cap) cap.stop().catch(() => {});
}

async function speakPremium(text, lang, v, my, audioPath) {
  const key = (audioPath || v.premiumVoice + '|' + lang) + '|' + text;
  let url = cache.get(key);
  if (!url) {
    const cfg = apiConfig();
    const base = cfg.url.replace(/\/+$/, '');
    const res = audioPath
      ? await fetch(base + audioPath, { headers: { Authorization: 'Bearer ' + cfg.token } })
      : await fetch(base + '/api/voice/tts', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang, voice: v.premiumVoice })
      });
    if (!res.ok) throw new Error('tts ' + res.status);
    url = URL.createObjectURL(await res.blob());
    cache.set(key, url);
    if (cache.size > 12) { const [k, u] = cache.entries().next().value; URL.revokeObjectURL(u); cache.delete(k); }
  }
  if (my !== gen) return;
  await new Promise((resolve, reject) => {
    audio = new Audio(url);
    audio.preservesPitch = true;               // faster, not higher
    audio.playbackRate = clampRate(v.rate);
    audio.onended = resolve;
    audio.onerror = reject;
    audio.play().catch(reject);
  });
}

async function speakSystem(text, lang, v, my) {
  const voice = await bestVoice(lang);
  if (!voice) return false;
  for (const part of chunks(text)) {
    if (my !== gen) return true;
    await new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(part);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = clampRate(v.rate);
      u.pitch = 1;
      u.volume = 0.92;
      u.onend = resolve;
      u.onerror = e => (e.error === 'not-allowed' ? reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })) : resolve());
      speechSynthesis.speak(u);
    });
  }
  return true;
}

let warned = {};
function noVoice(lang) {
  if (warned[lang]) return;
  warned[lang] = true;
  const name = lang === 'de' ? 'German' : 'English';
  toast(apiConfig()
    ? `The server voice isn’t reachable or set up (Settings › Voice), and this device has no ${name} voice.`
    : `No ${name} voice on this device. Pair the server for the natural voice, or add one in Windows Settings › Time & language › Speech.`, 'amber');
}

const blocked = e => e && e.name === 'NotAllowedError';

/**
 * speak(text, onEnd, {lang, what, audioPath, onBlocked})
 * - lang is detected from the text when not given.
 * - what names the source ('briefing', 'world', …) for speakingWhat().
 * - audioPath plays server-rendered audio (e.g. '/api/voice/briefing'); text is still used by the device-voice fallback.
 * - onBlocked fires instead of onEnd when the browser refuses to play without a tap (autoplay policy).
 * onEnd fires once otherwise, also when nothing could be spoken.
 */
export async function speak(text, onEnd, opts = {}) {
  stopSpeaking();
  const my = gen;
  const clean = speakable(text);
  const v = voiceSettings();
  const lang = opts.lang || (v.language === 'auto' ? detectLang(clean) : 'en');
  const finish = () => { if (my === gen) { speaking = false; playing = null; notify(); onEnd && onEnd(); } };
  const refuse = () => { if (my === gen) { speaking = false; playing = null; notify(); opts.onBlocked ? opts.onBlocked() : onEnd && onEnd(); } };
  if (!clean) return finish();
  speaking = true; playing = opts.what || 'text'; notify();
  const premiumOn = apiConfig() && (v.provider === 'premium' || v.provider === 'auto');
  if (premiumOn) {
    try { await speakPremium(clean, lang, v, my, lang === 'en' ? opts.audioPath : null); return finish(); }
    catch (e) { if (blocked(e)) return refuse(); /* else fall back to the device voice */ }
    if (my !== gen) return;
  }
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech;
  if (cap) {
    try { await cap.speak({ text: clean, lang: LOCALE[lang], rate: clampRate(v.rate), pitch: 1.0 }); } catch { /* ignore */ }
    return finish();
  }
  try { if (!('speechSynthesis' in window) || !(await speakSystem(clean, lang, v, my))) noVoice(lang); }
  catch (e) { if (blocked(e)) return refuse(); }
  finish();
}
