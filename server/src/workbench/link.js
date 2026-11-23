// Workbench link: the computers' Workbenches as one picture, and Kevin's answers on their way back.
// Workbench connects out (nothing here ever calls a computer), posts a snapshot and long-polls for decisions. A decision
// can only be one of the options Workbench itself offered, bound to the item Kevin saw (key + rev); Workbench checks it
// again before it runs it. Delivered at most once: a lost answer shows as "unknown", it is never sent twice.
import { createHash } from 'node:crypto';
import { db, j } from '../db.js';
import { HttpError } from '../http.js';
import { uid } from '../lib/crypto.js';
import { pairDevice } from '../auth.js';
import { config } from '../config.js';
import { notify } from '../notify/index.js';
import { addFeed } from '../lina/feed.js';
import { cleanSnapshot } from './snapshot.js';

export const ONLINE_MS = 3 * 60000;
const DECISION_TTL_MS = 10 * 60000;          // not picked up by then: the computer is off, ask again
const ANSWER_MS = 3 * 60000;                 // picked up but no result by then: unknown
const SETTLE_MS = 10 * 60000;                // a decided item stays hidden this long (orch needs a tick or a merge)
const REPUSH_MS = 10 * 60000;                // the same ask with a new text doesn't push again within this
const MAX_PUSHES = 3;                        // more new asks at once: one summary push
const EVENT_MAX_AGE_MS = 6 * 3600000;
const REPLY_CHARS = 2000;

/* ---------- pairing ---------- */

/** A code Kevin pastes once into Workbench › Settings. The token may only talk to the link routes. */
export function pairWorkbench(name, publicUrl = config.publicUrl) {
  const label = String(name || '').trim().slice(0, 40);
  if (!label) throw new HttpError(400, 'Give the computer a name');
  const d = pairDevice({ name: label, platform: 'workbench', scope: 'workbench' });
  db.run('INSERT INTO workbench_links (device_id, created_at) VALUES (?, ?)', d.id, Date.now());
  return { id: d.id, name: label, code: 'aos1.' + Buffer.from(JSON.stringify({ u: publicUrl, t: d.token })).toString('base64url') };
}
export function unpairWorkbench(deviceId) {
  const n = db.run("UPDATE devices SET revoked = 1 WHERE id = ? AND scope = 'workbench'", deviceId).changes;
  if (!n) throw new HttpError(404, 'No such computer');
  db.run('DELETE FROM workbench_links WHERE device_id = ?', deviceId);
  db.run("UPDATE workbench_decisions SET status = 'failed', message = 'Computer disconnected', finished_at = ? WHERE device_id = ? AND status IN ('pending', 'sent')", Date.now(), deviceId);
  wake(deviceId);
}

const links = () => db.all(`SELECT l.device_id, l.machine, l.snapshot, l.seen_at, l.snapshot_at, l.created_at, d.name FROM workbench_links l
  JOIN devices d ON d.id = l.device_id WHERE d.revoked = 0 ORDER BY l.created_at`)
  .map(r => ({ id: r.device_id, name: r.name, machine: r.machine, snap: j.parse(r.snapshot), seenAt: r.seen_at, snapshotAt: r.snapshot_at, createdAt: r.created_at }));

export const linked = () => !!db.get("SELECT 1 FROM workbench_links l JOIN devices d ON d.id = l.device_id WHERE d.revoked = 0 AND l.snapshot IS NOT NULL");

/* ---------- one picture ---------- */

const isOnline = (l, now) => !!l.seenAt && now - l.seenAt < ONLINE_MS;
/* Whose view of orch counts: an online computer that reads orch, the one that sees the most hosts (the controller),
   then the one paired first. Both read the same plans, so this only avoids showing every ask twice. */
function leadOf(all, now) {
  const reads = all.filter(l => l.snap?.orch?.configured && !l.snap.orch.error);
  const pool = reads.some(l => isOnline(l, now)) ? reads.filter(l => isOnline(l, now)) : reads;
  return pool.slice().sort((a, b) => (b.snap.hosts.length - a.snap.hosts.length) || (a.createdAt - b.createdAt))[0] || null;
}

const itemId = (deviceId, i) => 'wbk_' + createHash('sha256').update(`${deviceId}\n${i.key}\n${i.rev}`).digest('hex').slice(0, 16);

function shownDecision(d, now = Date.now()) {
  if (!d) return null;
  const status = d.status === 'pending' && d.expires_at <= now ? 'expired' : d.status === 'sent' && now - d.sent_at > ANSWER_MS ? 'unknown' : d.status;
  return { id: d.id, title: d.title, label: d.label, optionId: d.option_id, text: d.text, by: d.decided_by, status, message: d.message, createdAt: d.created_at, finishedAt: d.finished_at };
}
const lastDecision = (key, rev) => db.get('SELECT * FROM workbench_decisions WHERE item_key = ? AND rev = ? ORDER BY created_at DESC LIMIT 1', key, rev);

