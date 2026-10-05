// Goals that count: "3x Krafttraining", "2 Bewerbungen", "Laufen 4x" get one tick per repetition.
// Pure functions of a goal object ({label, done, ticks?}) — covered by tests/goals.test.js.

const MAX_STEPS = 14;
// "Lose 3 kg", "Run 5 km", "Read 20 pages" are amounts, not repetitions
const UNIT = /^(?:kg|g|km|m|cm|mm|l|liters?|h|hrs?|hours?|std|stunden?|min|mins|minutes?|minuten|sek|s|uhr|am|pm|%|€|\$|eur|euro|chf|usd|kcal|cal|pages?|seiten|steps|schritte|days?|tage?n?|weeks?|wochen|months?|monate?n?|years?|jahre?n?|percent|prozent)\b/i;

/* How many times the goal has to happen; 1 for a plain goal. */
export function goalCount(label) {
  const s = (label || '').trim();
  const mid = s.match(/\s(\d{1,2})\s+(\S+)/);                // "Send 2 job applications", "Mache 3 Bewerbungen"
  const m = s.match(/^(\d{1,2})\s*[x×]?\s+\S/i)          // "3x Krafttraining", "2 Bewerbungen", "3 x Gym"
    || s.match(/^(\d{1,2})[x×]\S/i)                      // "3xGym"
    || s.match(/(?:^|\s)(\d{1,2})\s*[x×](?:\s|$)/i)      // "Krafttraining 3x", "Gym 3x pro Woche"
    || s.match(/\s(\d{1,2})\s*(?:mal|times)\b/i)         // "Laufen 3 mal"
    || (mid && !UNIT.test(mid[2]) ? mid : null);
  const n = m ? Number(m[1]) : 1;
  return n >= 2 && n <= MAX_STEPS ? n : 1;
}

/* One boolean per repetition. A goal ticked off as a whole counts as all done. */
export function goalTicks(g) {
  const n = goalCount(g.label);
  const t = Array.isArray(g.ticks) ? g.ticks : [];
  return Array.from({ length: n }, (_, i) => g.done && !t.some(Boolean) ? true : !!t[i]);
}

export const goalProgress = g => goalTicks(g).filter(Boolean).length;

/* Toggles repetition i; the goal is done once every repetition is. */
export function toggleGoalStep(g, i) {
  const t = goalTicks(g);
  t[i] = !t[i];
  g.ticks = t;
  g.done = t.every(Boolean);
}

/* The big checkbox: all done or all open. */
export function setGoalDone(g, done) {
  g.done = done;
  const n = goalCount(g.label);
  if (n > 1) g.ticks = Array(n).fill(done);
  else delete g.ticks;
}
