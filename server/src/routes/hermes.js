// Lina → Hermes: questions Lina queues for the agent box, and Hermes's answers. Mounted in app.js with requireDevice:
// an ops token (Hermes) fetches open questions and answers them; the apps read the list. Answers are untrusted text
// from another machine: shown and read out, never acted on by themselves.
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { HttpError } from '../http.js';
import { uid } from '../lib/crypto.js';
import { notify } from '../notify/index.js';

const isOps = u => u.scope === 'ops' || u.deviceId === 'master';
const row = r => r && { id: r.id, question: r.question, source: r.source, status: r.status, answer: r.answer, pickedAt: r.picked_at, answeredAt: r.answered_at, createdAt: r.created_at };

/** Lina's ask_hermes tool. */
export function askHermes(question, source) {
  const id = uid('ask_');
  db.run('INSERT INTO hermes_asks (id, question, source, created_at) VALUES (?, ?, ?, ?)', id, question, source || 'chat', Date.now());
  return id;
}

/** Recent questions with their answers (Lina's hermes_answers tool and the Hub). */
export const recentAsks = (limit = 10) => db.all('SELECT * FROM hermes_asks ORDER BY created_at DESC LIMIT ?', limit).map(row);

export const hermes = new Hono();

/* Hermes polls this. The first fetch marks a question picked, so the Hub can show "Hermes is on it". */
hermes.get('/hermes/asks', c => {
  const user = c.get('user');
  if (c.req.query('status') === 'open') {
    if (!isOps(user)) throw new HttpError(403, 'Use an ops token');
    const open = db.all("SELECT * FROM hermes_asks WHERE status = 'open' ORDER BY created_at LIMIT 10");
    db.run("UPDATE hermes_asks SET picked_at = ? WHERE status = 'open' AND picked_at IS NULL", Date.now());
    return c.json({ asks: open.map(row) });
  }
  if (user.scope !== 'full') throw new HttpError(403, 'Use an app token');
  return c.json({ asks: recentAsks(Math.min(50, Math.max(1, Number(c.req.query('limit')) || 10))) });
});

const AnswerSchema = z.object({ answer: z.string().trim().min(1).max(4000) });

hermes.post('/hermes/asks/:id/answer', async c => {
  if (!isOps(c.get('user'))) throw new HttpError(403, 'Use an ops token');
  const parsed = AnswerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, 'answer: 1 to 4000 characters');
  const r = db.get('SELECT * FROM hermes_asks WHERE id = ?', c.req.param('id'));
  if (!r) throw new HttpError(404, 'No such question');
  if (r.status !== 'open') throw new HttpError(409, 'Already answered');
  db.run("UPDATE hermes_asks SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?", parsed.data.answer, Date.now(), r.id);
  await notify({ title: 'Hermes answered', body: parsed.data.answer.slice(0, 240), url: '#/hub', kind: 'agent', ref: 'hermes:' + r.id })
    .catch(e => console.error('hermes: notify', e.message));
  return c.json(row(db.get('SELECT * FROM hermes_asks WHERE id = ?', r.id)));
});
