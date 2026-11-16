// Agentic OS server: one Node process. HTTP API + WebSocket (phone) + scheduler.
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { migrate, db } from './db.js';
import { app } from './app.js';
import { seedFeeds } from './lib/feeds.js';
import { startScheduler } from './jobs/scheduler.js';
import { startWorkbenchWatch } from './lina/watch.js';
import { attachRelay } from './phone/twilio.js';

const applied = migrate();
if (applied.length) console.log('migrations applied:', applied.join(', '));
seedFeeds();
// Lina's turns that were still running when the server stopped (a deploy, a restart) can never finish now: close them,
// so the Hub and the logs don't show them as running forever.
const cut = db.run("UPDATE agent_runs SET status = 'error', finished_at = ?, summary = 'Interrupted: the server restarted' WHERE status = 'running'", Date.now()).changes;
if (cut) console.log('closed ' + cut + ' run(s) cut off by the restart');

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, info => {
  console.log(`Agentic OS server on http://${info.address}:${info.port} · public ${config.publicUrl}`);
});
attachRelay(server);
if (process.env.NO_SCHEDULER !== '1') { startScheduler(); startWorkbenchWatch(); }

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
