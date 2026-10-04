// Garmin metrics: Body Battery, sleep, HRV, resting HR, stress, steps, training readiness.
// One record per day in state.health.days. Values come from the server (GET /api/health/garmin,
// once the Garmin connector runs there) or are logged by hand from the Garmin Connect app.
import { h } from '../../core/dom.js';
import { state, save } from '../../core/store.js';
import { todayKey, keyOffset, fmt } from '../../core/dates.js';
import { apiConfig, api } from '../../core/api.js';
import { panel } from '../../components/panel.js';

/* Status bands follow Garmin's own wording. `better`: which direction is good. */
export const METRICS = [
  { key: 'bodyBattery', label: 'Body Battery', short: 'Battery', unit: '', min: 0, max: 100, better: 'up',
    band: v => v >= 76 ? ['High', 'ok'] : v >= 51 ? ['Medium', 'signal'] : v >= 26 ? ['Low', 'warn'] : ['Very low', 'alert'] },
  { key: 'sleepScore', label: 'Sleep score', short: 'Sleep', unit: '', min: 0, max: 100, better: 'up',
    band: v => v >= 90 ? ['Excellent', 'ok'] : v >= 80 ? ['Good', 'ok'] : v >= 60 ? ['Fair', 'warn'] : ['Poor', 'alert'] },
  { key: 'sleepHours', label: 'Sleep duration', short: 'Slept', unit: 'h', min: 0, max: 14, step: 0.1, better: 'up',
    band: v => v >= 7 ? ['On target', 'ok'] : v >= 6 ? ['Short', 'warn'] : ['Too short', 'alert'] },
  { key: 'hrv', label: 'HRV · overnight', short: 'HRV', unit: 'ms', min: 0, max: 250, better: 'up', baseline: true },
  { key: 'restingHr', label: 'Resting HR', short: 'RHR', unit: 'bpm', min: 25, max: 120, better: 'down', baseline: true },
  { key: 'stress', label: 'Avg stress', short: 'Stress', unit: '', min: 0, max: 100, better: 'down',
    band: v => v <= 25 ? ['Rest', 'ok'] : v <= 50 ? ['Low', 'ok'] : v <= 75 ? ['Medium', 'warn'] : ['High', 'alert'] },
  { key: 'steps', label: 'Steps', short: 'Steps', unit: '', min: 0, max: 100000, better: 'up', goal: 10000,
    band: v => v >= 10000 ? ['Goal hit', 'ok'] : v >= 6000 ? [Math.round(v / 100) + '% of goal', 'signal'] : [Math.round(v / 100) + '% of goal', 'warn'] },
  { key: 'readiness', label: 'Training readiness', short: 'Ready', unit: '', min: 0, max: 100, better: 'up',
    band: v => v >= 95 ? ['Prime', 'ok'] : v >= 75 ? ['High', 'ok'] : v >= 50 ? ['Moderate', 'signal'] : v >= 25 ? ['Low', 'warn'] : ['Poor', 'alert'] }
];
const byKey = Object.fromEntries(METRICS.map(m => [m.key, m]));
const has = v => v !== null && v !== undefined && v !== '' && !isNaN(v);

export const healthDay = (dk = todayKey()) => state.health.days[dk] || null;
export function setMetric(dk, key, value) {
  const d = state.health.days[dk] = state.health.days[dk] || {};
  if (has(value)) d[key] = +value; else delete d[key];
  if (!Object.keys(d).length) delete state.health.days[dk];
  save();
}

