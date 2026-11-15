// Approvals: the agent box asks, Kevin decides, the server script consumes. Mounted in app.js with requireDevice,
// because both sides use these routes: an ops token may ask, read and consume its own approvals; a full token
// (the apps) may list them and approve or reject. Reason and args are untrusted text from another machine.
import { Hono } from 'hono';
import { z } from 'zod';
import { db, j } from '../db.js';
import { HttpError } from '../http.js';
import { randomToken } from '../lib/crypto.js';
import { notify } from '../notify/index.js';

const MIN = 60000;
const CreateSchema = z.object({
  verb: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'verb: lowercase letters, digits and dashes'),
  args: z.array(z.string().regex(/^[A-Za-z0-9_.:@\/-]{1,120}$/, 'args: no spaces or shell characters')).max(6).default([]),
  reason: z.string().trim().min(1).max(300),
  ttlMinutes: z.number().int().min(1).max(24 * 60).default(30)
});

const isOps = user => user.scope === 'ops' || user.deviceId === 'master';
const isApp = user => user.scope === 'full';

/** Status as the outside sees it: a pending or approved approval past its time is expired. */
const shown = (r, now = Date.now()) => (r.status === 'pending' || r.status === 'approved') && r.expires_at <= now ? 'expired' : r.status;
const row = r => r && { id: r.id, source: r.source, verb: r.verb, args: j.parse(r.args, []), reason: r.reason, status: shown(r),
  decidedBy: r.decided_by, decidedAt: r.decided_at, usedAt: r.used_at, expiresAt: r.expires_at, createdAt: r.created_at };

/** Pending approvals that are still open, newest first (the Hub tab and the briefing use this). */
export const pendingApprovals = () =>
  db.all("SELECT * FROM approvals WHERE status = 'pending' AND expires_at > ? ORDER BY created_at DESC", Date.now()).map(row);

/* By id only: the asking token (Hermes) and the running token (the script on the main server) are different
   ops devices, and ids are random. Ops tokens cannot list approvals. */
function load(c) {
  const r = db.get('SELECT * FROM approvals WHERE id = ?', c.req.param('id'));
  if (!r) throw new HttpError(404, 'No such approval');
  return r;
}

export const approvals = new Hono();

/** Creates an approval and pushes it to Kevin. Used by the route (Hermes asks) and by agent tasks (Lina asks).
    source is the asking device id, or 'lina'. Throws HttpError(400) on bad input. */
export async function createApproval(source, input) {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 300));
  const a = parsed.data;
  const id = 'apr_' + randomToken(16);   // the id is what lets a script read it, so it must not be guessable
  const now = Date.now();
  db.run('INSERT INTO approvals (id, source, verb, args, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, source, a.verb, j.str(a.args), a.reason, now + a.ttlMinutes * MIN, now);
  await notify({ title: `Approve: ${a.verb} ${a.args.join(' ')}`.trim().slice(0, 120), body: a.reason, url: '#/hub', priority: 4,
    tags: ['server'], kind: 'agent', ref: 'approval:' + id }).catch(e => console.error('approvals: notify', e.message));
  return getApproval(id);
}

/** One approval as the outside sees it (status 'expired' computed), or null. */
export const getApproval = id => row(db.get('SELECT * FROM approvals WHERE id = ?', id)) || null;

/** Marks an approved approval used (one approval, one run). False if it isn't approved or has expired. */
export const consumeApproval = id => !!db.run("UPDATE approvals SET status = 'used', used_at = ? WHERE id = ? AND status = 'approved' AND expires_at > ?",
  Date.now(), id, Date.now()).changes;

approvals.post('/approvals', async c => {
  const user = c.get('user');
  if (!isOps(user)) throw new HttpError(403, 'Only the agent box asks for approvals');
  return c.json(await createApproval(user.deviceId, await c.req.json().catch(() => null)), 201);
});

approvals.get('/approvals', c => {
  if (!isApp(c.get('user'))) throw new HttpError(403, 'Use an app token');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 30));
  return c.json({ approvals: db.all('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?', limit).map(row) });
});

approvals.get('/approvals/:id', c => c.json(row(load(c))));

/** Kevin decides (the apps, the relay, a spoken yes to Lina). Only an open approval can be decided; a second tap is
    a no-op error, not a flip. by: the deciding device id, or 'lina-voice'. Throws 404 / 409. */
export function decideApproval(id, ok, by) {
  const r = db.get('SELECT * FROM approvals WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'No such approval');
  const changed = db.run("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?",
    ok ? 'approved' : 'rejected', by, Date.now(), r.id, Date.now()).changes;
  if (!changed) throw new HttpError(409, `Approval is ${shown(r)}`);
  return getApproval(r.id);
}

for (const [action, ok] of [['approve', true], ['reject', false]]) {
  approvals.post(`/approvals/:id/${action}`, c => {
    const user = c.get('user');
    if (!isApp(user)) throw new HttpError(403, 'Only your own apps decide approvals');
    return c.json(decideApproval(c.req.param('id'), ok, user.deviceId));
  });
}

/* The server script calls this right before it runs the action: one approval, one run. */
approvals.post('/approvals/:id/consume', c => {
  if (!isOps(c.get('user'))) throw new HttpError(403, 'Use an ops token');
  const r = load(c);
  if (!consumeApproval(r.id)) throw new HttpError(409, `Approval is ${shown(r)}`);
  return c.json(row(db.get('SELECT * FROM approvals WHERE id = ?', r.id)));
});
