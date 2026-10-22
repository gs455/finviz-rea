import test from "node:test";
import assert from "node:assert/strict";
import { writeSnapshot, readSnapshot } from "../jobs/lib/snapshot.mjs";
import { screen, parseFilters } from "../functions/lib/screen.js";

const decode = (bytes) => readSnapshot(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const f32 = (...v) => Float32Array.from(v);

const snap = decode(writeSnapshot({
  asof: "2026-10-21", built: "x", symbols: ["AAA", "BBB", "CCC", "DDD"], names: ["Aaa Inc", "Bbb Inc", "Ccc Inc", "Ddd Inc"],
  exchanges: ["NYSE", "NASDAQ", "NYSE", "AMEX"], etf: [0, 0, 0, 0],
  columns: { price: f32(10, 0.5, 2, 5), change: f32(1, 2, -3, 4), volume: f32(100, 200, 300, 400), avgVol: f32(60000, 90000, 40000, 70000) },
}));
const ah = decode(writeSnapshot({
  asof: "2026-10-21", built: "y", symbols: ["AAA", "BBB", "CCC", "ZZZ"], names: [], exchanges: [], etf: [],
  columns: { regClose: f32(10, 0.5, 2, 1), ahLast: f32(11, 0.9, 2.2, 3), ahVolume: f32(500, 900, 100, 50) },
}));

test("filters parse and unknown ones are reported", () => {
  const p = parseFilters("sh_price_o1,csh_avgvol_o50,bogus");
  assert.equal(p.rules.length, 2);
  assert.deepEqual(p.ignored, ["bogus"]);
});

test("Top Gainers AH with price>1 and avg vol>50K", () => {
  const r = screen(snap, ah, { s: "ta_topgainers_ah", f: "sh_price_o1,sh_avgvol_o50" });
  // BBB fails price (0.9), CCC fails avg vol, ZZZ has no snapshot row (NaN avg vol): only AAA is left.
  assert.deepEqual(r.rows.map((x) => x[0]), ["AAA"]);
  assert.equal(r.total, 1);
  assert.equal(r.rows[0][r.cols.indexOf("ahChange")], 10);
});

test("order and paging", () => {
  const r = screen(snap, null, { o: "-price", n: "2", r: "2" });
  assert.deepEqual(r.rows.map((x) => x[0]), ["DDD", "CCC"]);
  assert.equal(r.total, 4);
  assert.deepEqual(screen(snap, null, { o: "nonsense" }).ignored, ["o=nonsense"]);
});

test("RSI, SMA relation and exchange filters", () => {
  const rich = decode(writeSnapshot({
    asof: "2026-10-21", built: "x", symbols: ["AAA", "BBB", "CCC"], names: ["a", "b", "c"], exchanges: ["NYSE", "NASDAQ", "NASDAQ"], etf: [0, 0, 0],
    columns: { price: f32(10, 5, 8), change: f32(1, 2, 3), volume: f32(1, 1, 1), avgVol: f32(1, 1, 1), rsi: f32(25, 50, 75),
      sma20: f32(9, 6, 7), sma50: f32(9, 6, 7), sma200: f32(NaN, 6, 7) },
  }));
  const names = (f) => screen(rich, null, { f }).rows.map((x) => x[0]);
  assert.deepEqual(names("ta_rsi_u30"), ["AAA"]);
  assert.deepEqual(names("ta_rsi_o70"), ["CCC"]);
  assert.deepEqual(names("ta_sma50_pa"), ["AAA", "CCC"]);
  assert.deepEqual(names("ta_sma200_pb"), ["BBB"]);
  assert.deepEqual(names("exch_nasd"), ["BBB", "CCC"]);
  assert.deepEqual(screen(rich, null, { f: "ta_sma50_pa", s: "ta_topgainers" }).rows.map((x) => x[0]), ["CCC", "AAA"]);
});
