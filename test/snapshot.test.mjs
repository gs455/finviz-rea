import test from "node:test";
import assert from "node:assert/strict";
import { sma, rsi, atr, perf } from "../jobs/lib/indicators.mjs";
import { writeSnapshot, readSnapshot } from "../jobs/lib/snapshot.mjs";

test("sma uses the last N values", () => {
  assert.equal(sma([1, 2, 3, 4, 5], 3), 4);
  assert.ok(Number.isNaN(sma([1, 2], 3)));
});

test("rsi is 100 for a rising series and 0 for a falling one", () => {
  const up = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(rsi(up), 100);
  assert.equal(rsi(up.slice().reverse()), 0);
});

test("atr of constant ranges equals the range", () => {
  const n = 30, bars = { h: Array(n).fill(11), l: Array(n).fill(9), c: Array(n).fill(10) };
  assert.equal(atr(bars), 2);
});

test("perf is percent change over n sessions", () => {
  assert.equal(perf([100, 110, 121], 2), 21);
});

test("snapshot round-trips with NaN and 4-byte alignment", () => {
  const bytes = writeSnapshot({ asof: "2026-10-21", built: "x", symbols: ["A", "B"], names: ["a", "b"], exchanges: ["N", "Q"], etf: [0, 1],
    columns: { price: Float32Array.of(1.5, NaN), volume: Float32Array.of(10, 20) } });
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  const { header, col } = readSnapshot(ab);
  assert.equal(header.rows, 2);
  assert.equal(col("price")[0], 1.5);
  assert.ok(Number.isNaN(col("price")[1]));
  assert.deepEqual([...col("volume")], [10, 20]);
});
