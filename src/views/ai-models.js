import { h } from '../core/dom.js';
import { notify } from '../core/store.js';
import { fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, empty, chip, seg, btn } from '../components/ui.js';
import { remote, refresh } from '../core/remote.js';
import { speak } from '../voice/tts.js';
import { icon } from '../core/icons.js';

const CATS = [
  { value: 'overall', label: 'Overall' },
  { value: 'coding', label: 'Coding' },
  { value: 'fast', label: 'Fast + cheap' },
  { value: 'open', label: 'Open weights' }
];
let cat = 'overall';

const VENDOR_TONE = { anthropic: 'africa', openai: 'namerica', google: 'europe', github: 'oceania', meta: 'europe', mistral: 'asia', deepseek: 'asia', xai: 'mideast' };
export const toneFor = v => `var(--tone-${VENDOR_TONE[(v || '').toLowerCase()] || 'samerica'})`;
const VENDOR_NAME = { openai: 'OpenAI', github: 'GitHub', xai: 'xAI', deepseek: 'DeepSeek', huggingface: 'Hugging Face', meta: 'Meta' };
export const vendorName = v => VENDOR_NAME[(v || '').toLowerCase()] || (v || '').replace(/^./, c => c.toUpperCase());

/* The 8 most important recent changes, each with a short "what really changed". */
function highlightList(list) {
  return h('ol.highlights', list.map((u, i) => h('li', { style: { '--c': toneFor(u.vendor) } },
    h('span.hl-rank.data', String(i + 1)),
    h('div.hl-head',
      u.url ? h('a', { href: u.url, target: '_blank', rel: 'noopener' }, u.title) : h('b', u.title),
      u.importance >= 8 ? chip('major', 'alert') : null),
    u.what ? h('p.hl-what', u.what) : null,
    h('div.hl-meta', h('span.u-vendor', vendorName(u.vendor)), u.kind && u.kind !== 'other' ? h('span', u.kind) : null,
      u.publishedAt ? h('span.data', fmt.ago(new Date(u.publishedAt).getTime())) : null))));
}

const spoken = list => list.map((u, i) => `${i + 1}. ${u.title}. ${u.what || ''}`).join(' ');

export const aiData = () => remote('aimodels', '/api/ai-models/today', 30 * 60000);

export default {
  id: 'ai',
  render(root) {
    const { data, connected, loading } = aiData();
    const d = data || {};
    const best = (d.best || {})[cat] || [];
    const board = ((d.leaderboard || {}).rows || []).filter(r => !r.category || r.category === cat).slice(0, 12);
    const top = (d.highlights || []).slice(0, 8);
    root.append(h('div.view.ai',
      viewHead('AI models', 'The 8 most important changes from the AI labs this week, and which models lead right now.',
        top.length ? h('button.btn', { type: 'button', onclick: () => speak(spoken(top)) }, icon('volume'), 'Read aloud') : null,
        connected ? btn(loading ? 'Refreshing…' : 'Refresh', () => refresh('aimodels', '/api/ai-models/today'), 'ghost', 'sync') : null),
      !connected ? panel({}, empty('The tracker runs on the server', 'Connect to your server in Settings. It checks vendor blogs and leaderboards every morning at 07:30.'))
      : h('div.grid.g-ai',
          panel({ title: 'What changed', readout: d.date ? 'updated ' + fmt.short(d.date) : '' },
            top.length ? highlightList(top) : empty('Nothing yet', 'The top changes are picked every morning at 07:30.')),
          h('div.stack',
            panel({ title: 'Best right now', actions: [seg(CATS, cat, v => { cat = v; notify(); }, 'Category')] },
              best.length ? h('ol.podium', best.slice(0, 3).map((b, i) => h('li', { style: { '--c': toneFor(b.vendor) } },
                h('span.pod-rank.data', String(i + 1)), h('div.grow', h('div.title', b.model), h('div.sub', b.vendor + (b.why ? ' · ' + b.why : ''))), b.score ? h('span.data', String(b.score)) : null)))
                : empty('No ranking yet', null)),
            panel({ title: 'Leaderboard', readout: d.leaderboard ? `${d.leaderboard.source} · ${fmt.ago(new Date(d.leaderboard.updatedAt).getTime())}` : '' },
              board.length ? h('table.table', h('thead', h('tr', h('th', '#'), h('th', 'Model'), h('th', 'Vendor'), h('th', 'Score'))),
                h('tbody', board.map(r => h('tr', h('td.data', String(r.rank)), h('td', r.model), h('td', h('span', { style: { color: toneFor(r.vendor) } }, r.vendor)), h('td.data', String(r.score ?? '—'))))))
                : empty('Leaderboard unavailable', 'Add an Artificial Analysis key on the server to enable it.'))))));
  }
};
