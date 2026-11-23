// Workbench: what Kevin's computers are building, and everything that needs him, decided right here by tap, by words
// or by voice. Left: what needs you, the plans, the sessions. Right: each computer with its lanes and how well its lane
// time is used. The page knows no kinds of asks or cards: it draws the options and rows Workbench sends
// (docs/workbench-link.md), so a new feature of Workbench or orch shows up without a change here.
import { h } from '../core/dom.js';
import { fmt } from '../core/dates.js';
import { notify } from '../core/store.js';
import { panel } from '../components/panel.js';
import { viewHead, empty, chip } from '../components/ui.js';
import { confirmDialog } from '../components/overlay.js';
import { api, errorText } from '../core/api.js';
import { remote, refresh } from '../core/remote.js';
import { icon } from '../core/icons.js';
import { toast } from '../core/fx.js';
import { canRecord, startRecording, stopRecording, transcribe } from '../voice/stt.js';

const PATH = '/api/workbench/control';
const POLL_MS = 6000, AGE_MS = 60000;
export const WORKBENCH_URL = 'https://desktop-oe7cumo.tailb66bb7.ts.net';

export const workbenchData = () => remote('workbench', PATH, AGE_MS);
/* Times that tick with every report are no news. */
const TIMES = new Set(['at', 'seenAt', 'lastTickAt', 'lastActivityAt', 'trend']);
const shown = w => JSON.stringify(w, (k, v) => (TIMES.has(k) ? undefined : v));
const reload = () => refresh('workbench', PATH, { same: (a, b) => shown(a) === shown(b) });
const isOpen = d => !!d && (d.status === 'pending' || d.status === 'sent');
/** How many things wait for Kevin (the badge): asks he hasn't answered yet. */
export const workbenchNeeds = () => (((workbenchData().data || {}).items) || []).filter(i => i.level === 'ask' && !isOpen(i.decision)).length;

/* ---------- deciding ---------- */

const drafts = new Map();                    // item id → his words so far
const answering = new Set();                 // items whose answer field is open
const unfolded = new Set();                  // items whose whole text is shown
let recording = null;                        // {id, state: 'on' | 'busy'}
let busy = null;                             // item id a decision is being sent for

async function decide(item, option, text = null) {
  if (busy) return;
  if (option.confirm && !(await confirmDialog({ title: `${option.label}: ${item.title}`, message: option.confirm, confirm: option.label, danger: option.style === 'danger' }))) return;
  busy = item.id; notify();
  try {
    await api.post(`/api/workbench/items/${item.id}/decide`, { option: option.id, ...(text ? { text } : {}) });
    drafts.delete(item.id); answering.delete(item.id);
    toast('Sent to ' + item.machineName, 'pulse');
  } catch (e) { toast(errorText(e), 'flare'); }
  busy = null;
  reload();
}

/* Say it instead of typing it: the words land in the field, so Kevin reads them before they go. */
async function dictate(item) {
  if (recording && recording.id === item.id && recording.state === 'on') {
    recording = { id: item.id, state: 'busy' }; notify();
    try {
      const blob = await stopRecording();
      const said = blob ? (await transcribe(blob)).trim() : '';
      if (said) drafts.set(item.id, [drafts.get(item.id), said].filter(Boolean).join(' '));
      else toast('Didn’t catch that. Try again.', 'amber');
    } catch (e) { toast(e.message || 'Transcription failed', 'flare'); }
    recording = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // so the field shows the new words
    notify();
    return;
  }
  if (recording) return;
  try { await startRecording(); recording = { id: item.id, state: 'on' }; } catch { toast('Microphone permission denied.', 'flare'); }
  notify();
}

const DECISION = { pending: 'on its way', sent: 'being done', done: 'done', failed: 'not done', expired: 'not picked up', unknown: 'no answer, check in Workbench' };
const KIND = { 'plan-approval': 'plan', 'start-ok': 'start', gate: 'gate', 'pull-request': 'merge', 'task-blocked': 'stuck', proposal: 'session', subsession: 'sub-session',
  'session-waiting': 'session', 'session-error': 'error', 'orch-warning': 'warning', paused: 'paused' };
/* A kind this build doesn't know is named as it comes ("haupt-start" → "haupt start"). */
const kindName = k => KIND[k] || k.replace(/-/g, ' ');

