// Writes public/history.json: per-commit file diffs for the "Code history" dialog (oldest first).
// Binary/large files (samples, lockfiles) are skipped; each diff is truncated.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });
const SKIP = /^(docs\/samples|runs|public\/history\.json)/;
const MAX_DIFF = 6000;

const commits = git("log", "--reverse", "--format=%h|%ad|%s", "--date=short").trim().split("\n").map((line) => {
  const [hash, date, ...subject] = line.split("|");
  const files = git("show", "--format=", "--name-only", hash).trim().split("\n")
    .filter((f) => f && !SKIP.test(f))
    .map((file) => {
      let diff = git("show", "--format=", hash, "--", file);
      if (diff.length > MAX_DIFF) diff = diff.slice(0, MAX_DIFF) + "\n… (truncated)";
      return { file, diff };
    });
  return { hash, date, subject: subject.join("|"), files };
});
fs.writeFileSync("public/history.json", JSON.stringify({ commits }, null, 1) + "\n");
console.log(`history: ${commits.length} commits`);
