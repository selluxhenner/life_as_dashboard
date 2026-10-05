// Things that float above the view: confirm dialog, dropdown menu, date and time pickers.
// All live on <body>, so a view re-render underneath doesn't kill them; they close when their anchor disappears.
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { tick } from '../core/fx.js';
import { todayKey, keyOffset, parseKey, mondayKeyOf, pad2 } from '../core/dates.js';

/* ---------- confirm ---------- */

/* Resolves true when the user confirms. Esc, the backdrop and Cancel resolve false. */
export function confirmDialog({ title, message, confirm = 'Delete', cancel = 'Cancel', danger = true }) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const done = ok => {
      wrap.classList.add('closing');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => wrap.remove(), 140);
      if (prev && prev.isConnected) prev.focus({ preventScroll: true });
      tick(ok ? 'ok' : 'tap');
      resolve(ok);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Tab') {   // keep focus inside the dialog
        const f = [noBtn, yesBtn];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      }
    };
    const noBtn = h('button.btn', { type: 'button', onclick: () => done(false) }, cancel);
    const yesBtn = h('button.btn' + (danger ? '.danger-solid' : '.primary'), { type: 'button', onclick: () => done(true) }, danger ? icon('trash') : null, confirm);
    const titleId = 'dlg-' + Math.random().toString(36).slice(2, 8);
    const wrap = h('div.dialog-wrap', { onmousedown: e => { if (e.target === wrap) done(false); } },
      h('div.dialog' + (danger ? '.danger' : ''), { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        h('h2', { id: titleId }, title),
        message ? h('p', message) : null,
        h('div.dialog-actions', noBtn, yesBtn)));
    document.body.append(wrap);
    document.addEventListener('keydown', onKey, true);
    noBtn.focus({ preventScroll: true });
  });
}

/* "Delete “Gym”?" with what happens next. Runs onYes only when confirmed. */
export async function confirmDelete(what, onYes, { kind = 'item', detail, confirm = 'Delete' } = {}) {
  const name = (what || '').length > 60 ? what.slice(0, 57) + '…' : what;
  const ok = await confirmDialog({
    title: name ? `Delete ${kind} “${name}”?` : `Delete this ${kind}?`,
    message: detail || 'This can’t be undone, and it disappears on all your devices.',
    confirm
  });
  if (ok) onYes();
  return ok;
}

/* ---------- popover base ---------- */
let openPop = null;
export function closePopover() { if (openPop) openPop.close(); }

function popover(anchor, content, { onClose, align = 'start', cls = '' } = {}) {
  closePopover();
  const pop = h('div.popover' + (cls ? '.' + cls : ''), { role: 'dialog' }, content);
  document.body.append(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, ph = pop.offsetHeight;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + ph > innerHeight - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6;   // flip up near the bottom
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, Math.min(top, innerHeight - ph - 8)) + 'px';
    pop.style.minWidth = Math.max(r.width, 0) + 'px';
  };
  place();
  const outside = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); anchor.isConnected && anchor.focus(); } };
  const watch = setInterval(() => { if (!anchor.isConnected) close(); }, 300);
  const onScroll = e => { if (!pop.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', onScroll, true);
  anchor.setAttribute('aria-expanded', 'true');
  function close() {
    if (!pop.isConnected) return;
    pop.remove();
    clearInterval(watch);
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', onScroll, true);
    anchor.setAttribute('aria-expanded', 'false');
    if (openPop && openPop.pop === pop) openPop = null;
    onClose && onClose();
  }
  openPop = { pop, close };
  return { pop, close, place };
}

/* ---------- dropdown ---------- */

/**
 * Custom select: dropdown({ options:[{value,label,color?,hint?}], value, onChange, label, cls, placeholder })
 * Arrow keys move, Enter picks, typing a letter jumps.
 */
export function dropdown({ options, value, onChange, label, cls = '', placeholder = 'Choose…', icon: iconName }) {
  const cur = options.find(o => o.value === value);
  const btn = h('button.dd' + (cls ? '.' + cls.split(' ').join('.') : ''), {
    type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label + (cur ? ': ' + cur.label : ''), title: label,
    style: cur && cur.color ? { '--c': cur.color } : null,
    onclick: e => { e.stopPropagation(); openPop && openPop.anchor === btn ? closePopover() : open(); },
    onkeydown: e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } }
  },
    cur && cur.color ? h('i.dd-dot') : null,
    iconName ? icon(iconName) : null,
    h('span.dd-label', cur ? cur.label : placeholder),
    icon('down', 'dd-chev'));
  function open() {
    tick('open');
    let i = Math.max(0, options.findIndex(o => o.value === value));
    const items = options.map((o, idx) => h('li', {
      role: 'option', 'aria-selected': String(o.value === value), dataset: { i: idx },
      style: o.color ? { '--c': o.color } : null,
      onmousemove: () => { i = idx; mark(); },
      onclick: () => pick(o)
    }, o.color ? h('i.dd-dot') : null, h('span.grow', o.label), o.hint ? h('span.dd-hint', o.hint) : null, o.value === value ? icon('check', 'dd-tick') : null));
    const list = h('ul.dd-list', { role: 'listbox', 'aria-label': label, tabindex: -1, onkeydown: e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); i = (i + 1) % options.length; mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); i = (i - 1 + options.length) % options.length; mark(); }
      else if (e.key === 'Home') { e.preventDefault(); i = 0; mark(); }
      else if (e.key === 'End') { e.preventDefault(); i = options.length - 1; mark(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[i]); }
      else if (e.key === 'Tab') p.close();
      else if (e.key.length === 1) {
        const n = options.findIndex((o, k) => k > i && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
        const m = n === -1 ? options.findIndex(o => o.label.toLowerCase().startsWith(e.key.toLowerCase())) : n;
        if (m !== -1) { i = m; mark(); }
      }
    } }, items);
    const mark = () => { items.forEach((li, k) => li.classList.toggle('active', k === i)); items[i] && items[i].scrollIntoView({ block: 'nearest' }); };
    const pick = o => { p.close(); btn.focus(); if (o.value !== value) { tick('ok'); onChange(o.value); } };
    const p = popover(btn, list, { cls: 'dd-pop' });
    openPop.anchor = btn;
    mark();
    list.focus({ preventScroll: true });
  }
  return btn;
}