function answerRow(item, option) {
  const live = recording && recording.id === item.id;
  const send = () => { const t = (drafts.get(item.id) || '').trim(); if (t) decide(item, option, t); };
  return h('div.wkb-answer',
    h('textarea.field', { rows: 2, 'aria-label': 'Answer ' + item.id, placeholder: 'Your answer', value: drafts.get(item.id) || '',
      oninput: e => drafts.set(item.id, e.target.value), onkeydown: e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.blur(); send(); } } }),
    h('div.input-row',
      h('button.btn.primary', { type: 'button', disabled: busy === item.id, onclick: send }, 'Send'),
      canRecord() ? h('button.btn' + (live && recording.state === 'on' ? '.live' : ''), { type: 'button', 'aria-pressed': String(!!live), disabled: !!recording && (!live || recording.state === 'busy'), onclick: () => dictate(item) },
        icon('mic'), live ? (recording.state === 'on' ? 'Stop' : 'Writing it down') : 'Say it') : null,
      h('button.btn.ghost', { type: 'button', onclick: () => { answering.delete(item.id); notify(); } }, 'Cancel')));
}

function itemCard(item) {
  const d = item.decision, sent = isOpen(d);
  const words = item.options.find(o => o.text === 'required');
  const long = item.detail.length > 220 || item.detail.includes('\n');
  const open = unfolded.has(item.id);
  return h('article.wkb-item', { dataset: { level: item.level, key: item.key } },
    h('div.wkb-item-head', chip(kindName(item.kind), item.level === 'ask' ? 'warn' : item.level === 'warn' ? 'alert' : null, item.level === 'info' ? 'plain' : ''),
      h('span.data.muted', [item.project, item.machineName].filter(Boolean).join(' · '))),
    h('h3', item.title),
    item.detail && item.detail !== item.title ? h('p.wkb-detail' + (open ? '.open' : ''), item.detail) : null,
    long ? h('button.wkb-more', { type: 'button', 'aria-expanded': String(open), onclick: () => { if (open) unfolded.delete(item.id); else unfolded.add(item.id); notify(); } }, open ? 'Less' : 'More') : null,
    d ? h('div.wkb-state', { dataset: { status: d.status } }, h('span', { class: 'status-dot ' + (sent ? 'running' : d.status === 'done' ? 'done' : 'error') }),
      h('span', `${d.label}: ${DECISION[d.status] || d.status}${d.message ? '. ' + d.message : ''}`)) : null,
    words && answering.has(item.id) && !sent ? answerRow(item, words) : null,
    sent || answering.has(item.id) ? null : h('div.wkb-options',
      item.options.map(o => h('button.btn' + (o.style === 'primary' ? '.primary' : o.style === 'danger' ? '.danger' : ''), { type: 'button', disabled: !item.online || busy === item.id,
        title: item.online ? null : item.machineName + ' is not connected right now',
        onclick: () => { if (o.text === 'required') { answering.add(item.id); notify(); } else decide(item, o); } }, o.text === 'required' ? icon('mic') : null, o.label)),
      item.href ? h('a.btn.ghost', { href: item.href, target: '_blank', rel: 'noopener' }, 'Look', icon('ext')) : null,
      !item.options.length ? h('span.hint', 'Decided in Workbench on ' + item.machineName + '.') : null));
}

function needs(w) {
  const asks = w.items.filter(i => i.level === 'ask'), rest = w.items.filter(i => i.level !== 'ask');
  return panel({ title: 'Needs you', readout: asks.length ? h('span', h('b', String(asks.length)), ' open') : 'nothing open' },
    asks.length ? h('div.wkb-items', asks.map(itemCard)) : h('div.wkb-clear', h('span.status-dot.done'), 'Everything runs. What needs you shows up here, and Lina tells you.'),
    rest.length ? h('div.wkb-items.quiet', rest.map(itemCard)) : null);
}

/* ---------- plans ---------- */

const pctOf = p => (p.total ? Math.round((p.done / p.total) * 100) : 0);
const bar = p => h('div.wkb-bar', { role: 'img', 'aria-label': `${p.done} of ${p.total} tasks done` },
  h('i.done', { style: { width: pctOf(p) + '%' } }),
  p.building ? h('i.building', { style: { width: Math.round((p.building / p.total) * 100) + '%' } }) : null,
  p.failed + p.waiting ? h('i.stuck', { style: { width: Math.round(((p.failed + p.waiting) / p.total) * 100) + '%' } }) : null);
const TASK_DOT = { running: 'running', built: 'running', proven: 'done', blocked: 'error', failed: 'error' };
const TASK_WORD = { running: 'building', built: 'proving', proven: 'pull request open' };

