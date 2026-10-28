// Plan: projects, the Kanban board, the capture inbox, what's open in Workbench, and the goals — one page.
// Cards are the same tasks as everywhere else (synced with status + project); captures are forwarded onto the
// board from the inbox; Workbench sessions come from the server (GET /api/workbench/sessions).
import { h } from '../core/dom.js';
import { state, save } from '../core/store.js';
import { uid, pct, fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, check, removeBtn, addRow, meter, empty, seg, chip } from '../components/ui.js';
import { dropdown, friendlyDate } from '../components/overlay.js';
import { icon } from '../core/icons.js';
import { tick, toast } from '../core/fx.js';
import { render } from '../core/router.js';
import { remote } from '../core/remote.js';
import { TIERS, addTask, deleteTask, liveTasks, updateTask } from '../core/model.js';
import { goalTicks, goalProgress, toggleGoalStep, setGoalDone } from '../core/goals.js';
import {
  STATUSES, KINDS, projects, projectOf, addProject, statusOf, moveTask, boardTasks, columns, projectSummary,
  projectForSession, captureInbox, forwardCapture
} from '../core/board.js';

// Workbench on the home PC, reachable inside the tailnet only
const WORKBENCH_URL = 'https://kev-pc.tailb66bb7.ts.net';
const KIND_COLOR = { private: 'var(--tone-samerica)', next: 'var(--amber)', project: 'var(--signal)' };
const PRIO_COLOR = { high: 'var(--flare)', med: 'var(--amber)', low: 'var(--ink-3)' };

let kind = 'all';
let project = '';
let dragId = null;
const inboxPick = new Map();   // capture id -> project chosen in the inbox

const workbench = () => remote('workbench', '/api/workbench/sessions', 60000);
const projectOptions = (withNone = true) => [
  ...(withNone ? [{ value: '', label: 'No project', color: 'var(--ink-3)' }] : []),
  ...projects().map(p => ({ value: p.id, label: p.name, color: KIND_COLOR[p.kind] }))
];

/* ---------- projects strip ---------- */
function projectStrip(sessions) {
  const live = new Map();
  for (const s of sessions) { const id = projectForSession(s); if (id) live.set(id, (live.get(id) || 0) + 1); }
  const list = projects().filter(p => kind === 'all' || p.kind === kind)
    .map(p => ({ p, n: projectSummary(p.id), wb: live.get(p.id) || 0 }))
    .filter(x => x.n.open || x.wb || x.n.doneWeek || x.p.id === project);
  const card = ({ p, n, wb }) => h('button.plan-proj' + (p.id === project ? '.on' : ''), {
    type: 'button', style: { '--c': KIND_COLOR[p.kind] }, 'aria-pressed': String(p.id === project),
    title: p.id === project ? 'Show every project' : 'Only ' + p.name,
    onclick: () => { project = project === p.id ? '' : p.id; tick(); render(); }
  },
    h('span.plan-proj-name', p.name),
    h('span.plan-proj-meta.data', [n.open + ' open', n.doing ? n.doing + ' doing' : null, n.doneWeek ? n.doneWeek + ' done this week' : null].filter(Boolean).join(' · ')),
    wb ? h('span.plan-proj-wb', icon('agent'), wb + ' in Workbench') : null);
  const add = h('input.field.sm.plan-proj-add', {
    placeholder: '+ Project', 'aria-label': 'New project',
    onkeydown: e => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      const p = addProject(e.target.value, kind === 'all' ? 'project' : kind);
      if (p) { project = p.id; toast('Project ' + p.name + ' added', 'pulse'); render(); }
    }
  });
  return h('div.plan-projects', list.map(card), list.length ? null : h('span.hint', 'No open work here yet.'), add);
}

