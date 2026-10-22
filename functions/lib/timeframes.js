// Timeframe table shared by the adapters. `days` is the default look-back in calendar days.
export const TIMEFRAMES = {
  "1M":  { minutes: 1,    days: 2,    alpaca: "1Min",   yahoo: "1m",  yahooRange: "5d" },
  "3M":  { minutes: 3,    days: 5,    alpaca: "3Min",   yahoo: "1m",  yahooRange: "5d", aggregate: 3 },
  "5M":  { minutes: 5,    days: 5,    alpaca: "5Min",   yahoo: "5m",  yahooRange: "5d" },
  "15M": { minutes: 15,   days: 10,   alpaca: "15Min",  yahoo: "15m", yahooRange: "1mo" },
  "30M": { minutes: 30,   days: 20,   alpaca: "30Min",  yahoo: "30m", yahooRange: "1mo" },
  "1H":  { minutes: 60,   days: 40,   alpaca: "1Hour",  yahoo: "60m", yahooRange: "3mo" },
  "D":   { minutes: 1440, days: 400,  alpaca: "1Day",   yahoo: "1d",  yahooRange: "2y" },
  "W":   { minutes: 10080, days: 1500, alpaca: "1Week", yahoo: "1wk", yahooRange: "5y" },
  "M":   { minutes: 43200, days: 3650, alpaca: "1Month", yahoo: "1mo", yahooRange: "10y" },
};

export const MAX_TICKERS = 8;
export const MAX_BARS_PER_CALL = 3200;

/** Rough bar count per ticker, used to reject oversized batches before fetching. */
export function estimateBars(tf) {
  const t = TIMEFRAMES[tf];
  if (t.minutes >= 1440) return Math.ceil(t.days / (t.minutes / 1440) * (t.minutes === 1440 ? 5 / 7 : 1));
  const tradingDays = Math.ceil(t.days * 5 / 7);
  return tradingDays * Math.ceil(960 / t.minutes);
}

/** Aggregate columnar bars into groups of `n` consecutive slots aligned to epoch minutes. */
export function aggregate(bars, minutes) {
  const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
  const size = minutes * 60;
  let slot = null;
  for (let i = 0; i < bars.t.length; i++) {
    if (bars.c[i] == null) continue;
    const s = Math.floor(bars.t[i] / size) * size;
    if (s !== slot) {
      slot = s;
      out.t.push(s); out.o.push(bars.o[i]); out.h.push(bars.h[i]);
      out.l.push(bars.l[i]); out.c.push(bars.c[i]); out.v.push(bars.v[i] || 0);
    } else {
      const k = out.t.length - 1;
      out.h[k] = Math.max(out.h[k], bars.h[i]);
      out.l[k] = Math.min(out.l[k], bars.l[i]);
      out.c[k] = bars.c[i];
      out.v[k] += bars.v[i] || 0;
    }
  }
  return out;
}
