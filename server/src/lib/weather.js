// Today's weather at home for the spoken briefing. Open-Meteo: free, no key. Cached for an hour.
import { config } from '../config.js';

const CODES = [
  [[0], 'clear'], [[1], 'mostly clear'], [[2], 'partly cloudy'], [[3], 'overcast'], [[45, 48], 'fog'],
  [[51, 53, 55, 56, 57], 'drizzle'], [[61, 63, 65, 66, 67], 'rain'], [[71, 73, 75, 77], 'snow'],
  [[80, 81, 82], 'showers'], [[85, 86], 'snow showers'], [[95, 96, 99], 'thunderstorms']
];
const condition = code => (CODES.find(([list]) => list.includes(code)) || [null, 'mixed'])[1];
let cache = null;

/** {city, condition, minC, maxC, rainChance, wetHours:['07','08',…]} for today, or null when offline. */
export async function todayWeather() {
  if (cache && Date.now() - cache.at < 3600000) return cache.data;
  const { lat, lon, city } = config.home;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(config.tz)}&forecast_days=1`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&hourly=precipitation_probability';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const d = await res.json();
    const wetHours = (d.hourly?.time || [])
      .map((t, i) => [t.slice(11, 13), d.hourly.precipitation_probability[i]])
      .filter(([h, p]) => h >= '07' && h <= '22' && p >= 50).map(([h]) => h);
    const data = {
      city, condition: condition(d.daily.weather_code[0]),
      minC: Math.round(d.daily.temperature_2m_min[0]), maxC: Math.round(d.daily.temperature_2m_max[0]),
      rainChance: d.daily.precipitation_probability_max[0], wetHours
    };
    cache = { at: Date.now(), data };
    return data;
  } catch { return null; }
}
