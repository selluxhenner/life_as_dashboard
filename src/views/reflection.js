import { h } from '../core/dom.js';
import { state, save, persist } from '../core/store.js';
import { todayKey, fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, empty } from '../components/ui.js';
import { reflFor, reflHasContent, MOODS } from '../core/model.js';

export default {
  id: 'reflection',
  render(root) {
    const tk = todayKey();
    const r = reflFor(tk);
    const area = (label, key, rows, placeholder) => h('div',
      h('label.label', { for: 'refl-' + key }, label),
      h('textarea.field', { id: 'refl-' + key, rows, placeholder, oninput: e => { r[key] = e.target.value; persist(); }, onblur: () => save() }, r[key] || ''));
    const keys = Object.keys(state.reflections).filter(k => reflHasContent(state.reflections[k])).sort().reverse();
    root.append(h('div.view',
      viewHead('Reflection', 'Two minutes at the end of the day. Saves as you type.'),
      h('div.grid.g-2',
        panel({ title: 'Today', readout: reflHasContent(r) ? 'saved' : 'empty' },
          h('div.label', 'Mood'),
          h('div.mood-row', MOODS.map((m, i) => h('button.mood' + (r.mood === i ? '.on' : ''), { type: 'button', 'aria-pressed': String(r.mood === i), 'aria-label': 'Mood ' + (i + 1) + ' of 5', onclick: () => { r.mood = r.mood === i ? null : i; save(); } }, m))),
          area('What went well?', 'good', 3, 'Wins, progress, good decisions'),
          area('What to improve?', 'improve', 3, 'What should go better tomorrow'),
          area('Grateful for', 'grateful', 2, 'Three things')),
        panel({ title: 'History', readout: keys.length + ' entries' },
          keys.length ? h('ol.refl-history', keys.slice(0, 21).map(k => {
            const e = state.reflections[k];
            return h('li',
              h('div.rh-head', h('span.data', fmt.short(k) + (k === tk ? ' · today' : '')), h('span', e.mood != null ? MOODS[e.mood] : '')),
              e.good ? h('p', h('span.muted', 'Went well  '), e.good) : null,
              e.improve ? h('p', h('span.muted', 'Improve  '), e.improve) : null,
              e.grateful ? h('p', h('span.muted', 'Grateful  '), e.grateful) : null);
          })) : empty('No entries yet', 'Your first reflection will show up here.')))));
  }
};
