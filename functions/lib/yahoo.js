// Yahoo chart adapter (fallback). One call per symbol, so keep batches small.
import { TIMEFRAMES, aggregate } from "./timeframes.js";

async function fetchOne(symbol, tf) {
  const spec = TIMEFRAMES[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?interval=${spec.yahoo}&range=${spec.yahooRange}&includePrePost=true`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; finviz-rea)" } });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const result = (await res.json()).chart?.result?.[0];
  const q = result?.indicators?.quote?.[0];
  if (!result || !q) return { t: [], o: [], h: [], l: [], c: [], v: [] };
  const bars = { t: result.timestamp || [], o: q.open, h: q.high, l: q.low, c: q.close, v: q.volume };
  const keep = bars.t.map((_, i) => i).filter((i) => bars.c[i] != null);
  const pick = (a) => keep.map((i) => a[i]);
  const clean = { t: pick(bars.t), o: pick(bars.o), h: pick(bars.h), l: pick(bars.l), c: pick(bars.c), v: pick(bars.v) };
  return spec.aggregate ? aggregate(clean, spec.aggregate) : clean;
}

export async function fetchYahoo(symbols, tf) {
  const out = {};
  await Promise.all(symbols.map(async (s) => { out[s] = await fetchOne(s, tf); }));
  return out;
}
