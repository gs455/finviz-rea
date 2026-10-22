// The planned /api/bars "normalize" step: Alpaca multi-symbol JSON text -> compact columnar JSON per ticker,
// plus the header numbers the chart needs. This is the work that must fit into ~10 ms of Function CPU.

const SECONDS_PER_DAY = 86400;
// Eastern time offset. The real code uses the trading-calendar module; the benchmark assumes EDT (UTC-4)
// because the cost of the lookup is not what we are measuring.
const EASTERN_OFFSET_SECONDS = -4 * 3600;
const REGULAR_CLOSE_SECONDS_OF_DAY = 16 * 3600;

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

export function normalizeAlpaca(jsonText) {
  const parsed = JSON.parse(jsonText);
  const out = {};
  for (const symbol of Object.keys(parsed.bars)) {
    const bars = parsed.bars[symbol];
    const n = bars.length;
    const t = new Array(n);
    const o = new Array(n);
    const h = new Array(n);
    const l = new Array(n);
    const c = new Array(n);
    const v = new Array(n);

    let lastSessionDay = -1;
    let sessionVolume = 0;
    let regularClose = null;
    for (let i = 0; i < n; i++) {
      const bar = bars[i];
      const seconds = Date.parse(bar.t) / 1000;
      t[i] = seconds;
      o[i] = round4(bar.o);
      h[i] = round4(bar.h);
      l[i] = round4(bar.l);
      c[i] = round4(bar.c);
      v[i] = bar.v;

      const local = seconds + EASTERN_OFFSET_SECONDS;
      const day = Math.floor(local / SECONDS_PER_DAY);
      if (day !== lastSessionDay) {
        lastSessionDay = day;
        sessionVolume = 0;
        regularClose = null;
      }
      sessionVolume += bar.v;
      if (local - day * SECONDS_PER_DAY < REGULAR_CLOSE_SECONDS_OF_DAY) regularClose = c[i];
    }

    out[symbol] = {
      t, o, h, l, c, v,
      last: n ? t[n - 1] : null,
      sessionVolume,
      regularClose,
    };
  }
  return out;
}

// What the Function actually returns / caches: one JSON string per ticker, then one combined body.
export function serialize(normalized) {
  const perTicker = {};
  for (const symbol of Object.keys(normalized)) perTicker[symbol] = JSON.stringify(normalized[symbol]);
  const body = '{' + Object.keys(perTicker).map((s) => JSON.stringify(s) + ':' + perTicker[s]).join(',') + '}';
  return { perTicker, body };
}
