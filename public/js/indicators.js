// Tech. Analysis overlays computed from the visible bars.

/** Horizontal support/resistance: price levels that several swing highs/lows cluster around. */
export function supportResistance(bars, window = 5, tolerance = 0.004) {
  const pivots = [];
  for (let i = window; i < bars.c.length - window; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (bars.h[j] > bars.h[i]) isHigh = false;
      if (bars.l[j] < bars.l[i]) isLow = false;
    }
    if (isHigh) pivots.push(bars.h[i]);
    if (isLow) pivots.push(bars.l[i]);
  }
  const levels = [];
  for (const price of pivots.sort((a, b) => a - b)) {
    const last = levels[levels.length - 1];
    if (last && Math.abs(price - last.price) / last.price < tolerance) {
      last.price = (last.price * last.count + price) / (last.count + 1);
      last.count++;
    } else {
      levels.push({ price, count: 1 });
    }
  }
  return levels.filter((l) => l.count >= 2).sort((a, b) => b.count - a.count).slice(0, 4);
}

/** Trend lines through the two most recent swing highs and the two most recent swing lows. */
export function trendLines(bars, window = 5) {
  const highs = [], lows = [];
  for (let i = window; i < bars.c.length - window; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (bars.h[j] > bars.h[i]) isHigh = false;
      if (bars.l[j] < bars.l[i]) isLow = false;
    }
    if (isHigh) highs.push({ i, price: bars.h[i] });
    if (isLow) lows.push({ i, price: bars.l[i] });
  }
  const lines = [];
  for (const pts of [highs, lows]) {
    if (pts.length >= 2) lines.push({ a: pts[pts.length - 2], b: pts[pts.length - 1] });
  }
  return lines;
}
