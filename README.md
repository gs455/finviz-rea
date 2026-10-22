# finviz-rea

A standalone, clean-room stock screener with a Charts tab, built for Arman.
Inspired by the behaviour of commercial screeners; it contains no third-party code, assets or logos.

Status: **Phase 0 (spike and decisions).** No app code yet.

- Plan and phases: see `PROGRESS.md`, and the Phase 0 findings in `docs/PHASE0.md`.
- Verified free-tier limits with source links: `docs/LIMITS.md`.
- Raw data samples used for measurements: `docs/samples/`.
- CPU benchmarks: `scripts/bench/` (run with `node scripts/bench/run.mjs`).

Planned stack: Cloudflare Pages (static files plus Functions), one R2 bucket for the nightly snapshot,
GitHub Actions for data jobs, Alpaca market data (free plan) with a Yahoo backup.
Plain readable ES modules; no bundler and no minified code.

Access is through the Arman hub sign-in only (no separate login).

Never commit secrets. Keys go into GitHub or Cloudflare Pages secrets.
