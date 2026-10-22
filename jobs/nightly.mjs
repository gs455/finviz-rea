// Nightly snapshot job. Usage: node jobs/nightly.mjs [--out DIR] [--limit N]
//   --out DIR   write snapshot.bin and meta.json to DIR instead of R2 (local/dry run)
//   --limit N   only the first N universe symbols (testing)
// Env: ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY; for R2 upload also CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
// Writes: snapshot/<asof>.bin copy, snapshot/latest.bin, then snapshot/meta.json last. KV is never touched.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadUniverse } from "./lib/universe.mjs";
import { dailyBars, stats } from "./lib/alpaca.mjs";
import { sma, rsi, atr, highest, lowest, perf, volatility, beta } from "./lib/indicators.mjs";
import { writeSnapshot } from "./lib/snapshot.mjs";

const BUCKET = "finviz-rea-data", KEEP_COPIES = 14, BATCH = 100, HISTORY_DAYS = 420;
const MIN_ROWS = 3000;
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const outDir = arg("--out"), limit = Number(arg("--limit") || 0);

const COLUMNS = ["price", "prevClose", "change", "open", "high", "low", "volume", "avgVol", "relVol", "gap", "changeOpen",
  "perfWeek", "perfMonth", "perfQuart", "perfHalf", "perfYear", "perfYtd", "sma20", "sma50", "sma100", "sma200",
  "rsi", "atr", "volWeek", "volMonth", "high20", "low20", "high50", "low50", "high52", "low52", "beta", "lastDate"];

