import { h } from '../core/dom.js';
import { state, save } from '../core/store.js';
import { uid, pct } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, check, removeBtn, addRow, meter, empty } from '../components/ui.js';
import { TIERS } from '../core/model.js';

export default {
  id: 'goals',
  render(root) {
    const cols = TIERS.map((tier, i) => {
      const arr = state.ziele[tier.key];
      const done = arr.filter(g => g.done).length;
      return panel({ title: tier.label, readout: h('span', h('b', `${done}/${arr.length}`)) },
        meter(pct(done, arr.length), ['var(--signal)', 'var(--tone-namerica)', 'var(--tone-oceania)'][i]),
        h('div.rows', { style: { marginTop: '12px' } },
          arr.length ? arr.map((g, idx) => h('div.row' + (g.done ? '.done' : ''),
            check(g.done, () => { g.done = !g.done; save(); }, 'Goal reached'),
            h('div.grow', h('div.title', g.label)),
            removeBtn(() => { arr.splice(idx, 1); save(); }, 'Remove goal'))) : empty('No goals yet', null)),
        h('div', { style: { marginTop: '12px' } }, addRow({ placeholder: `New goal for ${tier.label.toLowerCase()}`, onSubmit: v => { arr.push({ id: uid(), label: v, done: false }); save(); } })));
    });
    root.append(h('div.view', viewHead('Goals', 'Week, month, year — each horizon feeds the next.'), h('div.grid.g-3', cols)));
  }
};
