# PROGRESS: finviz-rea

Read this first in every run. Plan: `/workspace/rea/finviz-screener/plan-v2/PLAN.md`. Phase 0 details: `docs/PHASE0.md` (incl. Alpaca verification). Limits: `docs/LIMITS.md`.

## Status (after run 2, 2026-10-22)

**Phase 0 done (data gate: GO, Alpaca primary, Yahoo fallback). Phase 1 (Charts tab) first version is deployed at https://fv-rea.pages.dev (gated, see below). Not wired into the hub.**

### Done in run 2
- Alpaca verified with real keys (3 calls): SIP 3Min 5 symbols x 5 days = 3,731 bars, 0.31 s, 374 KB; IEX same = 138 KB (STAK 24 bars vs 349 on SIP: IEX useless for thin tickers); 1Day 5 symbols 11.6 KB, 0.23 s. CPU bench on that payload: median 3.95 ms, p95 5.2 ms (Node). Samples in `docs/samples/alpaca_*`.
- Public repo `gs455/finviz-rea` created and pushed. Actions secrets set: `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `CLOUDFLARE_API_TOKEN` (= the Pages token), `CLOUDFLARE_ACCOUNT_ID`. `scripts/secret_scan.sh` (run before every commit; checks env values + key patterns).
- Pages project `fv-rea` created (Pages token CAN create/deploy). Secrets set on production + preview through the Pages API: `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `HUB_PROXY_KEY` (= hex HMAC-SHA256 of `armanai-proxy-key:/finviz-rea` keyed with the hub password, same derived scheme as devin-wiki; the hub worker must recompute it with prefix `/finviz-rea` in the wiring run, add it to APP_DERIVED_KEY_PREFIXES).
- Code: `functions/lib/{calendar,timeframes,alpaca,yahoo,swr}.js`, `functions/api/bars.js`, `functions/_middleware.js` (hub gate: direct HTML visits 301 to armanai.pages.dev/finviz-rea, other requests 401 without `X-Hub-Proxy-Key`), `public/` (index.html, style.css, js/{app,chart,indicators,session}.js, changelog.json, history.json built by `scripts/build_history.mjs`), `test/calendar.test.mjs` (6 tests pass), `.github/workflows/deploy.yml` (tests, history, wrangler deploy on push to main; NOT yet run in Actions).
- Deploy from the box: `mkdir -p node_modules/.cache; CLOUDFLARE_API_TOKEN=$CLOUDFLARE_PAGES_TOKEN CLOUDFLARE_ACCOUNT_ID=<id from CF_R2_TOKEN GET /accounts> npx wrangler@3 pages deploy public --project-name fv-rea --branch main --commit-dirty=true` (wrangler 4 needs Node 22; the box has Node 20; the Actions workflow uses Node 22 + latest).
- Live probes on fv-rea.pages.dev (with the proxy header): `/api/bars?t=AAPL,F&tf=3M` MISS 72 ms, then HIT 21 ms and 14 ms (**Cache API works on pages.dev**, `X-Cache`, `Age-Seconds`, `Server-Timing`). Other timeframes (1M, 5M, 1H, W, D) all 200 in 0.19-0.27 s end to end, 9-49 KB. Unauthenticated: JSON 401, HTML 301. The STALE path (age > 30 s) was not observed yet.
- Batch rule: server rejects > 8 tickers or tickers x estimateBars(tf) > 3,200 (400). 3M default window 5 days -> estimate 1,280/ticker -> 2 tickers per call; client mirrors the table in `app.js` (`BARS_PER_TICKER`).