/* Items of all computers, each ask once. An ask of orch belongs to the computer whose lane it is about (its terminal is
   there) when that one is online and offers it too, else to the lead; a computer's own asks belong to it. */
function mergedItems(all, lead, now) {
  const out = [];
  const add = (l, i) => out.push({ ...i, id: itemId(l.id, i), deviceId: l.id, machine: l.snap.machine.id, machineName: l.name, online: isOnline(l, now) });
  const ownShort = l => l.snap.hosts.find(x => x.id === l.snap.machine.id)?.short || null;
  // which host an ask is about: the computer that has the session may be the only one that knows
  const hostOf = new Map();
  for (const l of all) if (isOnline(l, now)) for (const i of l.snap?.items || []) if (i.scope === 'orch' && i.host && !hostOf.has(i.key)) hostOf.set(i.key, i.host);
  for (const l of all) for (const i of l.snap?.items || []) {
    if (i.scope !== 'orch') { add(l, i); continue; }
    const short = hostOf.get(i.key);
    const home = short && all.find(o => o.snap && isOnline(o, now) && ownShort(o) === short && o.snap.items.some(x => x.scope === 'orch' && x.key === i.key));
    if (l.id === (home || lead || l).id) add(l, i);
  }
  return out;
}

function visibleItems(all, lead, now) {
  const order = { ask: 0, warn: 1, info: 2 };
  return mergedItems(all, lead, now).map(i => ({ ...i, decision: shownDecision(lastDecision(i.key, i.rev), now) }))
    .filter(i => !(i.decision && i.decision.status === 'done' && now - i.decision.finishedAt < SETTLE_MS))
    // a stopped decision from a while ago says nothing any more
    .map(i => (i.decision && ['done', 'expired', 'unknown', 'failed'].includes(i.decision.status) && now - i.decision.createdAt > 30 * 60000 ? { ...i, decision: null } : i))
    .sort((a, b) => order[a.level] - order[b.level] || (b.options.length > 0) - (a.options.length > 0));
}

/* Every computer with its lanes. A computer reports its own; one that isn't linked (or is off) still shows when the
   controller reports its lanes. */
function machinesOf(all, lead, now) {
  const out = all.map(l => {
    const s = l.snap, online = isOnline(l, now);
    const own = s && (s.hosts.find(x => x.id === s.machine.id) || (s.hosts.length === 1 ? s.hosts[0] : null));
    const seen = !online && lead && lead.id !== l.id && s ? lead.snap.hosts.find(x => x.id === s.machine.id) : null;
    const sessions = (s && s.sessions) || [];
    return { id: s ? s.machine.id : l.id, deviceId: l.id, name: l.name, platform: s ? s.machine.platform : null, version: s ? s.machine.version : null,
      online, seenAt: l.seenAt, lanes: seen || own || null, viaController: !!seen, paused: !!(s && s.orch && s.orch.paused), orchError: s && s.orch ? s.orch.error : null,
      sessions: { running: sessions.filter(x => x.status === 'running').length, waiting: sessions.filter(x => x.status === 'waiting').length } };
  });
  const known = new Set(out.map(m => m.id));
  for (const x of lead && lead.snap ? lead.snap.hosts : []) if (!known.has(x.id)) out.push({ id: x.id, deviceId: null, name: x.id, platform: null, version: null,
    online: isOnline(lead, now), seenAt: lead.snapshotAt, lanes: x, viaController: true, paused: false, orchError: null, sessions: { running: 0, waiting: 0 } });
  return out;
}

/** The whole picture for the apps and Lina. */
export function workbenchControl(now = Date.now()) {
  const all = links();
  const lead = leadOf(all, now);
  const s = lead && lead.snap;
  const sessions = all.flatMap(l => ((l.snap && l.snap.sessions) || []).map(x => ({ ...x, machine: l.snap.machine.id, machineName: l.name })))
    .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)).slice(0, 40);
  const seenCards = new Set();
  const cards = [...(lead ? [lead] : []), ...all.filter(l => l !== lead)].flatMap(l => ((l.snap && l.snap.cards) || []).filter(c => !seenCards.has(c.id) && seenCards.add(c.id)));
  const lanes = machinesOf(all, lead, now);
  return {
    linked: all.length > 0, at: now, lead: lead ? lead.snap.machine.id : null,
    orch: s ? { ...s.orch, stale: !isOnline(lead, now) } : null,
    machines: lanes, items: visibleItems(all, lead, now), plans: s ? s.plans : [], hauptplaene: s ? s.hauptplaene : [], sessions, cards,
    decisions: db.all('SELECT * FROM workbench_decisions ORDER BY created_at DESC LIMIT 8').map(d => shownDecision(d, now))
  };
}

