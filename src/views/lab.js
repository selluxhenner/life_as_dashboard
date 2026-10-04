// #/lab — the design system on one page, every theme side by side. Not in the nav.
import { h } from '../core/dom.js';
import { panel } from '../components/panel.js';
import { viewHead, check, chip, meter, seg, toggle, btn, empty, select } from '../components/ui.js';
import { createChronosphere } from '../components/chronosphere.js';
import { THEMES } from '../core/theme.js';
import { REGIONS } from '../data/regions.js';
import { icon } from '../core/icons.js';

let clocks = [];

function specimen(themeId) {
  const t = THEMES.find(x => x.id === themeId);
  const clock = createChronosphere({ size: 260, compact: true });
  clock.update({ events: [
    { start: 9 * 60, end: 10.5 * 60, color: 'var(--amber)', title: 'Lesson' },
    { start: 11 * 60, end: 12 * 60, color: 'var(--signal)', title: 'Deep work' },
    { start: 14 * 60, end: 14.5 * 60, color: 'var(--tone-europe)', title: 'Call' }
  ] });
  clocks.push(clock);
  const tokens = ['--void', '--hull', '--hull-2', '--seam', '--seam-strong', '--ink', '--ink-2', '--ink-3', '--signal', '--pulse', '--amber', '--flare'];
  return h('section.lab-theme', { dataset: { theme: themeId } },
    h('h2.lab-h', t.name, h('span.muted', ' · ' + t.note)),
    h('div.lab-swatches', tokens.map(k => h('div.sw', h('i', { style: { background: `var(${k})` } }), h('span.data', k.slice(2))))),
    h('div.lab-swatches', REGIONS.map(r => h('div.sw', h('i', { style: { background: `var(--tone-${r.key})` } }), h('span.data', r.short)))),
    h('div.lab-grid',
      panel({ title: 'Panel title', readout: h('span', h('b', '12'), ' items') },
        h('div.rows',
          h('div.row', check(true, () => {}), h('div.grow', h('div.title', 'Completed row'), h('div.sub', 'Secondary line')), chip('ok', 'ok')),
          h('div.row', check(false, () => {}), h('div.grow', h('div.title', 'Open row')), chip('high', 'alert')),
          h('div.row.cal', { style: { '--c': 'var(--amber)' } }, h('span.marker'), h('span.time', '09:00'), h('div.grow', h('div.title', 'Calendar event')))),
        h('div', { style: { marginTop: '12px' } }, meter(64))),
      panel({ title: 'Controls' },
        h('div.input-row', btn('Primary', () => {}, 'primary', 'plus'), btn('Default', () => {}), btn('Ghost', () => {}, 'ghost')),
        h('div.input-row', { style: { marginTop: '8px' } }, h('button.btn', { disabled: true }, 'Disabled'), btn('Danger', () => {}, 'danger')),
        h('div', { style: { marginTop: '12px' } }, h('input.field', { placeholder: 'Text field' })),
        h('div.input-row', { style: { marginTop: '8px' } }, select([{ value: 'a', label: 'Select' }], 'a', () => {}, 'Select', 'field narrow'), toggle(true, () => {}, 'Toggle'), seg([{ value: 1, label: 'Day' }, { value: 2, label: 'Week' }], 2, () => {}, 'Seg')),
        h('div.input-row', { style: { marginTop: '8px' } }, chip('live', 'signal', 'live'), chip('warning', 'warn'), chip('plain', null, 'plain'))),
      panel({ cls: 'quiet' }, clock.el)),
    h('div.lab-type',
      h('div', { style: { fontSize: 'var(--fs-hero)', fontWeight: 300, letterSpacing: '-.03em' } }, 'Good morning.'),
      h('div', { style: { fontSize: 'var(--fs-3xl)' } }, 'View title 36'),
      h('div', { style: { fontSize: 'var(--fs-lg)' } }, 'Panel title 18.75'),
      h('div', 'Body 15 — The quick brown fox plans a deep work block.'),
      h('div.data', 'Data 13.8 · 09:41:07 · 52.52N 13.40E'),
      h('div.micro', 'Micro label 10.5'),
      h('div', { style: { fontFamily: 'var(--font-dot)', fontSize: '56px', fontWeight: 700, color: 'var(--signal)' } }, '08:42')));
}

export default {
  id: 'lab',
  render(root) {
    clocks.forEach(c => c.destroy()); clocks = [];
    root.append(h('div.view.lab',
      viewHead('Design lab', 'Every token and component in all three themes.'),
      THEMES.map(t => specimen(t.id))));
  },
  unmount() { clocks.forEach(c => c.destroy()); clocks = []; }
};
