// CPU benchmark for the two hot Function paths. Run: node scripts/bench/run.mjs [iterations]
// Prints median / p95 / max milliseconds per request and the first (cold) iteration, as JSON on the last line.

import { buildAlpacaPayload, buildSnapshot, buildSnapshotJson, SNAPSHOT_ROWS } from './fixtures.mjs';
import { normalizeAlpaca, serialize } from './normalize.mjs';
import { screenBinary, screenJson } from './screener.mjs';

const iterations = Number(process.argv[2]) || 500;

function percentile(sortedValues, p) {
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * p))];
}

function measure(label, work) {
  const times = [];
  let first = null;
  for (let i = 0; i < iterations; i++) {
    const started = process.hrtime.bigint();
    work();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (i === 0) first = elapsedMs;
    times.push(elapsedMs);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const result = {
    label,
    firstMs: +first.toFixed(2),
    medianMs: +percentile(sorted, 0.5).toFixed(2),
    p95Ms: +percentile(sorted, 0.95).toFixed(2),
    maxMs: +sorted.at(-1).toFixed(2),
  };
  console.log(
    `${label.padEnd(52)} first ${String(result.firstMs).padStart(7)}  median ${String(result.medianMs).padStart(6)}  p95 ${String(result.p95Ms).padStart(6)}  max ${String(result.maxMs).padStart(6)} ms`,
  );
  return result;
}

const results = [];

// --- /api/bars normalize -------------------------------------------------------------------
// [symbols per call, bars per symbol]. 640 bars is the pessimistic size from the plan (5,120 bars for 8 symbols);
// 350 bars is the real need: ~150 visible + 200 warm-up for SMA 200.
const barCases = [[4, 640], [8, 640], [4, 350], [8, 350], [44, 640]];
for (const [symbolCount, barsPerSymbol] of barCases) {
  const text = buildAlpacaPayload(symbolCount, barsPerSymbol);
  const barCount = symbolCount * barsPerSymbol;
  const tag = `${symbolCount}x${barsPerSymbol}`;
  console.log(`\npayload: ${symbolCount} symbols x ${barsPerSymbol} bars = ${barCount} bars, ${(text.length / 1024).toFixed(0)} KB JSON`);
  results.push({ ...measure(`bars parse only (${tag})`, () => JSON.parse(text)), kb: Math.round(text.length / 1024) });
  results.push(measure(`bars parse + normalize (${tag})`, () => normalizeAlpaca(text)));
  results.push(measure(`bars parse + normalize + stringify (${tag})`, () => serialize(normalizeAlpaca(text))));
}

// --- /api/screener ---------------------------------------------------------------------------
const { buffer, header } = buildSnapshot();
const headerText = JSON.stringify(header);
const jsonText = buildSnapshotJson();
console.log(`\nsnapshot: ${SNAPSHOT_ROWS} rows, binary ${(buffer.byteLength / 1048576).toFixed(2)} MB (+ ${(headerText.length / 1024).toFixed(0)} KB header), JSON ${(jsonText.length / 1048576).toFixed(2)} MB`);
results.push(measure('screener binary (typed-array views, header parse)', () => screenBinary(buffer, headerText)));
results.push(measure('screener JSON.parse of the whole snapshot', () => screenJson(jsonText)));

console.log('\n' + JSON.stringify(results));
