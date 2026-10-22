// Per-ticker indicators from a daily OHLCV series (oldest first). Missing values are NaN.
// Wilder smoothing is used for RSI and ATR; everything else is a plain window statistic.

export function sma(values, period) {
  if (values.length < period) return NaN;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function rsi(closes, period = 14) {
  if (closes.length <= period) return NaN;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export function atr(bars, period = 14) {
  const n = bars.c.length;
  if (n <= period) return NaN;
  const tr = (i) => Math.max(bars.h[i] - bars.l[i], Math.abs(bars.h[i] - bars.c[i - 1]), Math.abs(bars.l[i] - bars.c[i - 1]));
  let value = 0;
  for (let i = 1; i <= period; i++) value += tr(i);
  value /= period;
  for (let i = period + 1; i < n; i++) value = (value * (period - 1) + tr(i)) / period;
  return value;
}

export function highest(values, n) { return values.length ? Math.max(...values.slice(-n)) : NaN; }
export function lowest(values, n) { return values.length ? Math.min(...values.slice(-n)) : NaN; }

/** Percent change from `n` sessions ago to the last close. */
export function perf(closes, n) {
  if (closes.length <= n) return NaN;
  return (closes[closes.length - 1] / closes[closes.length - 1 - n] - 1) * 100;
}

export function returns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] / closes[i - 1] - 1);
  return out;
}

/** Standard deviation of daily returns over the last `n` returns, in percent. */
export function volatility(closes, n) {
  const r = returns(closes).slice(-n);
  if (r.length < n) return NaN;
  const mean = r.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / n) * 100;
}

/** Beta of a ticker against a benchmark over aligned dates (maps date -> close). */
export function beta(dates, closes, benchByDate, minPoints = 100) {
  const x = [], y = [];
  for (let i = 1; i < closes.length; i++) {
    const b0 = benchByDate.get(dates[i - 1]), b1 = benchByDate.get(dates[i]);
    if (b0 && b1) { x.push(b1 / b0 - 1); y.push(closes[i] / closes[i - 1] - 1); }
  }
  if (x.length < minPoints) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let cov = 0, varx = 0;
  for (let i = 0; i < x.length; i++) { cov += (x[i] - mx) * (y[i] - my); varx += (x[i] - mx) ** 2; }
  return varx ? cov / varx : NaN;
}
