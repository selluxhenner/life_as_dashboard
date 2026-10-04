// Text-to-speech with a soft voice. English by default; optionally each text in its own language.
// 1. Premium (server, OpenAI gpt-4o-mini-tts or ElevenLabs): natural, handles English and German natively.
// 2. System voice: the best installed voice whose language matches the text ("Online (Natural)" voices
//    in Edge/WebView2 rank first). A German voice never reads English text, and vice versa.
// 3. Android app: the native TTS plugin with the detected language.
import { state } from '../core/store.js';
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
export const VOICE_DEFAULTS = { provider: 'auto', premiumVoice: 'marin', rate: 0.97, language: 'en', system: {} };
export const voiceSettings = () => ({ ...VOICE_DEFAULTS, ...(state.settings.voice || {}), system: { ...((state.settings.voice || {}).system || {}) } });

const LOCALE = { en: 'en-GB', de: 'de-DE' };
export const VOICE_SAMPLES = {
  en: 'Good morning, Kevin. Three things today: deep work at nine, a call with Anna at three, and training in the evening.',
  de: 'Guten Morgen, Kevin. Heute stehen drei Dinge an: Deep Work um neun, ein Anruf mit Anna um drei und am Abend Training.'
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
let audio = null, speaking = false, gen = 0;
const cache = new Map();          // premium audio, so replaying the briefing is instant and free
export const isSpeaking = () => speaking;

export function stopSpeaking() {
  gen++;
  speaking = false;
  if (audio) { audio.pause(); audio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech;
  if (cap) cap.stop().catch(() => {});
}

async function speakPremium(text, lang, v, my) {
  const key = v.premiumVoice + '|' + lang + '|' + text;
  let url = cache.get(key);
  if (!url) {
    const cfg = apiConfig();
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/api/voice/tts', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang, voice: v.premiumVoice, style: 'soft' })
    });
    if (!res.ok) throw new Error('tts ' + res.status);
    url = URL.createObjectURL(await res.blob());
    cache.set(key, url);
    if (cache.size > 12) { const [k, u] = cache.entries().next().value; URL.revokeObjectURL(u); cache.delete(k); }
  }
  if (my !== gen) return;
  await new Promise((resolve, reject) => {
    audio = new Audio(url);
    audio.playbackRate = Math.max(0.8, Math.min(1.2, v.rate / VOICE_DEFAULTS.rate));
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
    await new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(part);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = v.rate;
      u.pitch = 1;
      u.volume = 0.92;
      u.onend = u.onerror = resolve;
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
  toast(`No ${name} voice on this device. Pair the server for the premium voice, or add one in Windows Settings › Time & language › Speech.`, 'amber');
}

/**
 * speak(text, onEnd, {lang}) – lang is detected from the text when not given.
 * onEnd always fires once, also when nothing could be spoken.
 */
export async function speak(text, onEnd, opts = {}) {
  stopSpeaking();
  const my = gen;
  const clean = speakable(text);
  const v = voiceSettings();
  const lang = opts.lang || (v.language === 'auto' ? detectLang(clean) : 'en');
  const finish = () => { if (my === gen) { speaking = false; onEnd && onEnd(); } };
  if (!clean) return finish();
  speaking = true;
  const premiumOn = apiConfig() && (v.provider === 'premium' || v.provider === 'auto');
  if (premiumOn) {
    try { await speakPremium(clean, lang, v, my); return finish(); } catch { /* fall back to the system voice */ }
    if (my !== gen) return;
  }
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech;
  if (cap) {
    try { await cap.speak({ text: clean, lang: LOCALE[lang], rate: v.rate, pitch: 1.0 }); } catch { /* ignore */ }
    return finish();
  }
  if (!('speechSynthesis' in window) || !(await speakSystem(clean, lang, v, my))) noVoice(lang);
  finish();
}