/** One item by the id the apps and Lina use, or null when it is gone or has changed. */
export function workbenchItem(id, now = Date.now()) {
  const all = links();
  return visibleItems(all, leadOf(all, now), now).find(i => i.id === id) || null;
}
/** What a plain "yes" to this item means, or null (it needs words, or there is no such thing). */
export const yesOption = item => (item && item.options.find(o => o.yes && o.text !== 'required')) || null;

/* ---------- Kevin decides ---------- */

/** Checks an answer without giving it. Returns {item, option, text}; throws 404 / 400 / 409. */
export function checkAnswer(id, optionId, text, now = Date.now()) {
  const item = workbenchItem(id, now);
  if (!item) throw new HttpError(409, 'This has changed or is already done. Look again.');
  const option = item.options.find(o => o.id === optionId);
  if (!option) throw new HttpError(400, 'No such option: ' + String(optionId).slice(0, 40));
  const words = option.text === 'required' ? String(text || '').replace(/\s+/g, ' ').trim() : null;
  if (option.text === 'required' && !words) throw new HttpError(400, 'This needs your answer in words');
  if (words && words.length > REPLY_CHARS) throw new HttpError(400, `At most ${REPLY_CHARS} characters`);
  if (item.decision && ['pending', 'sent'].includes(item.decision.status)) throw new HttpError(409, 'Already on its way: ' + item.decision.label);
  if (!item.online) throw new HttpError(409, `${item.machineName} is not connected right now`);
  return { item, option, text: words };
}

