// CPU bench: parse + normalize + stringify an Alpaca multi-symbol bars payload.
import fs from "node:fs";
const raw = fs.readFileSync(process.argv[2], "utf8");
function run() {
  const j = JSON.parse(raw);
  const out = {};
  for (const [sym, bars] of Object.entries(j.bars)) {
    out[sym] = {
      t: bars.map(b => Math.floor(Date.parse(b.t) / 1000)),
      o: bars.map(b => b.o), h: bars.map(b => b.h),
      l: bars.map(b => b.l), c: bars.map(b => b.c), v: bars.map(b => b.v),
    };
  }
  return JSON.stringify(out).length;
}
for (let i = 0; i < 20; i++) run();
const times = [];
let size = 0;
for (let i = 0; i < 200; i++) { const s = performance.now(); size = run(); times.push(performance.now() - s); }
times.sort((a, b) => a - b);
console.log(`payload ${raw.length} B -> ${size} B; median ${times[100].toFixed(2)} ms, p95 ${times[190].toFixed(2)} ms`);
