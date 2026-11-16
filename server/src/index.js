// Agentic OS server: one Node process. HTTP API + WebSocket (phone) + scheduler.
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { migrate } from './db.js';
import { app } from './app.js';
import { seedFeeds } from './lib/feeds.js';
import { startScheduler } from './jobs/scheduler.js';
import { startWorkbenchWatch } from './lina/watch.js';
import { attachRelay } from './phone/twilio.js';

const applied = migrate();
if (applied.length) console.log('migrations applied:', applied.join(', '));
seedFeeds();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, info => {
  console.log(`Agentic OS server on http://${info.address}:${info.port} · public ${config.publicUrl}`);
});
attachRelay(server);
if (process.env.NO_SCHEDULER !== '1') { startScheduler(); startWorkbenchWatch(); }

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
