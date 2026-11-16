// Lina's feed and deck. Mounted with requireDevice:
//   POST /api/lina/events      any device token (the apps, Hermes, Workbench, Kevin's housing or banking app …)
//   GET  /api/lina/feed        apps only: the newest entries, what Lina hasn't told yet, and the status snapshot
//   POST /api/lina/feed/told   apps only: entries Kevin has seen on the deck (Lina won't repeat them)
import { Hono } from 'hono';
import { z } from 'zod';
import { HttpError } from '../http.js';
import { notify } from '../notify/index.js';
import { addFeed, feedSince, markTold, untoldCount, LEVELS, SOURCE_RE } from '../lina/feed.js';
import { linaSnapshot } from '../lina/snapshot.js';

export const lina = new Hono();

const EventSchema = z.object({
  source: z.string().regex(SOURCE_RE, 'source: lowercase letters, digits and dashes, e.g. "housing"'),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(1000).optional(),
  kind: z.string().max(40).optional(),
  level: z.enum(LEVELS).optional(),
  url: z.string().url().max(500).optional(),
  ref: z.string().max(200).optional(),
  push: z.boolean().optional()                // also a push to Kevin's phone (alert level always pushes)
});

lina.post('/lina/events', async c => {
  const parsed = EventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map(i => (i.path.join('.') || 'body') + ': ' + i.message).join('; '));
  const e = parsed.data;
  const ref = e.ref ? e.source + ':' + e.ref : null;            // an app can only update its own entries
  const out = addFeed({ ...e, ref });
  if (e.push || e.level === 'alert') {
    await notify({ title: e.title, body: e.body || e.title, url: '#/lina', priority: e.level === 'alert' ? 4 : 3, kind: 'general', ref: 'feed:' + (ref || out.id), feed: false })
      .catch(err => console.error('lina event notify', err.message));
  }
  return c.json(out, out.updated ? 200 : 201);
});

const appsOnly = c => { if (c.get('user').scope !== 'full') throw new HttpError(403, 'Use an app token'); };

lina.get('/lina/feed', async c => {
  appsOnly(c);
  const since = Number(c.req.query('since')) || 0;
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 30));
  const snapshot = c.req.query('snapshot') === '0' ? null : await linaSnapshot();
  return c.json({ events: feedSince({ since, limit }), unread: untoldCount(), snapshot, at: Date.now() });
});

lina.post('/lina/feed/told', async c => {
  appsOnly(c);
  const ids = ((await c.req.json().catch(() => ({}))) || {}).ids;
  return c.json({ told: markTold(Array.isArray(ids) ? ids : []) });
});