### Not verified / known gaps (next run)
- **The UI has not been looked at in a browser** (the gate blocks direct visits; Chrome is at /usr/bin/google-chrome, no Playwright). Next run: screenshot with `--extra-http-headers`-style approach (e.g. a small puppeteer/CDP script adding the `X-Hub-Proxy-Key` header) and fix layout bugs. Check: canvas sizing (`.cell canvas` flex height), pager, tabs placeholders, theme icon, menu, Changelog/History dialogs.
- Tooltip shows last/change/volume only; company/sector/country/market cap need the Phase 2 snapshot. Presets / Order by / Signal / Filters button are visual only until Phase 2. Order/Asc/Desc do nothing yet.
- Hover crosshair, canvas pool (cells redraw on intersect; no recycling yet), 1M uses 1,920 bars/ticker (1 ticker per call).
- Yahoo fallback tested only structurally (not forced); session calendar is duplicated client-side in `public/js/session.js` (minutes only). Holiday table covers 2026-2027 only.
- Actions deploy workflow untested. R2 bucket `finviz-rea-data` not created (Phase 2).
- Stale-while-revalidate STALE branch live check.

## STANDING RULES (added run 4)
- Batch commits; one push per logical change.
- Test locally under Node 22 (`npx -y node@22 --test test/*.test.mjs`, `scripts/secret_scan.sh`) before EVERY push.
- Never re-dispatch a workflow without fixing the failure first and verifying locally.
- CI test command is `node --test test/*.test.mjs` (a bare `test/` dir fails on Node 22 with MODULE_NOT_FOUND). `npm test` does the same.

## BLOCKERS (need Arman)
None. (Alpaca keys arrived; Pages write works.)

## Next run (run 3)
1. Browser-check and fix the UI (see gaps), then add hover crosshair + canvas pool.
2. Probe STALE path; force the Yahoo fallback once (e.g. temporary `?src=yahoo` debug param or unset key in preview) and record.
3. Then Phase 2 start (nightly daily-bars job in Actions -> R2 snapshot, Top Gainers AH price>$1 avg vol>50K driving the grid). Do not wire into the hub until Phase 2 works end to end.

## Credentials and access (checked read-only; no values recorded)
- `gh`: logged in as `gs455`, scopes `gist, read:org, repo, workflow`: can create the public repo, set Actions secrets, add workflows. `gs455/finviz-rea` does not exist yet.
- `CLOUDFLARE_PAGES_TOKEN`: valid; cannot list accounts, R2, KV or D1; **can list Pages projects** (needs the account id). `fv-rea` is not taken. Pages **write** (project create / deploy) not yet tested.
- `CF_R2_TOKEN` (env, found this run): lists the one account (use it to get the account id: `GET /client/v4/accounts`), R2 buckets (existing: `devin-wiki-rewrites`, `drawdown-history`, so R2 is enabled), KV namespaces, Workers. Bucket create not tested.
- Env: Alpaca keys are set (run 2). `HUB_PASSWORD` is set.
- The account id is not written anywhere in the repo; fetch it with the `CF_R2_TOKEN` call above when needed.

## Log
- 2026-10-21 run 1: plan update + Phase 0 (this file's first version).
- 2026-10-22 run 2: Alpaca verified, repo + Pages project + secrets, Phase 1 v0.1.0 deployed (UI not yet browser-checked).
- 2026-10-22 run 4: CI fix (explicit test glob in both workflows, package.json added). Local Node 22: 11/11 tests pass, nightly dry run (--limit 300, --out) OK: 291 rows, 55,664 bytes. R2 bucket finviz-rea-data exists; CLOUDFLARE_R2_TOKEN secret is set.
- 2026-10-22 run 4 (cont.): Deploy run 39728083251 passed. Nightly run 39728131105 passed (2m38s): asof 2026-10-21, 11,115 rows of 11,279 universe symbols, snapshot 2,112,192 bytes, 340 Alpaca calls, 2.95M bars, 145 s, no warnings. R2 finviz-rea-data holds snapshot/latest.bin, snapshot/meta.json, snapshot/prev/2026-10-21.bin.

## Next run (run 5)
1. Read snapshot from R2 in a Pages Function (R2 binding on fv-rea: needs adding via Pages API/settings; check) and expose /api/screen (filter + order, Top Gainers AH price>1, avgVol>50K) driving the Charts grid.
2. Wire presets/Order/Signal in the UI; then Overview tab. No hub wiring until Phase 2 works end to end.
3. Remaining run-3 gaps: browser check of UI, STALE path, Yahoo fallback force.
