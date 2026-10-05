import { h } from '../core/dom.js';
import { state, save } from '../core/store.js';
import { uid, pct } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, check, removeBtn, addRow, meter, empty } from '../components/ui.js';
import { tick } from '../core/fx.js';
import { TIERS } from '../core/model.js';
import { goalTicks, goalProgress, toggleGoalStep, setGoalDone } from '../core/goals.js';

/* "3x Krafttraining" → three buttons 1 2 3, each ticked off on its own. */
function steps(g) {
  const t = goalTicks(g);
  if (t.length < 2) return null;
  return h('div.goal-steps', { role: 'group', 'aria-label': `${g.label}: ${goalProgress(g)} of ${t.length} done` },
    t.map((on, i) => h('button.goal-step', {
      type: 'button', 'aria-pressed': String(on), title: on ? `#${i + 1} done` : `Mark #${i + 1} done`,
      onclick: e => { e.stopPropagation(); tick(on ? 'tap' : 'ok'); toggleGoalStep(g, i); save(); }
    }, h('span.data', String(i + 1)), h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M5 12.5l4.5 4.5L19 7.5' })))));
}

export default {
  id: 'goals',
  render(root) {
    const cols = TIERS.map((tier, i) => {
      const arr = state.ziele[tier.key];
      const done = arr.filter(g => g.done).length;
      const stepsAll = arr.reduce((n, g) => n + goalTicks(g).length, 0), stepsDone = arr.reduce((n, g) => n + goalProgress(g), 0);
      return panel({ title: tier.label, readout: h('span', h('b', `${done}/${arr.length}`)) },
        meter(pct(stepsDone, stepsAll), ['var(--signal)', 'var(--tone-namerica)', 'var(--tone-oceania)'][i]),
        h('div.rows', { style: { marginTop: '12px' } },
          arr.length ? arr.map((g, idx) => {
            const n = goalTicks(g).length;
            return h('div.row.goal' + (g.done ? '.done' : ''),
              check(g.done, () => { setGoalDone(g, !g.done); save(); }, 'Goal reached'),
              h('div.grow',
                h('div.title', g.label),
                n > 1 ? h('div.sub.data', `${goalProgress(g)}/${n}`) : null,
                steps(g)),
              removeBtn(() => { arr.splice(arr.indexOf(g), 1); save(); }, 'Remove goal', { what: g.label }));
          }) : empty('No goals yet', 'Tip: "3x gym" or "2 job applications" gets one tick per time.')),
        h('div', { style: { marginTop: '12px' } }, addRow({ placeholder: `New goal for ${tier.label.toLowerCase()}`, onSubmit: v => { arr.push({ id: uid(), label: v, done: false }); save(); } })));
    });
    root.append(h('div.view', viewHead('Goals', 'Week, month, year — each horizon feeds the next.'), h('div.grid.g-3', cols)));
  }
};
