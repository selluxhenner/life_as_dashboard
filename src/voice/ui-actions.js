// What Lina does in the app itself: her open_page and sort_captures tools come back as actions ({action, data}) with
// a spoken turn (/api/voice/turn → ui) or in the chat stream (type 'ui'), and run here.
import { state } from '../core/store.js';
import { go } from '../core/router.js';
import { toast } from '../core/fx.js';
import { updateCapture } from '../features/capture/captures.js';
import { showByArea } from '../views/captures.js';

/* Her page names → the app's routes. */
const ROUTE = { world: 'news', plan: 'goals', chat: 'assistant' };
export const routeFor = page => ROUTE[page] || page;

export function runUiActions(list) {
  for (const u of list || []) {
    try {
      if (u.action === 'open_page' && u.data && u.data.page) go(routeFor(u.data.page));
      else if (u.action === 'sort_captures' && u.data && Array.isArray(u.data.items)) {
        let n = 0;
        for (const it of u.data.items) {
          const c = state.captures.find(x => x.id === it.id);
          if (!c || c.type === it.type) continue;
          const patch = { type: it.type };
          if (it.date) patch.date = it.date;
          if (it.time) patch.time = it.time;
          updateCapture(c, patch);             // a task becomes a real task, a habit a habit, a block lands on the plan
          n++;
        }
        showByArea();
        go('captures');
        if (n) toast(`Lina sorted ${n} capture${n === 1 ? '' : 's'}`, 'pulse');
      }
    } catch (e) { console.warn('lina action', u.action, e); }
  }
}