function r2(...cmd) {
  return execFileSync("npx", ["wrangler@3", "r2", "object", ...cmd], { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

async function main() {
  const t0 = Date.now();
  let universe = await loadUniverse();
  console.log(`universe: ${universe.length} symbols`);
  if (limit) universe = universe.slice(0, limit);
  const startDate = new Date(Date.now() - HISTORY_DAYS * 86400e3).toISOString().slice(0, 10);

  // SPY first: benchmark for beta and the as-of date.
  const spy = (await dailyBars(["SPY"], startDate, process.env)).SPY;
  if (!spy) throw new Error("SPY missing");
  const asof = spy.d[spy.d.length - 1];
  const bench = new Map(spy.d.map((d, i) => [d, spy.c[i]]));
  const yearStart = `${asof.slice(0, 4)}-01-01`;

  const rows = [];
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = universe.slice(i, i + BATCH);
    const bars = await dailyBars(batch.map((u) => u.symbol), startDate, process.env);
    for (const u of batch) {
      const b = bars[u.symbol];
      if (!b || b.c.length < 2) continue;
      const n = b.c.length;
      if (b.d[n - 1] !== asof) continue; // not traded on the as-of date (halted, delisted)
      const last = b.c[n - 1], prev = b.c[n - 2], avgVol = n > 1 ? sma(b.v.slice(0, -1), Math.min(63, n - 1)) : NaN;
      const ytdIdx = b.d.findIndex((d) => d >= yearStart);
      const base = ytdIdx > 0 ? b.c[ytdIdx - 1] : NaN;
      const v = {
        price: last, prevClose: prev, change: (last / prev - 1) * 100, open: b.o[n - 1], high: b.h[n - 1], low: b.l[n - 1],
        volume: b.v[n - 1], avgVol, relVol: b.v[n - 1] / avgVol, gap: (b.o[n - 1] / prev - 1) * 100,
        changeOpen: (last / b.o[n - 1] - 1) * 100,
        perfWeek: perf(b.c, 5), perfMonth: perf(b.c, 21), perfQuart: perf(b.c, 63), perfHalf: perf(b.c, 126), perfYear: perf(b.c, 252),
        perfYtd: (last / base - 1) * 100,
        sma20: sma(b.c, 20), sma50: sma(b.c, 50), sma100: sma(b.c, 100), sma200: sma(b.c, 200),
        rsi: rsi(b.c), atr: atr(b),
        volWeek: volatility(b.c, 5), volMonth: volatility(b.c, 21),
        high20: highest(b.h, 20), low20: lowest(b.l, 20), high50: highest(b.h, 50), low50: lowest(b.l, 50),
        high52: highest(b.h, 252), low52: lowest(b.l, 252),
        beta: beta(b.d, b.c, bench),
        lastDate: Date.parse(b.d[n - 1]) / 86400e3,
      };
      rows.push({ u, v });
    }
    if ((i / BATCH) % 10 === 0) console.log(`batch ${i / BATCH + 1}/${Math.ceil(universe.length / BATCH)}: rows ${rows.length}, calls ${stats.calls}`);
  }

  const columns = Object.fromEntries(COLUMNS.map((c) => [c, Float32Array.from(rows, (r) => r.v[c] ?? NaN)]));
  const snapshot = writeSnapshot({
    asof, built: new Date().toISOString(),
    symbols: rows.map((r) => r.u.symbol), names: rows.map((r) => r.u.name),
    exchanges: rows.map((r) => r.u.exchange), etf: rows.map((r) => (r.u.etf ? 1 : 0)), columns,
  });
  const sha256 = createHash("sha256").update(snapshot).digest("hex");

  // Validation: a failed check publishes nothing and the previous object stays live.
  const dir = outDir || mkdtempSync(join(tmpdir(), "snap-"));
  mkdirSync(dir, { recursive: true });
  let prevMeta = null;
  if (!outDir) {
    try { r2("get", `${BUCKET}/snapshot/meta.json`, "--file", join(dir, "prev-meta.json")); prevMeta = JSON.parse(readFileSync(join(dir, "prev-meta.json"), "utf8")); }
    catch { console.log("no previous meta.json (first run)"); }
  }
  const warnings = [];
  const spyRow = rows.some((r) => r.u.symbol === "SPY");
  if (!limit) {
    if (rows.length < MIN_ROWS) throw new Error(`validation: only ${rows.length} rows`);
    if (prevMeta && rows.length < prevMeta.rows * 0.95) throw new Error(`validation: ${rows.length} rows < 95% of ${prevMeta.rows}`);
    if (prevMeta && asof < prevMeta.asof) throw new Error(`validation: asof ${asof} older than ${prevMeta.asof}`);
    if (!spyRow) throw new Error("validation: SPY not in rows");
  }
  const priced = rows.filter((r) => Number.isFinite(r.v.price)).length;
  if (priced / rows.length < 0.98) warnings.push(`only ${priced}/${rows.length} rows have a price`);

  const copies = [...new Set([...(prevMeta?.copies || []), asof])].sort();
  const pruned = copies.length > KEEP_COPIES ? copies.splice(0, copies.length - KEEP_COPIES) : [];
  const meta = { asof, built: new Date().toISOString(), rows: rows.length, schema: 1, bytes: snapshot.length, sha256, warnings, copies,
    alpacaCalls: stats.calls, alpacaBars: stats.bars, seconds: Math.round((Date.now() - t0) / 1000) };

  writeFileSync(join(dir, "snapshot.bin"), snapshot);
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  if (!outDir) {
    r2("put", `${BUCKET}/snapshot/prev/${asof}.bin`, "--file", join(dir, "snapshot.bin"), "--content-type", "application/octet-stream");
    r2("put", `${BUCKET}/snapshot/latest.bin`, "--file", join(dir, "snapshot.bin"), "--content-type", "application/octet-stream");
    r2("put", `${BUCKET}/snapshot/meta.json`, "--file", join(dir, "meta.json"), "--content-type", "application/json"); // last
    for (const d of pruned) { try { r2("delete", `${BUCKET}/snapshot/prev/${d}.bin`); } catch (e) { console.log(`prune ${d} failed`); } }
  }
  console.log(JSON.stringify(meta));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
