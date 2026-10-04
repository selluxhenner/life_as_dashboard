/* Gemeinsame HTTP-Helfer für alle Routen. */

export const CORS = {
  // Token-Auth ohne Cookies, daher ist * unkritisch (Browser, Capacitor-WebView, Widget).
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

export async function readBody(request) {
  try { return await request.json(); }
  catch { throw new HttpError(400, 'Ungültiges JSON'); }
}
