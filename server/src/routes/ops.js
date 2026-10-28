// Ops reports from the agent box (Hermes on its own server): morning digest, site check …
// The box posts with an ops-scope token (POST /api/ops/report, mounted before the full-auth routes in app.js);
// the apps read them with their normal device token. Report text is untrusted data from another machine.
import { Hono } from 'hono';
import { z } from 'zod';
import { db, j } from '../db.js';
import { HttpError } from '../http.js';
import { notify, alertedRecently } from '../notify/index.js';
import { localDate } from '../lib/time.js';

const MAX_BYTES = 32 * 1024;
export const OPS_STATUS = ['ok', 'warn', 'fail'];

const ReportSchema = z.object({
  job: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, 'job: lowercase letters, digits and dashes'),
  status: z.enum(OPS_STATUS),
  summary: z.string().trim().min(1).max(200),
  findings: z.array(z.object({ level: z.enum(OPS_STATUS), text: z.string().trim().min(1).max(300) })).max(20).default([]),
  metrics: z.record(z.string().regex(/^[a-z0-9_.-]{1,40}$/), z.union([z.number().finite(), z.string().max(60), z.null()]))
    .refine(m => Object.keys(m).length <= 40, 'at most 40 metrics').default({})
});

const row = r => r && { id: r.id, job: r.job, status: r.status, summary: r.summary, findings: j.parse(r.findings, []), metrics: j.parse(r.metrics, {}), createdAt: r.created_at };

/** The newest report of each job from the last `days` days, worst status first. */
export function latestOps({ days = 7 } = {}) {
  const rows = db.all(`SELECT * FROM ops_reports r WHERE created_at > ? AND id = (SELECT MAX(id) FROM ops_reports WHERE job = r.job)`,
    Date.now() - days * 86400000).map(row);
  const rank = s => OPS_STATUS.indexOf(s);
  return rows.sort((a, b) => rank(b.status) - rank(a.status) || b.createdAt - a.createdAt);
}

export function saveReport(source, input) {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 300));
  const r = parsed.data;
  const id = Number(db.run('INSERT INTO ops_reports (source, job, status, summary, findings, metrics, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    source, r.job, r.status, r.summary, j.str(r.findings), j.str(r.metrics), Date.now()).lastInsertRowid);
  return { id, ...r };
}

/* POST /api/ops/report: needs requireOps in front (see app.js). */
export async function postReport(c) {
  const raw = await c.req.text();
  if (raw.length > MAX_BYTES) throw new HttpError(413, 'Report too large');
  let input; try { input = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
  const r = saveReport(c.get('user').deviceId, input);
  // One alert per job, day and status: a second "fail" the same day stays quiet, a worse status still alerts.
  const ref = `ops:${r.job}:${localDate()}:${r.status}`;
  if (r.status !== 'ok' && !alertedRecently(ref, 86400000)) {
    const top = r.findings.filter(f => f.level !== 'ok').slice(0, 2).map(f => f.text).join(' · ');
    await notify({ title: 'Server · ' + r.summary, body: top || r.summary, url: '#/home', priority: r.status === 'fail' ? 4 : 3,
      tags: ['server'], kind: 'ops', ref }).catch(e => console.error('ops: notify', e.message));
  }
  return c.json({ id: r.id }, 201);
}

/* Read side for the apps (full-scope token). */
export const ops = new Hono();
ops.get('/ops/latest', c => c.json({ reports: latestOps() }));
ops.get('/ops/reports', c => {
  const job = c.req.query('job');
  const limit = Math.min(90, Math.max(1, Number(c.req.query('limit')) || 14));
  const rows = job ? db.all('SELECT * FROM ops_reports WHERE job = ? ORDER BY id DESC LIMIT ?', job, limit)
    : db.all('SELECT * FROM ops_reports ORDER BY id DESC LIMIT ?', limit);
  return c.json({ reports: rows.map(row) });
});
