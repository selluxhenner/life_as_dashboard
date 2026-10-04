export const uid = () => 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const pad2 = n => String(n).padStart(2, '0');
export const dateKey = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const todayKey = () => dateKey(new Date());
export function parseKey(k) { const p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
export function keyOffset(k, days) { const d = parseKey(k); d.setDate(d.getDate() + days); return dateKey(d); }
export const pct = (done, total) => total ? Math.round(done / total * 100) : 0;
export function mondayKeyOf(d) { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return dateKey(m); }
export function isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const firstThu = new Date(t.getFullYear(), 0, 4);
  firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay() + 6) % 7));
  return 1 + Math.round((t - firstThu) / (7 * 24 * 3600 * 1000));
}
export const hm = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
export const minutesOf = t => { const p = t.split(':'); return +p[0] * 60 + +p[1]; };
export const validTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');

const LOCALE = 'en-GB';
export const fmt = {
  short: k => parseKey(k).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }),
  weekday: k => parseKey(k).toLocaleDateString(LOCALE, { weekday: 'short' }),
  long: d => d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }),
  time: d => d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }),
  timeSec: d => d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }
};
