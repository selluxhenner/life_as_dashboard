// Connection to the Agentic OS server. Kept outside the app state so the token never lands in exports.
export const SYNC_KEY = 'lifeOsSync';
export const DEFAULT_SERVER = 'https://agentic-os.serviweb.ch';

/* Your own builds can carry the server and a token (VITE_SYNC_TOKEN in .env.local, see .env.example).
   Then every device connects by itself on first start: no pairing screen. */
const env = import.meta.env || {};
export const BUILT_IN = (env.VITE_SYNC_TOKEN || '').trim()
  ? { url: (env.VITE_SERVER_URL || DEFAULT_SERVER).trim(), token: env.VITE_SYNC_TOKEN.trim() } : null;

export function apiConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
    return c && c.url && c.token ? c : null;
  } catch { return null; }
}
export function setApiConfig(cfg) {
  if (cfg) localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); else localStorage.removeItem(SYNC_KEY);
}
const apiUrl = (cfg, path) => cfg.url.replace(/\/+$/, '') + path;

/* Rejects with {kind:'auth'|'server'|'offline', msg?}. */
export async function apiFetch(cfg, path, body, method, { timeout = 15000 } = {}) {
  cfg = cfg || apiConfig();
  if (!cfg) throw { kind: 'offline', msg: 'Not connected' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(apiUrl(cfg, path), {
      method: method || (body ? 'POST' : 'GET'),
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
  } catch { throw { kind: 'offline' }; } finally { clearTimeout(timer); }
  if (res.status === 401) throw { kind: 'auth' };
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw { kind: 'server', msg: j.error || 'HTTP ' + res.status };
  }
  return res.json();
}

export const api = {
  get: (path) => apiFetch(null, path),
  post: (path, body = {}) => apiFetch(null, path, body),
  patch: (path, body) => apiFetch(null, path, body, 'PATCH'),
  del: (path) => apiFetch(null, path, null, 'DELETE')
};

export function errorText(e) {
  if (!e) return 'Something went wrong.';
  if (e.kind === 'auth') return 'The token was rejected. Pair this device again in Settings.';
  if (e.kind === 'server') return 'Server error: ' + e.msg;
  return 'Server unreachable. Check the URL and your connection.';
}
