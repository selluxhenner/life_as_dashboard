// The hub registry (selluxhenner/hub: projects.yaml, devices.yaml) and the health of every service in it.
// The 'hub' job pulls both files with the read-only GITHUB_TOKEN every 15 minutes, then checks each project's
// health URL. The last result is kept in data/hub-registry.json, so a restart shows it right away.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { config } from '../config.js';

const FILE = () => resolve(config.dataDir, 'hub-registry.json');
let current = null;

function load() {
  if (current) return current;
  try { current = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), 'utf8')) : null; } catch { current = null; }
  return current || (current = { projects: [], devices: [], services: [], pulledAt: null, error: null });
}

async function fetchFile(path) {
  const { repo, ref } = config.hub;
  const res = await fetch(`${config.github.api}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    headers: { Authorization: 'Bearer ' + config.github.token, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'agentic-os-hub' },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`${path}: GitHub ${res.status}`);
  return parse(await res.text());
}

/* One health check: up (2xx), down (answered with an error), unreachable (no answer: offline, or only on the tailnet). */
export async function checkHealth(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'follow' });
    return { status: res.ok ? 'up' : 'down', code: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 'unreachable', code: null, ms: null, detail: (e.cause && e.cause.code) || e.name };
  }
}

/** Pull the registry and check every service. Without a token it keeps the last registry and says why. */
export async function pullRegistry() {
  const prev = load();
  if (!config.github.token) {
    current = { ...prev, error: 'GITHUB_TOKEN is not set' };
    return { pulled: false, error: current.error };
  }
  let projects = prev.projects, devices = prev.devices, error = null, pulledAt = prev.pulledAt;
  try {
    const [p, d] = await Promise.all([fetchFile('projects.yaml'), fetchFile('devices.yaml')]);
    projects = (p && p.projects) || [];
    devices = (d && d.devices) || [];
    pulledAt = Date.now();
  } catch (e) { error = e.message.slice(0, 200); }
  const services = await Promise.all(projects.map(async pr => {
    const base = { id: pr.id, name: pr.name || pr.id, role: pr.role || '', repo: pr.repo || null, runsOn: pr.runs_on || [], health: pr.health || null, vaultNote: pr.vault_note || null };
    if (!pr.health) return { ...base, status: 'none' };
    return { ...base, ...(await checkHealth(pr.health)), checkedAt: Date.now() };
  }));
  current = { projects, devices: devices.map(d => ({ name: d.name, os: d.os, role: d.role, status: d.status || 'active', tailnetName: d.tailnet_name || d.name })),
    services, pulledAt, error };
  try { writeFileSync(FILE(), JSON.stringify(current)); } catch (e) { console.error('hub registry: save', e.message); }
  return { pulled: !error, projects: projects.length, up: services.filter(s => s.status === 'up').length, error };
}

/** What the Hub tab shows: services with their last check, and the registry's devices. */
export function registryState() {
  const r = load();
  return { services: r.services, devices: r.devices, pulledAt: r.pulledAt, error: r.error };
}

export const resetRegistry = () => { current = null; };