export function series(key, n = 14, end = todayKey()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = state.health.days[keyOffset(end, -i)]; out.push(d && has(d[key]) ? d[key] : null); }
  return out;
}
/* Latest value within the last 2 days (sleep is logged on the morning after, steps fill during the day). */
export function latest(key) {
  for (let i = 0; i < 2; i++) { const dk = keyOffset(todayKey(), -i); const d = state.health.days[dk]; if (d && has(d[key])) return { value: d[key], dk }; }
  return null;
}
function baseline(key, before = todayKey()) {
  const vals = series(key, 7, keyOffset(before, -1)).filter(has);
  return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/* Status for one metric: [label, tone]. Baseline metrics (HRV, RHR) compare against the 7-day average like Garmin's HRV status. */
export function status(m, v, dk) {
  if (!has(v)) return ['no data', 'plain'];
  if (m.band) return m.band(v);
  const b = baseline(m.key, dk);
  if (b == null) return ['building baseline', 'plain'];
  const diff = (v - b) / b;
  const good = m.better === 'up' ? diff : -diff;
  if (Math.abs(diff) < 0.06) return ['Balanced', 'ok'];
  return good > 0 ? ['Above baseline', 'ok'] : ['Below baseline', 'warn'];
}

/* A single readiness-style number for the day, used in the strip header. */
export function recoveryScore() {
  const parts = [];
  const bb = latest('bodyBattery'), sl = latest('sleepScore'), rd = latest('readiness'), st = latest('stress');
  if (rd) return { value: Math.round(rd.value), from: 'Training readiness' };
  if (bb) parts.push(bb.value);
  if (sl) parts.push(sl.value);
  if (st) parts.push(100 - st.value);
  return parts.length ? { value: Math.round(parts.reduce((a, b) => a + b, 0) / parts.length), from: 'Battery · sleep · stress' } : null;
}

/* ---------- server pull ---------- */
let unsupported = false;
export async function pullGarmin() {
  if (!apiConfig() || unsupported) return;
  try {
    const r = await api.get('/api/health/garmin?days=14');
    if (!r || !r.days) return;
    for (const [dk, vals] of Object.entries(r.days)) {
      const d = state.health.days[dk] = state.health.days[dk] || {};
      for (const m of METRICS) if (has(vals[m.key])) d[m.key] = +vals[m.key];
    }
    state.health.source = 'garmin';
    state.health.lastSync = Date.now();
    save();
  } catch (e) {
    if (e && e.kind === 'server' && /404/.test(e.msg || '')) unsupported = true;   // server has no Garmin connector yet
  }
}
export function initHealth() {
  pullGarmin();
  setInterval(() => { if (!document.hidden) pullGarmin(); }, 30 * 60000);
}

/* ---------- UI ---------- */
function spark(values, color) {
  const pts = values.map((v, i) => [i, v]).filter(p => has(p[1]));
  const W = 100, H = 24;
  if (pts.length < 2) return h('svg.spark', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, h('line', { x1: 0, y1: H - 1, x2: W, y2: H - 1, class: 'spark-base' }));
  const vs = pts.map(p => p[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = i => i / (values.length - 1) * W, y = v => H - 2 - (v - lo) / span * (H - 4);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join('');
  return h('svg.spark', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', style: { '--c': color } },
    h('path', { d: d + `L${x(pts[pts.length - 1][0]).toFixed(1)} ${H}L${x(pts[0][0]).toFixed(1)} ${H}Z`, class: 'spark-fill' }),
    h('path', { d, class: 'spark-line' }));
}

const fmtVal = (m, v) => !has(v) ? '—' : m.key === 'steps' ? Math.round(v).toLocaleString('en-GB') : m.step ? (+v).toFixed(1) : String(Math.round(v));
const TONE_COLOR = { ok: 'var(--pulse)', signal: 'var(--signal)', warn: 'var(--amber)', alert: 'var(--flare)', plain: 'var(--ink-3)' };

function batteryRing(v) {
  const r = 26, c = 2 * Math.PI * r, p = has(v) ? Math.max(0, Math.min(100, v)) / 100 : 0;
  const tone = has(v) ? byKey.bodyBattery.band(v)[1] : 'plain';
  return h('svg.bb-ring', { viewBox: '0 0 64 64', 'aria-hidden': 'true', style: { '--c': TONE_COLOR[tone] } },
    h('circle', { cx: 32, cy: 32, r, class: 'bb-track' }),
    h('circle', { cx: 32, cy: 32, r, class: 'bb-fill', 'stroke-dasharray': `${(c * p).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 32 32)' }));
}

function tile(m) {
  const l = latest(m.key);
  const v = l ? l.value : null;
  const [label, tone] = status(m, v, l ? l.dk : todayKey());
  const stale = l && l.dk !== todayKey();
  return h('div.vital' + (m.key === 'bodyBattery' ? '.big' : ''), { style: { '--c': TONE_COLOR[tone] }, title: m.label + (stale ? ' · from ' + fmt.short(l.dk) : '') },
    m.key === 'bodyBattery' ? batteryRing(v) : null,
    h('div.vital-k', m.short),
    h('div.vital-v.data', fmtVal(m, v), m.unit && has(v) ? h('small', m.unit) : null),
    h('div.vital-s', label),
    m.key === 'bodyBattery' ? null : spark(series(m.key), TONE_COLOR[tone]));
}

let editing = false;
function editor(dk) {
  const d = healthDay(dk) || {};
  return h('div.vital-editor',
    h('div.micro', 'Log ' + (dk === todayKey() ? 'today' : fmt.short(dk)) + ' · numbers from the Garmin Connect app'),
    h('div.vital-fields', METRICS.map(m => h('label.vf',
      h('span', m.label + (m.unit ? ` (${m.unit})` : '')),
      h('input.field.sm', { type: 'number', inputmode: 'decimal', min: m.min, max: m.max, step: m.step || 1, value: has(d[m.key]) ? d[m.key] : '', placeholder: '—', 'aria-label': 'Garmin ' + m.label,
        onchange: e => setMetric(dk, m.key, e.target.value === '' ? null : parseFloat(e.target.value)) })))),
    h('div.input-row', { style: { marginTop: '10px', justifyContent: 'flex-end' } },
      h('button.btn.sm', { type: 'button', onclick: () => { editing = false; save(); } }, 'Done')));
}

/* Compact strip for Home: every metric visible at once. */
export function vitalsStrip() {
  const rec = recoveryScore();
  const src = state.health.source === 'garmin' && state.health.lastSync ? 'Garmin · ' + fmt.ago(state.health.lastSync) : 'Garmin · logged by hand';
  return panel({
    title: 'Body · Garmin', cls: 'vitals-panel',
    readout: rec ? h('span', 'recovery ', h('b', String(rec.value))) : src,
    actions: [h('button.btn.sm.ghost', { type: 'button', 'aria-expanded': String(editing), onclick: () => { editing = !editing; save(); } }, editing ? 'Close' : 'Log')]
  },
  h('div.vitals', METRICS.filter(m => m.key !== 'sleepHours').map(tile)),
  editing ? editor(todayKey()) : null);
}

/* Fuller panel for Today: tiles plus a 14-day table of the key numbers. */
export function garminPanel() {
  const days = []; for (let i = 6; i >= 0; i--) days.push(keyOffset(todayKey(), -i));
  const keys = ['bodyBattery', 'sleepScore', 'sleepHours', 'hrv', 'restingHr', 'stress', 'steps'];
  return panel({
    title: 'Garmin', cls: 'garmin-panel', readout: state.health.source === 'garmin' ? 'synced ' + fmt.ago(state.health.lastSync) : 'manual',
    actions: [h('button.btn.sm.ghost', { type: 'button', onclick: () => { editing = !editing; save(); } }, editing ? 'Close' : 'Log today')]
  },
  h('div.vitals', METRICS.map(tile)),
  editing ? editor(todayKey()) : null,
  h('div.vital-week', { role: 'table', 'aria-label': 'Garmin last 7 days' },
    h('div.vw-row.vw-head', { role: 'row' }, h('span', ''), days.map(dk => h('span.data', { role: 'columnheader' }, fmt.weekday(dk)))),
    keys.map(k => h('div.vw-row', { role: 'row' }, h('span', byKey[k].short),
      days.map(dk => { const d = healthDay(dk); const v = d ? d[k] : null; const [, tone] = status(byKey[k], v, dk); return h('span.data', { style: { '--c': TONE_COLOR[tone] }, class: has(v) ? 'has' : '' }, fmtVal(byKey[k], v)); })))),
  !Object.keys(state.health.days).length ? h('div.hint', 'No Garmin data yet. Tap “Log today” and copy the numbers from the Garmin Connect app; the server connector will fill them in automatically once it is set up.') : null,
  h('div.hint', 'Bands follow Garmin’s own ranges. HRV and resting HR are compared to your 7-day baseline.'));
}
