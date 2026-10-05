// Market pulse for the World page: a handful of global indicators from Yahoo's public chart API (no key).
// Cached in memory for 10 minutes; a failing symbol is skipped rather than failing the whole strip.
const SYMBOLS = [
  { sym: '^GSPC', label: 'S&P 500', kind: 'index' },
  { sym: '^IXIC', label: 'Nasdaq', kind: 'index' },
  { sym: '^GDAXI', label: 'DAX', kind: 'index' },
  { sym: '^STOXX50E', label: 'Euro Stoxx 50', kind: 'index' },
  { sym: '^N225', label: 'Nikkei 225', kind: 'index' },
  { sym: 'EURUSD=X', label: 'EUR/USD', kind: 'fx', digits: 4 },
  { sym: 'BZ=F', label: 'Brent oil', kind: 'commodity', unit: '$' },
  { sym: 'GC=F', label: 'Gold', kind: 'commodity', unit: '$' },
  { sym: '^TNX', label: 'US 10Y yield', kind: 'rate', unit: '%', digits: 2 },
  { sym: 'BTC-USD', label: 'Bitcoin', kind: 'crypto', unit: '$' }
];
const TTL = 10 * 60000;
let cache = null;

async function quote({ sym, label, kind, unit, digits }) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1mo&interval=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgenticOS/2.0)' }, signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(sym + ' HTTP ' + res.status);
  const r = (await res.json()).chart?.result?.[0];
  if (!r) throw new Error(sym + ' empty');
  const m = r.meta;
  const closes = (r.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  const price = m.regularMarketPrice ?? closes.at(-1);
  const prev = closes.length > 1 ? closes.at(-2) : m.chartPreviousClose;
  const change = m.regularMarketChangePercent ?? (prev ? (price / prev - 1) * 100 : 0);
  const monthChange = m.chartPreviousClose ? (price / m.chartPreviousClose - 1) * 100 : null;
  return { sym, label, kind, unit: unit || '', digits: digits ?? (price > 1000 ? 0 : 2), price, change, monthChange, spark: closes.slice(-22), at: (m.regularMarketTime || 0) * 1000 };
}

export async function marketPulse() {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  const settled = await Promise.allSettled(SYMBOLS.map(quote));
  const quotes = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
  const data = { quotes, at: Date.now() };
  if (quotes.length) cache = { at: Date.now(), data };
  return data;
}
