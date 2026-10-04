// Job hunt entries, synced like todos (rev cursor, last write wins). The app owns the shape; the server stores JSON.
import { Hono } from 'hono';
import { db, j } from '../db.js';
import { HttpError, body } from '../http.js';
import { uid } from '../lib/crypto.js';

const STATUS = ['saved', 'applied', 'interview', 'offer', 'rejected'];
const TYPES = ['werkstudent', 'part-time', 'startup', 'minijob', 'other'];

const bumpRev = () => { db.run("UPDATE meta SET value = value + 1 WHERE key = 'rev'"); return db.get("SELECT value FROM meta WHERE key = 'rev'").value; };

function clean(job) {
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !/^[\w-]{1,64}$/.test(job.id)) throw new HttpError(400, 'Job needs a valid id');
  const out = {};
  for (const k of ['company', 'role', 'location', 'salary', 'link', 'contact', 'appliedAt', 'nextAction', 'nextActionDate', 'notes', 'source'])
    out[k] = typeof job[k] === 'string' ? job[k].slice(0, k === 'notes' ? 5000 : 500) : '';
  out.id = job.id;
  out.type = TYPES.includes(job.type) ? job.type : 'other';
  out.status = STATUS.includes(job.status) ? job.status : 'saved';
  out.hoursPerWeek = typeof job.hoursPerWeek === 'number' ? job.hoursPerWeek : null;
  out.archived = !!job.archived;
  out.deleted = !!job.deleted;
  out.createdAt = Number(job.createdAt) || Date.now();
  out.updatedAt = Number(job.updatedAt) || Date.now();
  return out;
}

function upsert(job, rev) {
  db.run(`INSERT INTO jobs (id, data, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, rev = excluded.rev
          WHERE excluded.updated_at > jobs.updated_at`, job.id, j.str(job), job.updatedAt, job.deleted, rev);
}

export function listJobs({ includeArchived = false } = {}) {
  return db.all('SELECT data FROM jobs WHERE deleted = 0').map(r => j.parse(r.data)).filter(x => includeArchived || !x.archived);
}
export function saveJob(fields) {
  const now = Date.now();
  const existing = fields.id ? db.get('SELECT data FROM jobs WHERE id = ?', fields.id) : null;
  const base = existing ? j.parse(existing.data) : { id: uid('job_'), createdAt: now, source: 'agent', location: 'Berlin' };
  const job = clean({ ...base, ...fields, updatedAt: Math.max(now, (base.updatedAt || 0) + 1) });
  db.tx(() => upsert(job, bumpRev()));
  return job;
}

export const jobs = new Hono();
jobs.get('/jobs', c => c.json({ jobs: listJobs({ includeArchived: c.req.query('archived') === '1' }) }));
jobs.post('/jobs/sync', async c => {
  const b = await body(c);
  const since = Number(b?.since || 0);
  const ups = Array.isArray(b?.upserts) ? b.upserts.slice(0, 200) : [];
  const list = ups.map(clean);
  if (list.length) db.tx(() => { const rev = bumpRev(); list.forEach(x => upsert(x, rev)); });
  const rows = db.all('SELECT data, rev FROM jobs WHERE rev > ? ORDER BY rev', since);
  return c.json({ jobs: rows.map(r => j.parse(r.data)), cursor: rows.reduce((m, r) => Math.max(m, r.rev), since) });
});
