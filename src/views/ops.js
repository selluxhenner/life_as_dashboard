// Server card on Home: the newest report of each agent-box job (morning digest, site check …).
// Reports come from the agent box through POST /api/ops/report; here we only read /api/ops/latest.
import { h } from '../core/dom.js';
import { panel } from '../components/panel.js';
import { chip, meter } from '../components/ui.js';
import { remote } from '../core/remote.js';
import { fmt } from '../core/dates.js';
import { icon } from '../core/icons.js';

const STALE_MS = 26 * 3600000;   // the digest runs daily; older than this means the box may be down
const TONE = { ok: 'ok', warn: 'warn', fail: 'alert' };
const LABEL = { ok: 'All good', warn: 'Warnings', fail: 'Problems' };
const COLOR = { ok: 'var(--pulse)', warn: 'var(--amber)', fail: 'var(--flare)' };
const jobName = job => job.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

export function opsData() {
  const r = remote('ops', '/api/ops/latest', 10 * 60000);
  return { reports: (r.data && r.data.reports) || [], connected: r.connected, error: r.error };
}

function metricsRow(m) {
  const disk = typeof m.disk_pct === 'number' ? m.disk_pct : null;
  const ram = typeof m.ram_avail_mb === 'number' ? m.ram_avail_mb : null;
  if (disk == null && ram == null) return null;
  return h('div.ops-metrics',
    disk != null ? h('div.ops-metric', h('div.k', 'Disk'), h('div.v.data', disk + ' %'), meter(disk, disk >= 90 ? COLOR.fail : disk >= 80 ? COLOR.warn : COLOR.ok)) : null,
    ram != null ? h('div.ops-metric', h('div.k', 'RAM free'), h('div.v.data', (ram >= 1024 ? (ram / 1024).toFixed(1) + ' GB' : ram + ' MB'))) : null);
}

export function serverPulse() {
  const { reports, connected, error } = opsData();
  if (!connected) return null;
  const title = h('span.launch-title', icon('server'), 'Server');
  if (!reports.length) {
    return panel({ title }, h('div.hint', error ? 'Could not load server reports.' : 'Reports from the agent box show up here after its next check.'));
  }
  const worst = reports[0].status;                    // the server sorts worst first
  const newest = Math.max(...reports.map(r => r.createdAt));
  const stale = Date.now() - newest > STALE_MS;
  const findings = reports.flatMap(r => r.findings.filter(f => f.level !== 'ok')).slice(0, 4);
  const digest = reports.find(r => r.job === 'morning-digest');
  return panel({ title, readout: h('span.ops-readout', chip(LABEL[worst], TONE[worst]), h('span.dim', fmt.ago(newest))) },
    stale ? h('div.hint.ops-stale', 'No report for over a day. Is the agent box running?') : null,
    h('div.rows', reports.slice(0, 3).map(r => h('div.row',
      h('div.grow', h('div.title', r.summary), h('div.sub', jobName(r.job) + ' · ' + fmt.ago(r.createdAt))),
      chip(r.status, TONE[r.status])))),
    findings.length ? h('ol.ops-findings', findings.map(f => h('li', { style: { '--c': COLOR[f.level] } }, f.text))) : null,
    digest ? metricsRow(digest.metrics) : null);
}
