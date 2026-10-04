import { Hono } from 'hono';
import { config } from './config.js';
import { HttpError } from './http.js';
import { requireAuth } from './auth.js';
import { callback as googleCallback } from './connectors/google.js';
import { twiml, callStatus, validTwilioSignature } from './phone/twilio.js';
import { safeEqual, hmac } from './lib/crypto.js';
import { todos } from './routes/todos.js';
import { jobs } from './routes/jobs.js';
import { connections } from './routes/connections.js';
import { voice } from './routes/voice.js';
import { misc } from './routes/misc.js';

export const app = new Hono();

/* CORS: only our own apps (Tauri, Capacitor, local dev). Tokens are bearer, no cookies. */
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = origin && (config.corsOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) || origin === config.publicUrl);
  if (allowed) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    c.header('Access-Control-Max-Age', '86400');
  }
  if (c.req.method === 'OPTIONS') return c.body(null, allowed ? 204 : 403);
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Server error' }, 500);
});

/* ---------- public endpoints (own verification) ---------- */
app.get('/api/health', c => c.json({ ok: true, version: '2.0.0' }));
app.get('/api/oauth/google/callback', c => googleCallback(new URL(c.req.url)));

const twilioOk = async (c, id) => {
  const params = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
  const url = config.publicUrl + new URL(c.req.url).pathname + new URL(c.req.url).search;
  const sigOk = safeEqual(c.req.query('sig'), hmac(config.apiToken, 'call:' + id));
  if (!sigOk || !validTwilioSignature(url, params, c.req.header('X-Twilio-Signature'))) throw new HttpError(403, 'Bad signature');
  return params;
};
app.post('/api/phone/twiml/:id', async c => { await twilioOk(c, c.req.param('id')); return c.body(twiml(c.req.param('id')), 200, { 'Content-Type': 'text/xml' }); });
app.post('/api/phone/status/:id', async c => { callStatus(c.req.param('id'), await twilioOk(c, c.req.param('id'))); return c.body(null, 204); });

/* ---------- everything else needs a device token ---------- */
const api = new Hono();
api.use('*', requireAuth);
api.route('/', todos);
api.route('/', jobs);
api.route('/', connections);
api.route('/', voice);
api.route('/', misc);
app.route('/api', api);

app.notFound(c => c.json({ error: 'Not found' }, 404));
