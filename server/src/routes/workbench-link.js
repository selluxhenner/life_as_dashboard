// Workbench link, both sides. Contract: docs/workbench-link.md.
//   workbench token   PUT  /api/workbench-link/snapshot          what this computer's Workbench sees
//                     GET  /api/workbench-link/decisions?wait=   Kevin's answers (long poll, at most 25 s)
//                     POST /api/workbench-link/decisions/:id     what became of one {ok, message}
//   app token         GET  /api/workbench/control                all computers as one picture
//                     POST /api/workbench/items/:id/decide       {option, text?}
//                     POST /api/workbench/links {name} · DELETE /api/workbench/links/:id
import { Hono } from 'hono';
import { HttpError } from '../http.js';
import { MAX_BODY } from '../workbench/snapshot.js';
import { putSnapshot, nextDecisions, finishDecision, workbenchControl as control, decideItem, pairWorkbench, unpairWorkbench } from '../workbench/link.js';

const MAX_WAIT_MS = 25000;
const json = async (c, max) => {
  if (Number(c.req.header('Content-Length') || 0) > max) throw new HttpError(413, 'Too large');
  const text = await c.req.text();
  if (Buffer.byteLength(text) > max) throw new HttpError(413, 'Too large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON'); }
};

export const workbenchLink = new Hono();
workbenchLink.put('/workbench-link/snapshot', async c => c.json(await putSnapshot(c.get('user').deviceId, await json(c, MAX_BODY))));
workbenchLink.get('/workbench-link/decisions', async c => {
  const wait = Math.min(MAX_WAIT_MS, Math.max(0, Number(c.req.query('wait')) * 1000 || 0));
  return c.json({ decisions: await nextDecisions(c.get('user').deviceId, wait, c.req.raw.signal) });
});
workbenchLink.post('/workbench-link/decisions/:id', async c => {
  const b = await json(c, 8192);
  await finishDecision(c.get('user').deviceId, c.req.param('id'), { ok: !!b && b.ok === true, message: b && b.message });
  return c.json({ ok: true });
});

export const workbenchControl = new Hono();
workbenchControl.get('/workbench/control', c => c.json(control()));
workbenchControl.post('/workbench/items/:id/decide', async c => {
  const b = await json(c, 16384);
  return c.json({ decision: decideItem(c.req.param('id'), b && b.option, { text: b && b.text, by: c.get('user').deviceId }) });
});
workbenchControl.post('/workbench/links', async c => { const b = await json(c, 2048); return c.json(pairWorkbench(b && b.name), 201); });
workbenchControl.delete('/workbench/links/:id', c => { unpairWorkbench(c.req.param('id')); return c.json({ ok: true }); });
