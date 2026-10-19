// Obsidian vault connector: Lina reads, searches and adds to Kevin's real vault (a folder of markdown files) on this
// machine. Set OBSIDIAN_VAULT to the vault folder; without it every function reports that the vault is not connected.
// Writes only ever create a note or append to one: nothing is overwritten or deleted. Hidden folders (.obsidian, .git,
// .trash) and anything matching OBSIDIAN_EXCLUDE (comma-separated folder or file names) are invisible to Lina.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, relative, sep, dirname, basename, extname } from 'node:path';
import { config } from '../config.js';

const MAX_READ = 20000, MAX_WRITE = 20000, MAX_FILES = 5000;

export const vaultRoot = () => (config.obsidian.vault ? resolve(config.obsidian.vault) : '');
export const vaultConnected = () => { const r = vaultRoot(); return !!r && existsSync(r) && statSync(r).isDirectory(); };

function need() {
  if (!vaultConnected()) throw new Error('The Obsidian vault is not connected (set OBSIDIAN_VAULT on the server to the vault folder)');
  return vaultRoot();
}

const hidden = name => name.startsWith('.') || config.obsidian.exclude.includes(name.toLowerCase());

/* A vault-relative path (forward slashes) → absolute path inside the vault, or an error. Rejects traversal, hidden and
   excluded parts, and anything but markdown. */
function safePath(rel, { md = true } = {}) {
  const root = need();
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean) throw new Error('No note path given');
  const full = resolve(root, clean);
  const back = relative(root, full);
  if (back.startsWith('..') || resolve(back) === back) throw new Error('Path is outside the vault');
  if (back.split(sep).some(hidden)) throw new Error('That part of the vault is off limits');
  if (md && extname(full).toLowerCase() !== '.md') throw new Error('Only markdown notes (.md) can be used');
  return full;
}

/** All notes: [{path, mtime, size}] with vault-relative forward-slash paths, newest first. */
export function listNotes() {
  const root = need();
  const out = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      if (hidden(e.name)) continue;
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && extname(e.name).toLowerCase() === '.md') {
        const s = statSync(p);
        out.push({ path: relative(root, p).split(sep).join('/'), mtime: s.mtimeMs, size: s.size });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Top-level map of the vault: folders with note counts, for orientation. */
export function vaultOverview() {
  const notes = listNotes();
  const folders = {};
  for (const n of notes) { const f = n.path.includes('/') ? n.path.split('/')[0] : '(root)'; folders[f] = (folders[f] || 0) + 1; }
  return { notes: notes.length, folders, recent: notes.slice(0, 10).map(n => n.path) };
}

/** Notes matching a query: every word must appear in the path or the text. Returns paths with a snippet, best first. */
export function searchVault(query, limit = 10) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return listNotes().slice(0, limit).map(n => ({ path: n.path, modified: new Date(n.mtime).toISOString().slice(0, 10) }));
  const hits = [];
  for (const n of listNotes()) {
    if (n.size > 400000) continue;
    const text = readFileSync(resolve(need(), n.path), 'utf8');
    const hay = (n.path + '\n' + text).toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    const inPath = words.filter(w => n.path.toLowerCase().includes(w)).length;
    const score = inPath * 10 + words.reduce((s, w) => s + Math.min(hay.split(w).length - 1, 5), 0);
    const at = hay.indexOf(words[0], n.path.length + 1);
    const snippet = at < 0 ? '' : text.slice(Math.max(0, at - n.path.length - 1 - 60), at - n.path.length - 1 + 140).replace(/\s+/g, ' ').trim();
    hits.push({ path: n.path, modified: new Date(n.mtime).toISOString().slice(0, 10), snippet, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...h }) => h);
}

/* "Home", "Folder/Home" or "Home.md" → the note's path; wikilink style names work when the basename is unique. */
function resolveNote(name) {
  const want = String(name || '').replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase();
  const notes = listNotes();
  const exact = notes.find(n => n.path.slice(0, -3).toLowerCase() === want);
  if (exact) return exact.path;
  const same = notes.filter(n => basename(n.path, '.md').toLowerCase() === want.split('/').pop());
  if (same.length === 1) return same[0].path;
  if (same.length > 1) throw new Error('Several notes are called that: ' + same.slice(0, 6).map(n => n.path).join(', '));
  throw new Error('No such note: ' + name);
}

/** One note's text (cut at 20k characters) with the notes it links to. */
export function readNote(name) {
  const path = resolveNote(name);
  const text = readFileSync(safePath(path), 'utf8');
  const links = [...new Set([...text.matchAll(/\[\[([^\]|#]+)/g)].map(m => m[1].trim()))].slice(0, 40);
  return { path, content: text.length > MAX_READ ? text.slice(0, MAX_READ) + '\n…(cut)' : text, links };
}

/** Create a note, or append to an existing one. Never overwrites. Returns {path, created}. */
export function writeNote({ path, content, append = false }) {
  const text = String(content || '');
  if (!text.trim()) throw new Error('Nothing to write');
  if (text.length > MAX_WRITE) throw new Error('Too long for one write');
  const rel = /\.md$/i.test(path) ? path : path + '.md';
  const full = safePath(rel);
  const exists = existsSync(full);
  if (exists && !append) throw new Error('That note already exists: use append to add to it');
  if (!exists) { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text.replace(/\s+$/, '') + '\n', 'utf8'); }
  else {
    const old = readFileSync(full, 'utf8');
    appendFileSync(full, (old.endsWith('\n') || !old ? '' : '\n') + '\n' + text.replace(/\s+$/, '') + '\n', 'utf8');
  }
  return { path: relative(need(), full).split(sep).join('/'), created: !exists };
}

/* A few lines for the system prompt: the map of the vault, so Lina knows where to look. Empty when not connected. */
let briefCache = { at: 0, root: '', text: '' };
export function vaultBrief() {
  if (!vaultConnected()) return '';
  if (briefCache.root === vaultRoot() && Date.now() - briefCache.at < 60000) return briefCache.text;
  try {
    const o = vaultOverview();
    const text = `Kevin's Obsidian vault is connected (${o.notes} notes; folders: ${Object.entries(o.folders).map(([f, n]) => `${f} (${n})`).join(', ')}). It holds what he knows about himself, his projects, clients and plans: search_vault / read_note before saying you don't know something about him.`;
    briefCache = { at: Date.now(), root: vaultRoot(), text };
    return text;
  } catch { return ''; }
}
