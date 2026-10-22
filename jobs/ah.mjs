// After-hours job. Usage: node jobs/ah.mjs [--date YYYY-MM-DD] [--out DIR] [--limit N]
//   --date D    trading date (ET) to process; default today in New York
//   --out DIR   write ah.bin and meta.json to DIR instead of R2 (local/dry run)
//   --limit N   only the first N universe symbols (testing)
// For every universe symbol with trades after 16:00 ET it stores: last AH price, AH high/low, AH volume and the
// regular close (the day's Alpaca daily bar). Output is ONE small object ah/latest.bin (SNP1 format, only symbols
// with AH trades) plus ah/meta.json. Env as nightly.mjs. KV is never touched.
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadUniverse } from "./lib/universe.mjs";
import { dailyBars, barsBetween, stats } from "./lib/alpaca.mjs";
import { writeSnapshot } from "./lib/snapshot.mjs";

const BUCKET = "finviz-rea-data", BATCH = 100, DELAY_MIN = 16;
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const outDir = arg("--out"), limit = Number(arg("--limit") || 0);

const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

/** UTC instant of `hour`:00 New York time on `date` (handles EDT/EST by trying both offsets). */
function etInstant(date, hour) {
  for (const offset of [4, 5]) {
    const t = new Date(`${date}T${String(hour + offset).padStart(2, "0")}:00:00Z`);
    const back = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(t);
    if (Number(back) % 24 === hour) return t;
  }
  throw new Error("cannot resolve ET time");
}

function r2(...cmd) {
  return execFileSync("npx", ["wrangler@3", "r2", "object", ...cmd], { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

async function main() {
  const t0 = Date.now();
  const date = arg("--date") || etDate(new Date());
  const from = etInstant(date, 16), session = etInstant(date, 20);
  const to = new Date(Math.min(session.getTime(), Date.now() - DELAY_MIN * 60e3));
  if (to <= from) { console.log(`nothing to do: no delayed after-hours data yet for ${date}`); return; }

  const spy = (await dailyBars(["SPY"], date, process.env)).SPY;
  if (!spy || !spy.d.includes(date)) { console.log(`${date} is not a trading day (no SPY daily bar): nothing written`); return; }

  let universe = await loadUniverse();
  if (limit) universe = universe.slice(0, limit);
  console.log(`universe ${universe.length}, window ${from.toISOString()} .. ${to.toISOString()}`);

  // Step 1: 15-minute bars after 16:00 ET, 100 symbols per call; most symbols have none.
  const active = new Map(); // symbol -> { last, high, low, volume }
  for (let i = 0; i < universe.length; i += BATCH) {
    const bars = await barsBetween(universe.slice(i, i + BATCH).map((u) => u.symbol), "15Min", from.toISOString(), to.toISOString(), process.env);
    for (const [sym, list] of Object.entries(bars)) {
      const volume = list.reduce((a, b) => a + b.v, 0);
      if (!volume) continue;
      active.set(sym, { last: list[list.length - 1].c, high: Math.max(...list.map((b) => b.h)), low: Math.min(...list.map((b) => b.l)), volume });
    }
    if ((i / BATCH) % 20 === 0) console.log(`ah batch ${i / BATCH + 1}/${Math.ceil(universe.length / BATCH)}: active ${active.size}, calls ${stats.calls}`);
  }

  // Step 2: regular close = the day's daily bar, only for symbols with AH trades.
  const symbols = [...active.keys()].sort(), regClose = new Map();
  for (let i = 0; i < symbols.length; i += BATCH) {
    const bars = await dailyBars(symbols.slice(i, i + BATCH), date, process.env);
    for (const [sym, b] of Object.entries(bars)) {
      const k = b.d.indexOf(date);
      if (k >= 0) regClose.set(sym, b.c[k]);
    }
  }
  const kept = symbols.filter((s) => regClose.has(s));
  const col = (f) => Float32Array.from(kept, f);
  const bytes = writeSnapshot({
    asof: date, built: new Date().toISOString(), symbols: kept, names: [], exchanges: [], etf: [],
    columns: { regClose: col((s) => regClose.get(s)), ahLast: col((s) => active.get(s).last), ahHigh: col((s) => active.get(s).high),
      ahLow: col((s) => active.get(s).low), ahVolume: col((s) => active.get(s).volume) },
  });
  const meta = { date, built: new Date().toISOString(), windowEnd: to.toISOString(), rows: kept.length, noDaily: symbols.length - kept.length,
    bytes: bytes.length, alpacaCalls: stats.calls, seconds: Math.round((Date.now() - t0) / 1000) };

  const dir = outDir || mkdtempSync(join(tmpdir(), "ah-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ah.bin"), bytes);
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  if (!outDir) {
    r2("put", `${BUCKET}/ah/latest.bin`, "--file", join(dir, "ah.bin"), "--content-type", "application/octet-stream");
    r2("put", `${BUCKET}/ah/meta.json`, "--file", join(dir, "meta.json"), "--content-type", "application/json"); // last
  }
  console.log(JSON.stringify(meta));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
