// What a Workbench may tell this server, cleaned. Everything here is text from another machine: clipped, typed, links
// only https, and nothing Workbench adds later (a new kind of ask, a new card) can break the page: an unknown kind is
// shown with the options it brings. The contract is docs/workbench-link.md.
import { HttpError } from '../http.js';

export const LINK_VERSION = 1;
export const MAX_BODY = 512 * 1024;
const KEY_RE = /^[\x21-\x7e][\x20-\x7e]{0,159}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, n);
const line = (v, n) => clip(v, n).replace(/\s+/g, ' ');
const opt = (v, n) => line(v, n) || null;
const num = (v, max = 1e6) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Math.round(Number(v)))) : 0);
const pct = v => (v == null || !Number.isFinite(Number(v)) ? null : Math.min(100, Math.max(0, Math.round(Number(v)))));
const time = v => { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
const link = v => (typeof v === 'string' && /^https:\/\/[^\s"'<>]{4,500}$/.test(v) ? v : null);
const id = v => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const list = (v, n, fn) => (Array.isArray(v) ? v.slice(0, n).map(x => (x && typeof x === 'object' ? fn(x) : null)).filter(Boolean) : []);
const ids = (v, n) => (Array.isArray(v) ? v.map(id).filter(Boolean).slice(0, n) : []);
const of = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

const option = o => {
  const oid = id(o.id), label = line(o.label, 40);
  return oid && label ? { id: oid, label, style: of(o.style, ['primary', 'neutral', 'danger'], 'neutral'), yes: o.yes === true,
    text: of(o.text, ['none', 'required'], 'none'), confirm: opt(o.confirm, 200) } : null;
};
const item = i => {
  const key = typeof i.key === 'string' && KEY_RE.test(i.key) ? i.key : null;
  const rev = id(i.rev), title = line(i.title, 200);
  if (!key || !rev || !title) return null;
  return { key, rev, kind: id(i.kind) || 'other', scope: i.scope === 'orch' ? 'orch' : 'machine', host: id(i.host), title,
    detail: clip(i.detail, 1500), level: of(i.level, ['ask', 'warn', 'info'], 'ask'), push: i.push === true,
    project: opt(i.project, 60), plan: opt(i.plan, 40), task: opt(i.task, 40), href: link(i.href), options: list(i.options, 4, option) };
};
const host = x => id(x.id) && { id: id(x.id), short: opt(x.short, 12) || id(x.id), total: num(x.total, 64), working: num(x.working, 64),
  now: pct(x.now), hour: pct(x.hour), day: pct(x.day), at: time(x.at),
  lanes: list(x.lanes, 24, l => ({ id: opt(l.id, 60) || '?', project: opt(l.project, 60), task: opt(l.task, 40), title: opt(l.title, 160), state: of(l.state, ['work', 'proving', 'idle'], 'work') })),
  lost: list(x.lost, 8, l => ({ kind: opt(l.kind, 20) || 'other', minutes: num(l.minutes), percent: pct(l.percent) || 0 })),
  trend: list(x.trend, 48, t => ({ at: time(t.at), score: pct(t.score) || 0 })).filter(t => t.at) };
const activeTask = t => id(t.id) && { id: id(t.id), title: line(t.title, 200), status: opt(t.status, 20), lane: opt(t.lane, 40), pr: t.pr == null ? null : num(t.pr), href: link(t.href) };
const plan = p => id(p.id) && { id: id(p.id), project: opt(p.project, 60), title: line(p.title, 160) || p.id, state: opt(p.state, 20),
  done: num(p.done), total: num(p.total), building: num(p.building), waiting: num(p.waiting), failed: num(p.failed),
  proofsGreen: num(p.proofsGreen), proofsTotal: num(p.proofsTotal), step: p.step == null ? null : num(p.step, 99), waitsFor: ids(p.waitsFor, 12), ready: ids(p.ready, 12),
  active: list(p.active, 12, activeTask), haupt: id(p.haupt) };
const haupt = x => id(x.id) && { id: id(x.id), project: opt(x.project, 60), title: line(x.title, 160) || x.id, state: opt(x.state, 20), done: num(x.done), total: num(x.total),
  phases: list(x.phases, 40, p => id(p.id) && { id: id(p.id), title: line(p.title, 160) || p.id, step: num(p.step, 99), status: opt(p.status, 20), done: num(p.done), total: num(p.total) }) };
const session = s => id(s.id) && { id: id(s.id), title: line(s.title, 120) || s.id, project: opt(s.project, 60), agent: opt(s.agent, 20), status: opt(s.status, 20),
  branch: opt(s.branch, 120), task: opt(s.task, 40), plan: opt(s.plan, 40), summary: opt(s.summary, 300), lastActivityAt: time(s.lastActivityAt) };
const event = e => (typeof e.key === 'string' && KEY_RE.test(e.key) && line(e.title, 200)
  ? { key: e.key, at: time(e.at) || Date.now(), title: line(e.title, 200), detail: opt(e.detail, 500), level: of(e.level, ['info', 'good', 'warn', 'alert'], 'info') } : null);
const card = c => id(c.id) && line(c.title, 60) && { id: id(c.id), title: line(c.title, 60),
  rows: list(c.rows, 16, r => line(r.label, 80) && { label: line(r.label, 80), value: opt(r.value, 80), tone: of(r.tone, ['ok', 'warn', 'alert'], null), percent: pct(r.percent), href: link(r.href) }) };

/** Cleans a snapshot; throws 400 when it isn't one. Unknown fields are dropped. */
export function cleanSnapshot(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'snapshot: not an object');
  if (raw.v !== LINK_VERSION) throw new HttpError(400, `snapshot: v must be ${LINK_VERSION}`);
  const machine = raw.machine && id(raw.machine.id);
  if (!machine) throw new HttpError(400, 'snapshot: machine.id is missing');
  const o = raw.orch && typeof raw.orch === 'object' ? raw.orch : null;
  return {
    v: LINK_VERSION, at: Math.min(now, time(raw.at) || now),
    machine: { id: machine, platform: of(raw.machine.platform, ['windows', 'macos', 'linux'], null), version: opt(raw.machine.version, 40) },
    orch: o && { configured: o.configured === true, error: opt(o.error, 300), paused: o.paused === true, lastTickAt: time(o.lastTickAt), line: opt(o.line, 300) },
    hosts: list(raw.hosts, 8, host), plans: list(raw.plans, 60, plan), hauptplaene: list(raw.hauptplaene, 20, haupt),
    items: list(raw.items, 60, item), sessions: list(raw.sessions, 40, session), events: list(raw.events, 30, event), cards: list(raw.cards, 12, card)
  };
}