/* ---------- date picker ---------- */

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
/* "Today", "Tomorrow", "Fri 10 Oct", "Mon 5 Jan 2027" */
export function friendlyDate(dk) {
  if (!dk) return '';
  const t = todayKey();
  if (dk === t) return 'Today';
  if (dk === keyOffset(t, 1)) return 'Tomorrow';
  if (dk === keyOffset(t, -1)) return 'Yesterday';
  const d = parseKey(dk);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/**
 * datePicker({ value: 'YYYY-MM-DD' | null, onChange(dk|null), label, placeholder, clearable })
 * A button with the friendly date; opens quick picks + a month calendar.
 */
export function datePicker({ value, onChange, label = 'Date', placeholder = 'Add date', clearable = true, cls = '' }) {
  const btn = h('button.dd.date' + (value ? '' : '.empty') + (cls ? '.' + cls.split(' ').join('.') : ''), {
    type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': label + ': ' + (value ? friendlyDate(value) : 'none'), title: label,
    onclick: e => { e.stopPropagation(); openPop && openPop.anchor === btn ? closePopover() : open(); }
  }, icon('calendar'), h('span.dd-label', value ? friendlyDate(value) : placeholder));
  function open() {
    tick('open');
    const t = todayKey();
    let month = parseKey(value || t); month.setDate(1);
    const choose = dk => { p.close(); btn.focus(); if (dk !== value) { tick('ok'); onChange(dk); } };
    const nextMon = keyOffset(mondayKeyOf(parseKey(t)), 7);
    const sat = keyOffset(mondayKeyOf(parseKey(t)), 5);
    const quick = [
      ['Today', t], ['Tomorrow', keyOffset(t, 1)],
      ...(sat > t ? [['This weekend', sat]] : []),
      ['Next week', nextMon], ['In 2 weeks', keyOffset(t, 14)]
    ];
    const grid = h('div.dp-grid', { role: 'grid' });
    const title = h('span.dp-title');
    const paint = () => {
      title.textContent = MONTH.format(month);
      grid.replaceChildren(...['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => h('span.dp-wd', d)));
      const first = mondayKeyOf(month);
      for (let k = 0; k < 42; k++) {
        const dk = keyOffset(first, k);
        const d = parseKey(dk);
        if (k === 35 && d.getMonth() !== month.getMonth()) break;   // 5 rows are enough this month
        grid.append(h('button.dp-day' + (d.getMonth() !== month.getMonth() ? '.out' : '') + (dk === t ? '.today' : '') + (dk === value ? '.sel' : ''), {
          type: 'button', 'aria-label': friendlyDate(dk), 'aria-pressed': String(dk === value), onclick: () => choose(dk)
        }, String(d.getDate())));
      }
      p && p.place();
    };
    const shift = n => { month.setMonth(month.getMonth() + n); paint(); };
    const body = h('div.dp',
      h('div.dp-quick', quick.map(([l, dk]) => h('button.dp-chip' + (dk === value ? '.sel' : ''), { type: 'button', onclick: () => choose(dk) },
        h('span', l), h('span.dp-chip-d', friendlyDate(dk) === l ? parseKey(dk).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : friendlyDate(dk))))),
      h('div.dp-head',
        h('button.btn.icon.sm.ghost', { type: 'button', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('left')),
        title,
        h('button.btn.icon.sm.ghost', { type: 'button', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('right'))),
      grid,
      clearable && value ? h('button.btn.sm.ghost.dp-clear', { type: 'button', onclick: () => choose(null) }, icon('x'), 'Remove date') : null);
    var p = popover(btn, body, { cls: 'dp-pop' });
    openPop.anchor = btn;
    paint();
    const sel = body.querySelector('.dp-day.sel') || body.querySelector('.dp-day.today');
    sel && sel.focus({ preventScroll: true });
  }
  return btn;
}

/* ---------- time picker: a dropdown of quarter hours (plus the current value if it is off-grid) ---------- */
export function timePicker({ value, onChange, label = 'Time', placeholder = 'Add time', from = 6, to = 24, step = 15, clearable = true }) {
  const opts = [];
  if (clearable) opts.push({ value: '', label: 'No time' });
  for (let m = from * 60; m < to * 60; m += step) opts.push({ value: pad2(Math.floor(m / 60)) + ':' + pad2(m % 60), label: pad2(Math.floor(m / 60)) + ':' + pad2(m % 60) });
  if (value && !opts.some(o => o.value === value)) { opts.push({ value, label: value }); opts.sort((a, b) => a.value.localeCompare(b.value)); }
  return dropdown({ options: opts, value: value || null, onChange: v => onChange(v || null), label, cls: 'time' + (value ? '' : ' empty'), placeholder, icon: 'clock' });
}
