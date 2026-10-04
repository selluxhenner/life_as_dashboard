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
const toneFor = v => `var(--tone-${VENDOR_TONE[(v || '').toLowerCase()] || 'samerica'})`;

/* Minimal markdown: paragraphs, bullets, bold, links. */
function md(text) {
  const out = h('div.md');
  let ul = null;
  for (const line of (text || '').split('\n')) {
    const t = line.trim();
    if (!t) { ul = null; continue; }
    const node = t.startsWith('- ') || t.startsWith('* ') ? (ul = ul || out.appendChild(h('ul')), ul.appendChild(h('li'))) : (ul = null, out.appendChild(h(t.startsWith('#') ? 'h3' : 'p')));
    inline(node, t.replace(/^[-*]\s+|^#+\s*/, ''));
  }
  return out;
}
function inline(node, s) {
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((https?:[^)]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    node.append(s.slice(last, m.index));
    node.append(m[1] ? h('b', m[1]) : h('a', { href: m[3], target: '_blank', rel: 'noopener' }, m[2]));
    last = re.lastIndex;
  }
  node.append(s.slice(last));
}

export default {
  id: 'ai',
  render(root) {
    const { data, connected, loading } = remote('aimodels', '/api/ai-models/today', 30 * 60000);
    const d = data || {};
    const best = (d.best || {})[cat] || [];
    const board = ((d.leaderboard || {}).rows || []).filter(r => !r.category || r.category === cat).slice(0, 12);
    root.append(h('div.view.ai',
      viewHead('AI models', d.date ? 'What changed in AI today, and which models lead right now.' : 'Daily tracker for new releases from Anthropic, OpenAI, Google, GitHub Copilot and others.',
        d.summaryMd ? h('button.btn', { type: 'button', onclick: () => speak(d.summaryMd.replace(/[*#\[\]]|\(http[^)]+\)/g, '')) }, icon('volume'), 'Read aloud') : null,
        connected ? btn(loading ? 'Refreshing…' : 'Refresh', () => refresh('aimodels', '/api/ai-models/today'), 'ghost', 'sync') : null),
      !connected ? panel({}, empty('The tracker runs on the server', 'Pair this device in Settings. The server checks vendor blogs and leaderboards every morning at 07:30.'))
      : h('div.grid.g-ai',
          panel({ title: 'New today', readout: d.date ? fmt.short(d.date) : '' },
            d.summaryMd ? md(d.summaryMd) : empty('Nothing yet today', 'The daily summary is written at 07:30.'),
            (d.updates || []).length ? h('ul.updates', d.updates.slice(0, 12).map(u => h('li', { style: { '--c': toneFor(u.vendor) } },
              h('span.u-vendor', u.vendor),
              h('a', { href: u.url, target: '_blank', rel: 'noopener' }, u.title),
              u.importance >= 8 ? chip('major', 'alert') : u.kind ? chip(u.kind, null, 'plain') : null,
              h('span.data.muted', u.publishedAt ? fmt.ago(new Date(u.publishedAt).getTime()) : '')))) : null),
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
