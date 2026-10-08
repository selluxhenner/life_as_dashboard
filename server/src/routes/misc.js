// Settings, devices, briefing, news, AI tracker, agent, phone, usage, notifications, dev tools.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db, j } from '../db.js';
import { config } from '../config.js';
import { HttpError, body, str } from '../http.js';
import { allSettings, setSetting, getSetting, DEFAULTS } from '../settings.js';
import { pairDevice } from '../auth.js';
import { getBriefing, generateBriefing, ensureSpoken } from '../jobs/briefing.js';
import { latestDigest } from '../jobs/news.js';
import { marketPulse } from '../jobs/markets.js';
import { aiToday } from '../jobs/aimodels.js';
import { runAgent, decideAction, pendingActions } from '../agent/runner.js';
import { placeCall, listCalls, phoneSpend } from '../phone/twilio.js';
import { monthSpend } from '../ai/claude.js';
import { voiceContext } from '../voice/lina.js';
import { notificationsSince } from '../notify/index.js';
import { fcmReady } from '../notify/fcm.js';
import { glance } from '../jobs/glance.js';
import { runJob, JOBS } from '../jobs/scheduler.js';
import { localDate, monthKey } from '../lib/time.js';
import { uid } from '../lib/crypto.js';

export const misc = new Hono();

/* ---------- settings & devices ---------- */
misc.get('/settings', c => c.json({ settings: allSettings() }));
misc.patch('/settings', async c => {
  const b = await body(c);
  for (const [k, v] of Object.entries(b)) {
    if (!(k in DEFAULTS) || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Unknown setting ' + k);
    setSetting(k, { ...getSetting(k), ...v });
  }
  return c.json({ settings: allSettings() });
});

misc.post('/devices/pair', async c => {
  if (c.get('user').deviceId !== 'master') throw new HttpError(403, 'Pair new devices with the master token');
  const b = await body(c);
  return c.json(pairDevice({ name: str(b.name, 80), platform: str(b.platform, 20) }), 201);
});
misc.get('/devices', c => c.json({ devices: db.all('SELECT id, name, platform, created_at, last_seen_at, revoked FROM devices ORDER BY created_at DESC') }));
misc.delete('/devices/:id', c => { db.run('UPDATE devices SET revoked = 1 WHERE id = ?', c.req.param('id')); return c.json({ ok: true }); });

/* ---------- content ---------- */
misc.get('/briefing/today', c => c.json({ briefing: getBriefing(localDate()) }));
misc.get('/briefing/:date', c => c.json({ briefing: getBriefing(c.req.param('date')) }));
misc.post('/briefing/generate', async c => c.json({ briefing: await generateBriefing() }));
/* Adds the spoken version to today's briefing when it was written before voice existed. */
misc.post('/briefing/spoken', async c => {
  const b = await c.req.json().catch(() => ({}));
  return c.json({ briefing: await ensureSpoken(localDate(), { force: b.force === true }) });
});
misc.get('/news/digest/latest', c => c.json(latestDigest()));
misc.get('/markets', async c => c.json(await marketPulse()));
misc.get('/ai-models/today', c => c.json(aiToday()));
misc.get('/notes', c => c.json({ notes: db.all('SELECT * FROM notes ORDER BY created_at DESC LIMIT 50') }));

/* ---------- agent ---------- */
misc.post('/agent/chat', async c => {
  const b = await body(c);
  const message = str(b.message, 4000);
  if (!message) throw new HttpError(400, 'Empty message');
  const conversationId = typeof b.conversationId === 'string' && /^conv_\w+$/.test(b.conversationId) ? b.conversationId : uid('conv_');
  return streamSSE(c, async stream => {
    const send = ev => stream.writeSSE({ data: JSON.stringify(ev) });
    await send({ type: 'start', conversationId });
    try {
      await runAgent({ message, conversationId, trigger: b.channel === 'voice' ? 'voice' : 'chat', onEvent: send, extraSystem: voiceContext(b.context) });
    } catch (e) {
      await send({ type: 'error', message: e.message });
    }
    await send({ type: 'done' });
  });
});
misc.get('/agent/actions', c => c.json({ actions: c.req.query('status') === 'pending' ? pendingActions()
  : db.all('SELECT id, tool, risk, status, summary, created_at, decided_at FROM agent_actions ORDER BY created_at DESC LIMIT 50') }));
misc.post('/agent/actions/:id/approve', async c => c.json(await decideAction(c.req.param('id'), true)));
misc.post('/agent/actions/:id/reject', async c => c.json(await decideAction(c.req.param('id'), false)));
misc.get('/agent/runs', c => c.json({ runs: db.all('SELECT id, trigger, started_at as startedAt, finished_at as finishedAt, status, summary FROM agent_runs ORDER BY started_at DESC LIMIT ?', Math.min(50, Number(c.req.query('limit') || 12))) }));

/* ---------- phone ---------- */
misc.post('/phone/call', async c => {
  const b = await body(c);
  try { return c.json(await placeCall({ purpose: str(b.purpose, 200) || 'check-in', questions: (b.questions || []).map(q => str(q, 200)).filter(Boolean).slice(0, 5) })); }
  catch (e) { throw new HttpError(400, e.message); }
});
misc.get('/phone/calls', c => c.json({ calls: listCalls(), spentEur: phoneSpend(), capEur: getSetting('phone').monthlyCapEur }));

/* ---------- usage & notifications ---------- */
misc.get('/usage', c => {
  const month = monthKey();
  const start = new Date(month + '-01T00:00:00Z').getTime();
  const voiceUsd = db.get("SELECT COALESCE(SUM(cost_usd),0) s FROM ai_usage WHERE model = 'voice' AND at >= ?", start).s;
  const byFeature = db.all("SELECT feature, ROUND(SUM(cost_usd), 4) usd, COUNT(*) calls FROM ai_usage WHERE at >= ? GROUP BY feature ORDER BY usd DESC", start);
  return c.json({ month, usage: { aiUsd: monthSpend(month) - voiceUsd, voiceUsd, aiCapUsd: getSetting('ai').monthlyCapUsd, phoneEur: phoneSpend(month), phoneCapEur: getSetting('phone').monthlyCapEur, byFeature } });
});
misc.get('/notifications', c => c.json({ notifications: notificationsSince(Number(c.req.query('since') || 0)) }));
/* What the phone shows outside the app: morning notification, home-screen widget, Quick Settings tile. */
misc.get('/glance', c => c.json({ ...glance(), instant: fcmReady() }));
/* The Android app registers its Firebase token here (null to stop); used only to say "check now". */
misc.post('/push/register', async c => {
  const { deviceId } = c.get('user');
  if (deviceId === 'master') throw new HttpError(400, 'Pair this device first; the master token has no device row');
  const b = await body(c);
  const token = b.token == null ? null : str(b.token, 4096);
  db.run('UPDATE devices SET push_token = ? WHERE id = ?', token || null, deviceId);
  return c.json({ ok: true, instant: fcmReady() && !!token });
});
misc.get('/jobs-status', c => c.json({ runs: db.all('SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 40') }));

/* ---------- dev: run a scheduled job by hand ---------- */
misc.post('/dev/run-job', async c => {
  if (!config.dev && c.get('user').deviceId !== 'master') throw new HttpError(403, 'Only with DEV=1 or the master token');
  const b = await body(c);
  if (!JOBS[b.job]) throw new HttpError(400, 'Jobs: ' + Object.keys(JOBS).join(', '));
  return c.json(await runJob(b.job, b.slot || 'manual-' + Date.now(), { force: !!b.force }));
});