/** Kevin's answer. by: the deciding device id, or 'lina-voice'. Returns the decision. */
export function decideItem(id, optionId, { text = null, by, now = Date.now() }) {
  const a = checkAnswer(id, optionId, text, now);
  const did = uid('wbd_');
  db.run(`INSERT INTO workbench_decisions (id, device_id, item_key, rev, option_id, title, label, text, decided_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    did, a.item.deviceId, a.item.key, a.item.rev, a.option.id, a.item.title, a.option.label, a.text, by, now, now + DECISION_TTL_MS);
  wake(a.item.deviceId);
  return shownDecision(db.get('SELECT * FROM workbench_decisions WHERE id = ?', did), now);
}

/* ---------- Workbench's side ---------- */

const waiting = new Map();                   // device id → wake functions of its open long-polls
function wake(deviceId) { for (const fn of waiting.get(deviceId) || []) fn(); }

/* Marks what is ready as sent and returns it: from here on it is never handed out again. */
function takeDecisions(deviceId, now = Date.now()) {
  return db.tx(() => {
    const rows = db.all("SELECT * FROM workbench_decisions WHERE device_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at LIMIT 10", deviceId, now);
    for (const r of rows) db.run("UPDATE workbench_decisions SET status = 'sent', sent_at = ? WHERE id = ?", now, r.id);
    return rows.map(r => ({ id: r.id, key: r.item_key, rev: r.rev, option: r.option_id, text: r.text }));
  });
}

/** Decisions for a computer; waits up to waitMs for the first one. signal: the caller went away. */
export async function nextDecisions(deviceId, waitMs = 0, signal = null) {
  touch(deviceId);
  const ready = takeDecisions(deviceId);
  if (ready.length || !waitMs) return ready;
  const woken = await new Promise(done => {
    const set = waiting.get(deviceId) || new Set();
    waiting.set(deviceId, set);
    const finish = why => { clearTimeout(timer); set.delete(onWake); if (!set.size) waiting.delete(deviceId); signal?.removeEventListener('abort', gone); done(why); };
    const onWake = () => finish('wake'), gone = () => finish('gone');
    const timer = setTimeout(() => finish('time'), waitMs);
    timer.unref?.();
    set.add(onWake);
    if (signal) { if (signal.aborted) return gone(); signal.addEventListener('abort', gone); }
  });
  return woken === 'wake' && !(signal && signal.aborted) ? takeDecisions(deviceId) : [];
}

/** What became of a decision. Only the computer it went to may say so, once. */
export async function finishDecision(deviceId, id, { ok, message }) {
  const now = Date.now();
  const text = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  const done = db.run("UPDATE workbench_decisions SET status = ?, message = ?, finished_at = ? WHERE id = ? AND device_id = ? AND status = 'sent'", ok ? 'done' : 'failed', text, now, id, deviceId).changes;
  if (!done) throw new HttpError(409, 'Not an open decision of this computer');
  const d = db.get('SELECT * FROM workbench_decisions WHERE id = ?', id);
  db.run("UPDATE lina_feed SET told_at = ? WHERE ref = ? AND told_at IS NULL", now, 'wbi:' + d.item_key);
  addFeed({ source: 'workbench', kind: 'decision', title: ok ? `Workbench · ${d.label}: ${d.title}` : `Workbench · not done: ${d.title}`, body: text || '', level: ok ? 'good' : 'alert', url: '#/workbench', ref: 'wbd:' + id });
  if (!ok) await notify({ title: 'Workbench: not done', body: [d.title, text].filter(Boolean).join(' · '), url: '#/workbench', priority: 4, kind: 'agent', ref: 'wbd:' + id, feed: false }).catch(e => console.error('workbench notify', e.message));
  return shownDecision(d, now);
}

function touch(deviceId, now = Date.now()) { db.run('UPDATE workbench_links SET seen_at = ? WHERE device_id = ?', now, deviceId); }

/** A computer's newest snapshot. Returns {ok, items}. */
export async function putSnapshot(deviceId, raw, now = Date.now()) {
  const snap = cleanSnapshot(raw, now);
  const first = !db.get('SELECT snapshot FROM workbench_links WHERE device_id = ?', deviceId)?.snapshot;
  const n = db.run('UPDATE workbench_links SET machine = ?, snapshot = ?, seen_at = ?, snapshot_at = ? WHERE device_id = ?', snap.machine.id, j.str(snap), now, now, deviceId).changes;
  if (!n) throw new HttpError(404, 'Not a paired Workbench');
  tellEvents(snap, first, now);
  await tellAsks(now);
  return { ok: true, items: snap.items.length };
}

/* What got done (merged, a plan finished …): once into Lina's feed, whichever computer says it first. What a newly
   paired computer reports from before counts as known. */
function tellEvents(snap, first, now) {
  for (const e of snap.events) {
    const ref = 'event:' + e.key;
    if (now - e.at > EVENT_MAX_AGE_MS || db.get('SELECT 1 FROM workbench_told WHERE ref = ?', ref)) continue;
    db.run('INSERT INTO workbench_told (ref, told_at) VALUES (?, ?)', ref, now);
    if (!first) addFeed({ source: 'workbench', kind: 'event', title: 'Workbench · ' + e.title, body: e.detail || '', level: e.level, url: '#/workbench', ref: 'wbe:' + e.key, at: now });
  }
}

/* New asks: into Lina's feed and, when they need Kevin, one push each (or one for all when several arrive at once). */
async function tellAsks(now) {
  const items = workbenchControl(now).items.filter(i => i.level === 'ask' && !(i.decision && ['pending', 'sent'].includes(i.decision.status)));
  // an ask that went away counts as new when it comes back (its last push still keeps the quiet time)
  const open = new Set(items.map(i => 'item:' + i.key));
  for (const t of db.all("SELECT ref FROM workbench_told WHERE ref LIKE 'item:%' AND rev != ''")) if (!open.has(t.ref)) db.run("UPDATE workbench_told SET rev = '' WHERE ref = ?", t.ref);
  const fresh = [];
  for (const i of items) {
    const ref = 'item:' + i.key;
    const told = db.get('SELECT rev, told_at FROM workbench_told WHERE ref = ?', ref);
    if (told && told.rev === i.rev) continue;
    db.run('INSERT INTO workbench_told (ref, rev, told_at) VALUES (?, ?, ?) ON CONFLICT (ref) DO UPDATE SET rev = excluded.rev, told_at = excluded.told_at', ref, i.rev, now);
    addFeed({ source: 'workbench', kind: 'ask', title: 'Workbench · ' + i.title, body: i.detail.slice(0, 300), level: 'warn', url: '#/workbench', ref: 'wbi:' + i.key, at: now });
    if (i.push && !(told && now - told.told_at < REPUSH_MS)) fresh.push(i);
  }
  const send = (title, body, ref) => notify({ title, body, url: '#/workbench', priority: 4, tags: ['hammer'], kind: 'agent', ref, feed: false }).catch(e => console.error('workbench notify', e.message));
  if (fresh.length > MAX_PUSHES) await send(`Workbench: ${fresh.length} things need you`, fresh.slice(0, 4).map(i => i.title).join(' · ').slice(0, 300), 'wb:' + fresh[0].id);
  else for (const i of fresh) await send('Workbench: ' + i.title.slice(0, 110), i.detail.slice(0, 300) || i.title, 'wb:' + i.id);
}

/** Old answers and marks go after 30 days (called by the maintenance job). */
export function pruneWorkbench(now = Date.now()) {
  const cut = now - 30 * 86400000;
  db.run('DELETE FROM workbench_decisions WHERE created_at < ?', cut);
  db.run('DELETE FROM workbench_told WHERE told_at < ?', cut);
}
