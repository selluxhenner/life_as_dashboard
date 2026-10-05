// Current temperature at home for the status bar. Open-Meteo: free, no key, metric (°C).
// Cached for 15 minutes so every window and reload doesn't call it again.
const KEY = 'agenticWeather';
const MAX_AGE = 15 * 60000;
let inflight = null;

const CODES = [
  [[0], 'Clear'], [[1], 'Mostly clear'], [[2], 'Partly cloudy'], [[3], 'Overcast'], [[45, 48], 'Fog'],
  [[51, 53, 55, 56, 57], 'Drizzle'], [[61, 63, 65, 66, 67], 'Rain'], [[71, 73, 75, 77], 'Snow'],
  [[80, 81, 82], 'Showers'], [[85, 86], 'Snow showers'], [[95, 96, 99], 'Thunderstorm']
];
export const conditionOf = code => (CODES.find(([list]) => list.includes(code)) || [null, ''])[1];

function read(lat, lon) {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && c.lat === lat && c.lon === lon ? c : null;
  } catch { return null; }
}

/* Returns the cached reading ({temp, code, at} or null) and refreshes in the background when stale. */
export function weatherNow(lat, lon, onFresh) {
  const c = read(lat, lon);
  if ((!c || Date.now() - c.at > MAX_AGE) && !inflight && navigator.onLine !== false) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto`;
    inflight = fetch(url, { signal: AbortSignal.timeout(10000) })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(j => {
        const v = { lat, lon, temp: j.current.temperature_2m, code: j.current.weather_code, at: Date.now() };
        try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage off */ }
        onFresh && onFresh(v);
      })
      .catch(() => { /* offline: keep the old reading */ })
      .finally(() => { inflight = null; });
  }
  return c;
}