function planRow(p) {
  const rest = Math.max(0, p.total - p.done - p.building - p.waiting - p.failed);
  return h('article.wkb-plan',
    h('div.wkb-plan-head', h('b', p.id), h('span.grow', p.title), h('span.data', `${p.done}/${p.total}`)),
    bar(p),
    h('div.wkb-plan-sub', [p.state !== 'active' ? p.state : null, p.waiting ? p.waiting + ' waiting' : null, p.failed ? p.failed + ' failed' : null, rest ? rest + ' open' : null,
      p.proofsTotal ? `proofs ${p.proofsGreen}/${p.proofsTotal}` : null, p.waitsFor.length ? 'after ' + p.waitsFor.join(', ') : null].filter(Boolean).join(' · ')),
    p.active.length || p.ready.length ? h('div.wkb-tasks',
      p.active.map(t => h('div.wkb-task', h('span', { class: 'status-dot ' + (TASK_DOT[t.status] || 'idle') }), h('span.data', t.id), h('span.grow', t.title),
        h('span.muted', [TASK_WORD[t.status] || t.status, t.lane].filter(Boolean).join(' · ')),
        t.href ? h('a.wkb-pr', { href: t.href, target: '_blank', rel: 'noopener' }, t.pr ? 'PR ' + t.pr : 'PR') : null)),
      p.ready.slice(0, 3).map(id => h('div.wkb-task.next', h('span.status-dot.idle'), h('span.data', id), h('span.grow.muted', 'next')))) : null);
}

const PHASE = { done: 'done', running: 'running', planned: 'planned', next: 'next', idea: 'idea' };
function plans(w) {
  if (!w.plans.length && !w.hauptplaene.length) return panel({ title: 'Plans' }, empty('No open plans', w.orch && w.orch.error ? w.orch.error : 'Open plans of orch show up here.'));
  const open = w.plans.filter(p => p.state !== 'paused'), paused = w.plans.filter(p => p.state === 'paused');
  const inHaupt = new Map(w.hauptplaene.map(x => [x.id, open.filter(p => p.haupt === x.id)]));
  const loose = open.filter(p => !p.haupt || !inHaupt.has(p.haupt));
  const tasks = open.reduce((n, p) => n + Math.max(0, p.total - p.done), 0);
  return panel({ title: 'Plans', readout: h('span', h('b', String(tasks)), ' tasks open') },
    w.hauptplaene.filter(x => x.state === 'active' || (inHaupt.get(x.id) || []).length).map(x => h('section.wkb-haupt',
      h('header', h('b', x.id), h('span.grow', x.title), h('span.data.muted', `${x.phases.filter(p => p.status === 'done').length} of ${x.phases.length} phases`)),
      h('ol.wkb-phases', { 'aria-label': 'Phases of ' + x.id }, x.phases.map(p => h('li', { dataset: { status: PHASE[p.status] || 'idea' }, title: `${p.title} · ${p.status}${p.total ? ` · ${p.done}/${p.total}` : ''}` }, p.id))),
      (inHaupt.get(x.id) || []).map(planRow))),
    loose.map(planRow),
    paused.length ? h('p.hint', 'Paused: ' + paused.map(p => `${p.id} ${p.done}/${p.total}`).join(', ')) : null);
}

/* ---------- sessions ---------- */

const SESSION_DOT = { running: 'running', waiting: 'running', done: 'done', error: 'error' };
function sessions(w) {
  // lanes are on the right; here are the sessions Kevin started himself
  const list = w.sessions.filter(s => !s.task).slice(0, 8);
  if (!list.length) return null;
  return panel({ title: 'Sessions', readout: h('span', h('b', String(list.filter(s => s.status === 'running').length)), ' running') },
    h('div.rows', list.map(s => h('div.row', h('span', { class: 'status-dot ' + (SESSION_DOT[s.status] || 'idle') }),
      h('div.grow', h('div.title', s.title), h('div.sub', [s.project, s.machineName, s.status, s.lastActivityAt ? fmt.ago(s.lastActivityAt) : null].filter(Boolean).join(' · ')), s.summary ? h('div.wkb-said', s.summary) : null)))));
}

/* ---------- the computers, on the right ---------- */

const LOST = { none: 'nothing to do', kevin: 'waits for you', blocked: 'blocked', failed: 'failed', files: 'file clashes', needs: 'task order', start: 'starting', refused: 'start refused', limit: 'plan limit',
  paused: 'paused', rerun: 'done again', down: 'orch was down' };