/* ---------- board ---------- */
function cardEl(t) {
  const p = t.project ? projectOf(t.project) : null;
  const s = statusOf(t);
  const at = STATUSES.findIndex(x => x.key === s);
  const step = d => { const n = STATUSES[at + d]; if (n) { tick(n.key === 'done' ? 'ok' : 'tap'); moveTask(t, n.key); } };
  return h('article.kb-card' + (s === 'done' ? '.done' : ''), {
    draggable: 'true', dataset: { id: t.id }, style: { '--c': p ? KIND_COLOR[p.kind] : 'var(--ink-3)' },
    ondragstart: e => { dragId = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); e.currentTarget.classList.add('dragging'); },
    ondragend: e => { dragId = null; e.currentTarget.classList.remove('dragging'); }
  },
    h('div.kb-card-title', t.title),
    h('div.kb-card-meta',
      p ? h('span.kb-tag', p.name) : null,
      t.priority === 'high' ? h('span.kb-prio', { style: { '--c': PRIO_COLOR.high } }, 'high') : null,
      t.due ? h('span.data', 'due ' + friendlyDate(t.due)) : null,
      t.source === 'capture' ? h('span.kb-src', { title: 'From a capture' }, icon('inbox')) : null),
    h('div.kb-card-actions',
      h('button.btn.icon.sm.ghost', { type: 'button', 'aria-label': 'Move left', title: at ? 'Move to ' + STATUSES[at - 1].label : '', disabled: !at, onclick: () => step(-1) }, '‹'),
      h('button.btn.icon.sm.ghost', { type: 'button', 'aria-label': 'Move right', title: STATUSES[at + 1] ? 'Move to ' + STATUSES[at + 1].label : '', disabled: at === STATUSES.length - 1, onclick: () => step(1) }, '›'),
      dropdown({ options: projectOptions(), value: t.project || '', onChange: v => updateTask(t, { project: v || null }), label: 'Project of ' + t.title, cls: 'sm kb-proj-dd' }),
      removeBtn(() => deleteTask(t), 'Delete card', { what: t.title })));
}

