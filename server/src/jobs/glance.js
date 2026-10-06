// "Glance": the small summary the phone shows outside the app — the morning notification, the home-screen widget
// and the Quick Settings tile. Short strings only; the app itself has everything else.
import { getSetting } from '../settings.js';
import { localDate } from '../lib/time.js';
import { getBriefing } from './briefing.js';
import { latestDigest } from './news.js';
import { aiToday } from './aimodels.js';

const VENDOR_NAME = { openai: 'OpenAI', github: 'GitHub', xai: 'xAI', deepseek: 'DeepSeek', huggingface: 'Hugging Face' };
const vendorName = v => VENDOR_NAME[v] || String(v || '').replace(/^./, c => c.toUpperCase());

export function glance(now = new Date()) {
  const date = localDate(now);
  const b = getBriefing(date);
  const { digest, breaking } = latestDigest();
  const ai = aiToday();
  const sp = b && b.spoken;
  return {
    date, at: now.getTime(), briefingTime: getSetting('briefing').time,
    briefing: b ? {
      date: b.date, createdAt: b.createdAt, headline: b.headline, overview: (sp && sp.overview) || '',
      points: ((sp && sp.topics) || []).slice(0, 4).map(t => ({ label: t.label, say: t.say })), focus: (b.focus || []).slice(0, 3)
    } : null,
    world: {
      createdAt: digest ? digest.createdAt : null,
      top: ((digest && digest.top) || []).slice(0, 4).map(s => ({ headline: s.headline, country: s.country || '', region: s.region || '' })),
      breaking: breaking.slice(0, 2).map(x => ({ headline: x.headline, country: x.country || '', at: x.publishedAt }))
    },
    ai: { date: ai.date, top: (ai.highlights || []).slice(0, 3).map(h => ({ title: h.title, vendor: vendorName(h.vendor) })) }
  };
}
