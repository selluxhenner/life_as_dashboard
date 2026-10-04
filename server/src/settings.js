// Server-side settings (JSON per key) with defaults.
import { db, j } from './db.js';

export const DEFAULTS = {
  flags: { points: false, jobsAi: false, phone: false, push: true },
  briefing: { time: '08:00' },
  news: { digestTimes: ['07:00', '13:00', '19:00'], breakingThreshold: 9 },
  voice: { autoRead: false, provider: 'openai', voice: 'marin' },
  phone: { enabled: false, number: '', monthlyCapEur: 10, quietHours: ['21:30', '08:30'], maxSeconds: 180 },
  ai: { monthlyCapUsd: 40 },
  jobs: { profile: 'Student in Berlin. Looking for Werkstudent, part-time or startup roles in web development, product, design or marketing. Max 20 h/week.' }
};

export function getSetting(key, userId = 1) {
  const row = db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', userId, key);
  const v = row ? j.parse(row.value) : null;
  const d = DEFAULTS[key];
  return d && typeof d === 'object' && !Array.isArray(d) ? { ...d, ...(v || {}) } : (v ?? d);
}

export function setSetting(key, value, userId = 1) {
  db.run(`INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    userId, key, j.str(value), Date.now());
}

export function allSettings(userId = 1) {
  return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, getSetting(k, userId)]));
}
