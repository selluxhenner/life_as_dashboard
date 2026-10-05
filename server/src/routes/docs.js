// Document sync for the rest of the app state (see migrations/0005_docs.sql).
// Same protocol as todos: upload changes, get back everything after `since`. Last write wins on updatedAt.
import { Hono } from 'hono';
import { db, j } from '../db.js';
import { HttpError, body } from '../http.js';

const MAX_BATCH = 200;
const MAX_VALUE = 256 * 1024;
const PAGE = 1000;

const bumpRev = () => { db.run("UPDATE meta SET value = value + 1 WHERE key = 'rev'"); return db.get("SELECT value FROM meta WHERE key = 'rev'").value; };

function validate(it) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) throw new HttpError(400, 'Doc must be an object');
  if (typeof it.key !== 'string' || !/^[\w:.-]{1,120}$/.test(it.key)) throw new HttpError(400, 'Invalid doc key');
  if (typeof it.updatedAt !== 'number' || !Number.isFinite(it.updatedAt)) throw new HttpError(400, 'updatedAt must be a number');
  const deleted = it.deleted === true;
  const value = deleted ? null : j.str(it.value);
  if (value && value.length > MAX_VALUE) throw new HttpError(400, `Doc ${it.key} is too large`);
  return { key: it.key, value, updatedAt: it.updatedAt, deleted };
}

export const docs = new Hono();

docs.post('/docs/sync', async c => {
  const b = await body(c);
  const since = Number(b?.since || 0);
  const ups = Array.isArray(b?.upserts) ? b.upserts : [];
  if (ups.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} docs per sync`);
  const list = ups.map(validate);
  if (list.length) db.tx(() => {
    const rev = bumpRev();
    for (const d of list) db.run(`INSERT INTO docs (key, value, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted = excluded.deleted, rev = excluded.rev
      WHERE excluded.updated_at > docs.updated_at`, d.key, d.value, d.updatedAt, d.deleted, rev);
  });
  const rows = db.all('SELECT * FROM docs WHERE rev > ? ORDER BY rev LIMIT ?', since, PAGE + 1);
  const more = rows.length > PAGE;
  if (more) {
    // never split one rev across pages, or the cursor would skip its other rows
    const last = rows[PAGE - 1].rev;
    while (rows.length && rows[rows.length - 1].rev > last) rows.pop();
  }
  const cursor = rows.reduce((m, r) => Math.max(m, r.rev), since);
  return c.json({
    docs: rows.map(r => ({ key: r.key, value: j.parse(r.value), updatedAt: r.updated_at, deleted: !!r.deleted })),
    cursor, more
  });
});
