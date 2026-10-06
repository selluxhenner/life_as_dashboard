// Spoken scripts (morning briefing, world summary): a 30-second summary, never the page read aloud. The budget is
// enforced in code, not only in the prompt. The voice runs brisk (a quick-pace direction for Eleven v4, then 1.15×
// playback on the device), about 180 words a minute, so 90 words is 30 seconds.
export const MAX_WORDS = 90;
const WPS = 180 / 60;

// Eleven v4 has no speed or style setting; it takes inline directions in square brackets instead. Every spoken line
// carries one tone, so the briefing rises and falls like a person talking rather than a flat read-out.
export const TONES = {
  bright: 'bright, upbeat',
  warm: 'warm, friendly',
  serious: 'serious, steady',
  urgent: 'focused, urgent',
  curious: 'curious, intrigued',
  relaxed: 'relaxed, easy',
  excited: 'excited'
};
export const TONE_IDS = Object.keys(TONES);
export const PACE = 'Quick, lively, energetic pace';
export const TONE_RULE = `tone (per line, and overviewTone for the overview), so the voice moves like a person talking: bright (good news, a win, an easy day), warm (personal, encouraging),
serious (bad news, world events), urgent (deadline, overdue, must answer today), curious (something surprising or interesting),
relaxed (low stakes, can wait), excited (genuinely great news). Vary it; don't give every line the same tone.`;

export const words = s => (String(s).match(/\S+/g) || []).length;
// split only where punctuation is followed by a space, so "2.5%" or "9.30" stay whole
const sentencesOf = t => t.split(/(?<=[.!?]["')\]]?)\s+/).filter(Boolean);
export const seconds = n => Math.round(n / WPS);
/** Removes [directions] for engines that would read them out (Multilingual v2, Flash, OpenAI, device voices). */
export const stripTags = s => String(s).replace(/\[[^\]]{1,80}\]\s*/g, '').trim();

/* One spoken line: no markdown, symbols or [directions], at most `max` sentences. */
export function cleanSay(s, max = 2) {
  const t = stripTags(String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'))
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>]+/g, '')
    .replace(/\s*[•·|]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = sentencesOf(t).slice(0, max).join(' ');
  return cut && !/[.!?]["')\]]*$/.test(cut) ? cut + '.' : cut;
}
const capWords = (s, n) => { const w = s.split(/\s+/); return w.length <= n ? s : w.slice(0, n).join(' ').replace(/[,;:]$/, '') + '.'; };
const tone = t => (TONE_IDS.includes(t) ? t : undefined);

/**
 * shapeSpoken({greeting, overview, overviewTone, topics:[{label, say, tone, refs}], outro}, isValidRef)
 *   -> {greeting, overview, overviewTone, topics, outro, words, seconds}
 * Drops ungrounded topics, keeps five at most, then trims from the end until it fits the word budget.
 */
export function shapeSpoken(out, isValidRef, maxWords = MAX_WORDS) {
  const greeting = capWords(cleanSay(out.greeting || '', 1), 8);
  let overview = cleanSay(out.overview || '', 1);
  if (words(overview) > 18) overview = '';                   // a run-on "overview" is just another topic
  let outro = cleanSay(out.outro || '', 1);
  if (words(outro) > 12) outro = '';
  let topics = (out.topics || [])
    .map(t => ({ label: String(t.label || '').replace(/\s+/g, ' ').trim().slice(0, 24), say: cleanSay(t.say), tone: tone(t.tone), refs: (t.refs || []).filter(isValidRef) }))
    .filter(t => t.say && t.refs.length)
    .slice(0, 5);
  // a single runaway topic is cut to its first sentence before anything is dropped
  topics = topics.map(t => (words(t.say) > 32 ? { ...t, say: cleanSay(t.say, 1) } : t));
  const total = () => words(greeting) + words(overview) + words(outro) + topics.reduce((n, t) => n + words(t.say), 0);
  while (topics.length > 1 && total() > maxWords) topics.pop();
  if (total() > maxWords) outro = '';
  if (total() > maxWords) overview = '';
  const n = total();
  return { greeting, overview, overviewTone: tone(out.overviewTone), topics, outro, words: n, seconds: seconds(n) };
}

const lines = (spoken, intro) => [
  { say: intro || spoken.greeting, tone: 'bright' },
  { say: spoken.overview, tone: spoken.overviewTone },
  ...(spoken.topics || []),
  { say: spoken.outro, tone: 'relaxed' }
].filter(l => l.say);

/** The plain text that is spoken (for the screen, device voices and the agent's follow-up context). */
export function spokenText(spoken, intro) {
  if (!spoken) return '';
  return lines(spoken, intro).map(l => l.say).join(' ').trim();
}

/**
 * The same script with delivery directions for Eleven v4: a quick, lively pace up front and a tone per line.
 * Engines that can't follow directions get it through stripTags. Deterministic, because it is the audio cache key.
 */
export function spokenScript(spoken, intro) {
  if (!spoken) return '';
  const ls = lines(spoken, intro);
  if (!ls.length) return '';
  return ls.map((l, i) => {
    const t = TONES[l.tone];
    return i === 0 ? `[${PACE}${t ? ', ' + t : ''}] ${l.say}` : (t ? `[${t}] ` : '') + l.say;
  }).join(' ');
}
