// Builds realistic test payloads for the CPU benchmark from the recorded samples in docs/samples.
// Nothing here talks to the network.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(here, '..', '..', 'docs', 'samples');

// Small deterministic random generator so every run produces identical data.
export function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Reads a Yahoo chart sample and returns its 1-minute bars that had trades
// (Alpaca only returns bars with trades, so zero-volume and null bars are dropped).
function readTradeBars(fileName) {
  const json = JSON.parse(readFileSync(path.join(samplesDir, fileName), 'utf8'));
  const result = json.chart.result[0];
  const quote = result.indicators.quote[0];
  const bars = [];
  result.timestamp.forEach((time, i) => {
    if (quote.close[i] == null || !quote.volume[i]) return;
    bars.push({
      time,
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
      volume: quote.volume[i],
    });
  });
  return bars;
}

// Aggregates 1-minute bars into N-minute bars (bucketed on epoch time).
function aggregate(bars, minutes) {
  const bucketSeconds = minutes * 60;
  const out = [];
  let current = null;
  for (const bar of bars) {
    const bucket = Math.floor(bar.time / bucketSeconds) * bucketSeconds;
    if (!current || current.time !== bucket) {
      current = { ...bar, time: bucket };
      out.push(current);
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  return out;
}

// Returns the Alpaca-shaped JSON text for `symbolCount` symbols with `barsPerSymbol` 3-minute bars each:
//   {"bars":{"SYM":[{"c":..,"h":..,"l":..,"n":..,"o":..,"t":"2026-10-21T23:57:00Z","v":..,"vw":..}, ...]},"next_page_token":null}
export function buildAlpacaPayload(symbolCount, barsPerSymbol = 640) {
  const random = makeRandom(42);
  const templates = ['yahoo_AAPL_1m_5d.json', 'yahoo_QS_1m_5d.json'].map((file) =>
    aggregate(readTradeBars(file), 3).slice(-barsPerSymbol),
  );
  const bars = {};
  for (let s = 0; s < symbolCount; s++) {
    const template = templates[s % templates.length];
    const scale = 0.5 + random() * 3;
    const symbol = 'T' + String(s).padStart(3, '0');
    bars[symbol] = template.map((bar) => ({
      c: +(bar.close * scale).toFixed(4),
      h: +(bar.high * scale).toFixed(4),
      l: +(bar.low * scale).toFixed(4),
      n: 1 + Math.floor(random() * 200),
      o: +(bar.open * scale).toFixed(4),
      t: new Date(bar.time * 1000).toISOString().replace('.000Z', 'Z'),
      v: bar.volume,
      vw: +(bar.close * scale).toFixed(4),
    }));
  }
  return JSON.stringify({ bars, next_page_token: null });
}

// ---- Daily snapshot ------------------------------------------------------------------------

export const SNAPSHOT_ROWS = 5600;
// 70 numeric columns x 4 bytes x 5,600 rows = 1.57 MB, matching the 1.6 MB estimate in the plan.
export const SNAPSHOT_COLUMNS = [
  'price', 'change', 'volume', 'avgVol', 'marketCap', 'relVol', 'sma20', 'sma50', 'sma200', 'rsi',
  'perfWeek', 'perfMonth', 'perfQuarter', 'perfHalf', 'perfYear', 'perfYtd', 'high52', 'low52',
  'atr', 'beta', 'gap', 'open', 'high', 'low', 'prevClose', 'ahClose', 'ahChange', 'ahVolume',
  'pe', 'fwdPe', 'peg', 'ps', 'pb', 'pc', 'pfcf', 'epsTtm', 'epsGrowth', 'salesGrowth', 'divYield',
  'roa', 'roe', 'roi', 'currentRatio', 'quickRatio', 'debtEq', 'grossMargin', 'opMargin',
  'netMargin', 'payout', 'shortFloat', 'shortRatio', 'floatShares', 'sharesOut', 'insiderOwn',
  'instOwn', 'volatilityW', 'volatilityM', 'recomm', 'targetPrice', 'avgVol20', 'dollarVol',
  'sma20Dist', 'sma50Dist', 'sma200Dist', 'high52Dist', 'low52Dist', 'ema20', 'ema50', 'bbUpper',
  'bbLower', 'macd',
];

// Columnar snapshot as one ArrayBuffer of float32 columns, plus text columns kept as JSON.
// Returns { buffer, header } where header = { rows, columns: [{name, offset}], tickers: [...], sectors: [...] }.
export function buildSnapshot() {
  const random = makeRandom(7);
  const rows = SNAPSHOT_ROWS;
  const buffer = new ArrayBuffer(SNAPSHOT_COLUMNS.length * rows * 4);
  const columns = SNAPSHOT_COLUMNS.map((name, index) => {
    const offset = index * rows * 4;
    const view = new Float32Array(buffer, offset, rows);
    for (let i = 0; i < rows; i++) {
      view[i] = name === 'price' ? 0.2 + random() * random() * 400
        : name === 'change' ? (random() - 0.5) * 20
        : name === 'avgVol' ? Math.floor(random() * random() * 5e6)
        : random() * 100;
    }
    return { name, offset };
  });
  const tickers = Array.from({ length: rows }, (_, i) => 'S' + i.toString(36).toUpperCase().padStart(4, '0'));
  const sectors = Array.from({ length: rows }, (_, i) => i % 11);
  return { buffer, header: { rows, columns, tickers, sectors } };
}

// Same data as a column-oriented JSON text ({"price":[...], ...}) for the "JSON.parse" comparison.
export function buildSnapshotJson() {
  const { buffer, header } = buildSnapshot();
  const obj = { rows: header.rows, tickers: header.tickers, sectors: header.sectors };
  for (const column of header.columns) {
    obj[column.name] = Array.from(new Float32Array(buffer, column.offset, header.rows), (x) => +x.toFixed(3));
  }
  return JSON.stringify(obj);
}