const TONE = score => (score == null ? '' : score >= 70 ? 'good' : score >= 40 ? 'mid' : 'low');

function trendLine(points) {
  if (points.length < 2) return null;
  const W = 240, H = 34, x = i => (i / (points.length - 1)) * W, y = s => H - 2 - (s / 100) * (H - 4);
  const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.score).toFixed(1)).join('');
  return h('svg.wkb-trend', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Efficiency over the last day, now ${points[points.length - 1].score} percent` },
    h('path', { d: `${d}L${W},${H}L0,${H}Z`, class: 'area' }), h('path', { d, class: 'line' }));
}

function machine(m) {
  const l = m.lanes;
  const busyLanes = l ? l.lanes.filter(x => x.state !== 'idle') : [];
  const lost = l ? l.lost.filter(x => x.percent >= 3).slice(0, 3) : [];
  const disconnect = async () => {
    if (!(await confirmDialog({ title: `Disconnect ${m.name}?`, message: 'It stops reporting and you can no longer decide for it here. Connect it again with a new code.', confirm: 'Disconnect', danger: false }))) return;
    try { await api.del('/api/workbench/links/' + m.deviceId); toast(m.name + ' disconnected', 'ink-3'); } catch (e) { toast(errorText(e), 'flare'); }
    reload();
  };
  return panel({ title: m.name, readout: h('span.wkb-online', h('span', { class: 'status-dot ' + (m.online ? 'done' : 'idle') }),
      m.online ? (m.paused ? 'paused' : m.viaController && !m.deviceId ? 'via the controller' : 'online') : m.seenAt ? 'seen ' + fmt.ago(m.seenAt) : 'waiting for it'), cls: m.online ? 'wkb-machine' : 'wkb-machine off' },
    !l ? h('p.hint', m.seenAt ? 'No lanes on this computer.' : 'Paste the code in Workbench on this computer.') : [
      h('div.wkb-score',
        h('div.wkb-now', { dataset: { tone: TONE(l.now) } }, h('span.num', l.now == null ? '–' : String(l.now)), l.now == null ? null : h('span.unit', '%')),
        h('dl', h('div', h('dt', 'last hour'), h('dd', l.hour == null ? '–' : l.hour + ' %')), h('div', h('dt', 'last day'), h('dd', l.day == null ? '–' : l.day + ' %')))),
      trendLine(l.trend),
      h('div.wkb-lanes', { role: 'img', 'aria-label': `${l.working} of ${l.total} lanes busy` }, Array.from({ length: l.total }, (_, i) => h('i', { dataset: { state: i < busyLanes.length ? busyLanes[i].state : i < l.working ? 'work' : 'idle' } }))),
      h('div.wkb-lanes-sum', h('span', h('b', String(l.working)), ` of ${l.total} lanes busy`), m.sessions.waiting ? h('span.muted', m.sessions.waiting + ' waiting') : null),
      busyLanes.length ? h('ul.wkb-lane-list', busyLanes.map(x => h('li', { title: x.title || '' }, h('span.data', x.id.split('/').pop()), h('span.grow', h('b', x.task || x.project || ''), x.title ? ' ' + x.title : ''), x.state === 'proving' ? h('span.muted', 'proving') : null))) : null,
      lost.length ? h('p.wkb-lost', 'Idle time: ' + lost.map(x => `${LOST[x.kind] || x.kind} ${x.percent} %`).join(', ')) : null
    ],
    m.orchError ? h('p.hint', m.orchError) : null,
    m.deviceId ? h('button.wkb-more', { type: 'button', onclick: disconnect }, 'Disconnect') : null);
}

const cardPanel = c => panel({ title: c.title }, h('div.wkb-card', c.rows.map(r => h(r.href ? 'a.wkb-card-row' : 'div.wkb-card-row', { ...(r.href ? { href: r.href, target: '_blank', rel: 'noopener' } : {}), dataset: { tone: r.tone || '' } },
  h('span.grow', r.label), r.value ? h('span.data', r.value) : null, r.percent != null ? h('div.wkb-bar', h('i.done', { style: { width: r.percent + '%' } })) : null))));

function decisions(w) {
  const list = w.decisions.slice(0, 5);
  if (!list.length) return null;
  return panel({ title: 'Decided' }, h('div.rows', list.map(d => h('div.row', h('span', { class: 'status-dot ' + (d.status === 'done' ? 'done' : isOpen(d) ? 'running' : 'error') }),
    h('div.grow', h('div.title', d.title), h('div.sub', [d.label, DECISION[d.status], fmt.ago(d.finishedAt || d.createdAt)].filter(Boolean).join(' · ')), d.message ? h('div.sub', d.message) : null)))));
}

/* ---------- connecting a computer ---------- */

let pairing = null;                          // {name, code}
let pairOpen = false;
async function pair(name) {
  try { pairing = await api.post('/api/workbench/links', { name }); } catch (e) { toast(errorText(e), 'flare'); }
  notify(); reload();
}
async function copyCode() {
  try { await navigator.clipboard.writeText(pairing.code); toast('Code copied', 'pulse'); } catch { toast('Select the code and copy it.', 'amber'); }
}
function connectPanel() {
  const close = () => { pairOpen = false; pairing = null; notify(); };
  if (pairing) return panel({ title: 'Connect ' + pairing.name },
    h('p', `On ${pairing.name}: Workbench, Settings, Notifications, Agentic OS. Paste this code. It is shown once and works like a key.`),
    h('div.input-row', h('input.field.data', { readonly: true, value: pairing.code, 'aria-label': 'Pairing code', onfocus: e => e.target.select() }), h('button.btn.primary', { type: 'button', onclick: copyCode }, 'Copy'), h('button.btn.ghost', { type: 'button', onclick: close }, 'Done')));
  return panel({ title: 'Connect a computer' },
    h('p', 'Workbench on that computer then reports here and takes your answers. It connects out by itself, so nothing needs to be opened.'),
    h('div.input-row', ['PC', 'MacBook'].map(n => h('button.btn', { type: 'button', onclick: () => pair(n) }, n)),
      h('input.field', { placeholder: 'Other name', 'aria-label': 'Computer name', maxlength: 40, onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { const n = e.target.value; e.target.blur(); pair(n); } } }),
      h('button.btn.ghost', { type: 'button', onclick: close }, 'Cancel')));
}

let poll = 0, mounted = null;
export default {
  id: 'workbench',
  render(root) {
    const { data: w, connected, error } = workbenchData();
    const linked = w && w.linked;
    const total = linked ? w.machines.reduce((n, m) => n + (m.lanes ? m.lanes.total : 0), 0) : 0;
    const working = linked ? w.machines.reduce((n, m) => n + (m.lanes ? m.lanes.working : 0), 0) : 0;
    const sub = linked ? `${w.machines.filter(m => m.online).length} of ${w.machines.length} computers online · ${working} of ${total} lanes busy${w.orch && w.orch.paused ? ' · orch is paused' : ''}` : 'What your computers are building, and what needs you.';
    mounted = h('div.view.workbench',
      viewHead('Workbench', sub,
        connected ? h('button.btn.ghost', { type: 'button', onclick: () => { pairOpen = !pairOpen; notify(); } }, icon('plus'), 'Connect a computer') : null,
        h('a.btn.ghost', { href: WORKBENCH_URL, target: '_blank', rel: 'noopener', title: 'Needs Tailscale on this device' }, 'Open Workbench', icon('ext'))),
      pairOpen || pairing ? connectPanel() : null,
      !connected ? empty('Not connected', 'Pair this device in Settings to see Workbench here.')
        : !w ? empty(error ? 'Could not load Workbench' : 'Loading', error ? errorText(error) : null)
        : !linked ? (pairOpen || pairing ? null : empty('No computer connected yet', 'Connect your PC and your MacBook once. From then on Workbench asks you here.',
            h('button.btn.primary', { type: 'button', onclick: () => { pairOpen = true; notify(); } }, 'Connect a computer')))
        : h('div.wkb-grid',
            h('div.stack.wkb-main', needs(w), plans(w), sessions(w)),
            h('aside.stack.wkb-side', { 'aria-label': 'Computers' }, w.machines.map(machine), w.cards.map(cardPanel), decisions(w))));
    root.append(mounted);
    const tick = () => { if (mounted && mounted.isConnected && document.visibilityState === 'visible') reload(); };
    if (!poll) poll = setInterval(tick, POLL_MS);
  },
  unmount() {
    // the router unmounts before every re-render too: only stop once the page is really gone
    setTimeout(() => {
      if (mounted && mounted.isConnected) return;
      clearInterval(poll); poll = 0;
      if (recording && recording.state === 'on') { stopRecording(); recording = null; }
    }, 0);
  }
};
