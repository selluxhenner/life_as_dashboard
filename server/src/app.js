import { Hono } from 'hono';
import { config } from './config.js';
import { HttpError, page } from './http.js';
import { requireAuth, requireOps, requireDevice } from './auth.js';
import { callback as googleCallback } from './connectors/google.js';
import { twiml, callStatus, validTwilioSignature } from './phone/twilio.js';
import { safeEqual, hmac } from './lib/crypto.js';
import { todos } from './routes/todos.js';
import { jobs } from './routes/jobs.js';
import { docs } from './routes/docs.js';
import { connections } from './routes/connections.js';
import { voice } from './routes/voice.js';
import { misc } from './routes/misc.js';
import { ops, postReport } from './routes/ops.js';
import { approvals } from './routes/approvals.js';
import { hubState } from './routes/hub.js';
import { githubStats } from './hub/github.js';

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
// Home page + privacy policy URLs for the Google OAuth consent screen.
app.get('/api/home', () => page('Agentic OS', 'A private personal dashboard for one person. It is not a public service and has no sign-up.'));
app.get('/api/privacy', () => page('Privacy policy', 'Agentic OS is used by its owner only. With your consent it reads your Google Calendar and Gmail (read-only for mail) to show them in your own dashboard. Data is stored encrypted on the owner\'s server, never sold or shared, and is only passed to the AI provider to write summaries for you. You can revoke access at any time in your Google account under Security → Third-party access, and the data is then deleted on request. Contact: p.henner.18@gmail.com'));

const twilioOk = async (c, id) => {
  const params = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
  const url = config.publicUrl + new URL(c.req.url).pathname + new URL(c.req.url).search;
  const sigOk = safeEqual(c.req.query('sig'), hmac(config.apiToken, 'call:' + id));
  if (!sigOk || !validTwilioSignature(url, params, c.req.header('X-Twilio-Signature'))) throw new HttpError(403, 'Bad signature');
  return params;
};
app.post('/api/phone/twiml/:id', async c => { await twilioOk(c, c.req.param('id')); return c.body(twiml(c.req.param('id')), 200, { 'Content-Type': 'text/xml' }); });
app.post('/api/phone/status/:id', async c => { callStatus(c.req.param('id'), await twilioOk(c, c.req.param('id'))); return c.body(null, 204); });

/* The agent box posts its reports with an ops-scope token, which every route below refuses. */
app.post('/api/ops/report', requireOps, postReport);
/* Approvals are shared: Hermes asks and consumes with ops tokens, the apps decide. Each handler checks the scope. */
app.use('/api/approvals/*', requireDevice);
app.use('/api/approvals', requireDevice);
app.route('/api', approvals);
/* Hub state: the apps see everything, an ops token (Hermes's hub-status skill) a summary without ids. */
app.get('/api/hub/state', requireDevice, hubState);

/* ---------- everything else needs a device token ---------- */
const api = new Hono();
api.use('*', requireAuth);
api.route('/', todos);
api.route('/', jobs);
api.route('/', docs);
api.route('/', connections);
api.route('/', voice);
api.route('/', misc);
api.route('/', ops);
/* GitHub numbers for the Hub tab (apps only; the tokens never leave the server). ?fresh=1 skips the 10-minute cache. */
api.get('/hub/github', async c => c.json(await githubStats({ fresh: c.req.query('fresh') === '1' })));
app.route('/api', api);

app.notFound(c => c.json({ error: 'Not found' }, 404));
