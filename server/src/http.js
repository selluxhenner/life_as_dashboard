// Shared HTTP helpers for Hono routes.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function body(c) {
  try { return await c.req.json(); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function page(title, text, status = 200) {
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agentic OS · ${esc(title)}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#05070A;color:#E6EDF3;font-family:system-ui,sans-serif">
<div style="text-align:center;max-width:420px;padding:24px"><div style="width:44px;height:44px;margin:0 auto 18px;border-radius:50%;border:2px solid #4FE3FF;box-shadow:0 0 24px #4FE3FF66"></div>
<h1 style="font-weight:400;font-size:22px;margin:0 0 8px">${esc(title)}</h1><p style="color:#A7B4C2;margin:0">${esc(text)}</p></div></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export const str = (v, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