function board() {
  const tasks = boardTasks({ kind, project });
  const cols = columns(tasks);
  const defaultProject = project || (kind === 'private' ? 'private' : kind === 'next' ? 'nextup' : null);
  const col = st => h('section.kb-col', {
    dataset: { status: st.key }, 'aria-label': st.label,
    ondragover: e => { if (dragId) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
    ondragleave: e => e.currentTarget.classList.remove('over'),
    ondrop: e => {
      e.preventDefault(); e.currentTarget.classList.remove('over');
      const t = liveTasks().find(x => x.id === (dragId || e.dataTransfer.getData('text/plain')));
      if (t) { tick(st.key === 'done' ? 'ok' : 'tap'); moveTask(t, st.key); }
    }
  },
    h('header.kb-col-h', h('span', st.label), h('span.data', String(cols[st.key].length))),
    h('div.kb-cards', cols[st.key].length ? cols[st.key].slice(0, st.key === 'done' ? 12 : 60).map(cardEl) : h('div.kb-empty', 'Drop here')),
    st.key === 'backlog' || st.key === 'todo'
      ? addRow({ placeholder: 'Add a card', label: 'New card in ' + st.label, onSubmit: v => { addTask(v, 'med', { status: st.key, project: defaultProject }); tick('ok'); } })
      : null);
  const scope = project ? projectOf(project)?.name || project : KINDS.find(k => k.value === kind).label;
  return panel({ title: 'Board', cls: 'plan-board', readout: h('span', h('b', String(tasks.filter(t => statusOf(t) !== 'done').length)), ' open · ' + scope) },
    h('div.kb', STATUSES.map(col)));
}

/* ---------- capture inbox ---------- */
function guessProject(text) {
  const t = text.toLowerCase();
  const hit = projects().find(p => p.id !== 'private' && (t.includes(p.name.toLowerCase()) || t.includes(p.id)));
  return hit ? hit.id : project || 'private';
}
function inbox() {
  const list = captureInbox().sort((a, b) => b.createdAt - a.createdAt);
  const row = c => {
    const pick = inboxPick.get(c.id) ?? guessProject(c.text);
    return h('div.plan-inbox-row',
      h('div.grow', h('div.title', c.text), h('div.sub', fmt.ago(c.createdAt), c.type === 'task' ? ' · task without project' : '', c.date ? ' · ' + friendlyDate(c.date) : '')),
      h('div.plan-inbox-actions',
        dropdown({ options: projectOptions(false), value: pick, onChange: v => { inboxPick.set(c.id, v); render(); }, label: 'Project for ' + c.text, cls: 'sm' }),
        h('button.btn.sm', { type: 'button', title: 'Put it on the board under To do', onclick: () => {
          const t = forwardCapture(c, pick, 'todo');
          inboxPick.delete(c.id);
          if (t) { tick('ok'); toast('On the board · ' + (projectOf(pick)?.name || pick), 'pulse'); }
        } }, 'To board', icon('ext'))));
  };
  return panel({ title: 'From captures', cls: 'plan-inbox', readout: h('span', h('b', String(list.length)), ' to place') },
    list.length ? h('div.plan-inbox-list', list.slice(0, 20).map(row))
      : empty('Inbox clear', 'Unsorted captures and tasks without a project show up here, ready to forward to a project.'),
    list.length > 20 ? h('a.hint', { href: '#/captures' }, `${list.length - 20} more in Captures`) : null);
}

/* ---------- workbench ---------- */
function workbenchPanel(wb) {
  const d = wb.data;
  const sessions = (d && d.sessions) || [];
  const head = { title: 'In Workbench', cls: 'plan-wb', readout: sessions.length ? h('span', h('b', String(sessions.length)), ' open') : '',
    actions: [h('a.btn.sm.ghost', { href: WORKBENCH_URL, target: '_blank', rel: 'noopener', title: 'Needs Tailscale on this device' }, 'Open', icon('ext'))] };
  if (!wb.connected) return panel(head, empty('Not connected', 'Pair this device in Settings to see your Workbench sessions.'));
  if (d && !d.configured) return panel(head, empty('Workbench not linked', 'Set WORKBENCH_URL and WORKBENCH_TOKEN (a wbk_ agent token) on the server.'));
  const row = s => {
    const pid = projectForSession(s);
    const p = pid ? projectOf(pid) : null;
    return h('button.plan-wb-row', { type: 'button', title: p ? 'Show ' + p.name + ' on the board' : s.project,
      onclick: () => { if (pid) { project = pid; kind = 'all'; render(); } } },
      h('span', { class: 'status-dot ' + (s.status === 'running' || s.status === 'active' ? 'done' : 'idle') }),
      h('div.grow',
        h('div.title', s.title || s.branch || 'Session'),
        h('div.sub', [p ? p.name : s.project, s.branch, s.dirtyFiles ? s.dirtyFiles + ' changed' : null, s.unpushed ? 'not pushed' : null,
          s.lastActivityAt ? fmt.ago(typeof s.lastActivityAt === 'number' ? s.lastActivityAt : Date.parse(s.lastActivityAt)) : null].filter(Boolean).join(' · '))),
      s.status ? chip(s.status, s.status === 'running' || s.status === 'active' ? 'ok' : null) : null);
  };
  return panel(head,
    d && !d.reachable ? h('div.hint', 'Workbench is not answering' + (d.error ? ` (${d.error})` : '') + '. Last known sessions:') : null,
    sessions.length ? h('div.plan-wb-list', sessions.map(row)) : empty('Nothing open', 'Sessions you start in Workbench show up here with their branch.'));
}

/* ---------- goals ---------- */
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

function goals() {
  return TIERS.map((tier, i) => {
    const arr = state.ziele[tier.key];
    const done = arr.filter(g => g.done).length;
    const stepsAll = arr.reduce((n, g) => n + goalTicks(g).length, 0), stepsDone = arr.reduce((n, g) => n + goalProgress(g), 0);
    return panel({ title: tier.label, readout: h('span', h('b', `${done}/${arr.length}`)) },
      meter(pct(stepsDone, stepsAll), ['var(--signal)', 'var(--tone-namerica)', 'var(--tone-oceania)'][i]),
      h('div.rows', { style: { marginTop: '12px' } },
        arr.length ? arr.map(g => {
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
}

export default {
  id: 'goals',
  render(root) {
    const wb = workbench();
    const sessions = (wb.data && wb.data.sessions) || [];
    const filters = h('div.plan-filters',
      seg(KINDS, kind, v => { kind = v; project = ''; render(); }, 'Show'),
      project ? h('button.btn.sm.ghost', { type: 'button', onclick: () => { project = ''; render(); } }, (projectOf(project)?.name || project) + ' ✕') : null);
    root.append(h('div.view.plan',
      viewHead('Plan', 'Projects, tasks and goals in one place. Captures wait in the inbox until you forward them to a project.', filters),
      projectStrip(sessions),
      h('div.plan-main',
        board(),
        h('div.stack', inbox(), workbenchPanel(wb))),
      h('h2.plan-section.micro', 'Goals'),
      h('div.grid.g-3', goals())));
  }
};
