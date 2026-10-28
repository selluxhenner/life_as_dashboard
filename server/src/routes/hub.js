// The Hub tab: one call for everything the phone needs to see about the other machines and the agent box.
// Devices come from pairing (last_seen_at is touched on every request), ops from the agent box, approvals from Hermes.
// The registry of projects (selluxhenner/hub) joins here once the server pulls it.
import { Hono } from 'hono';
import { db } from '../db.js';
import { latestOps } from './ops.js';
import { pendingApprovals } from './approvals.js';

export const ONLINE_MS = 15 * 60000;   // the Android app checks in every 15 minutes

export const hub = new Hono();

hub.get('/hub/state', c => {
  const now = Date.now();
  const devices = db.all('SELECT id, name, platform, scope, last_seen_at FROM devices WHERE revoked = 0 ORDER BY last_seen_at DESC')
    .map(d => ({ id: d.id, name: d.name, platform: d.platform, scope: d.scope, lastSeenAt: d.last_seen_at,
      online: !!d.last_seen_at && now - d.last_seen_at < ONLINE_MS, current: d.id === c.get('user').deviceId }));
  return c.json({ devices, ops: latestOps(), approvals: pendingApprovals(), at: now });
});
