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

## Run 5 (2026-10-22): Phase 2 end to end = PASS
Evidence: `shots/c_phase2.png` (fv-rea.pages.dev with proxy header, headless Chrome via CDP): default preset Top Gainers AH, price>1, avg vol>50K, `#1 / 200 Total`, grid STAK (AH +59.00%, matches the reference screenshot), HTCO, NCPL, QSU, USGO, SNAL, AKAN, CRDF with candles/volume.
- **R2 binding** `DATA` -> finviz-rea-data added to fv-rea production + preview via Pages API (PATCH deployment_configs.r2_buckets); took effect on the next deploy.
- **/api/screen** (`functions/api/screen.js`, `functions/lib/{screen,store}.js`): params `s` signal, `f` filters (`sh_price_o|u`, `sh_avgvol` in K, `sh_curvol`, `ta_change`; `c` prefix accepted; unknown go to `ignored`), `o` order (`-` desc), `t` tickers, `r` first row, `n` page size (max 200). Signals: ta_topgainers_ah / ta_toplosers_ah / ta_topgainers / ta_toplosers / ta_mostactive; signal lists capped at 200 (so "Total" shows 200 when more match; Finviz caps similarly). Snapshot and AH objects decoded once per isolate, revalidated by `head()` etag at most every 60 s (R2 Class B only, no KV).
- **CPU** on the real 2.1 MB / 11,115-row snapshot, Node 22: header+typed-array decode 5 ms (once per isolate); screen warm median 2.1 ms (p95 4.7) for the AH preset, 1.4 ms no-signal filter, 4.7 ms ordering ~8k rows by change; first call in a fresh process ~15 ms (JIT + symbol index). Live: 6 calls incl. cold, all 200, no CPU-limit errors; total 219-453 ms, dominated by R2 I/O (`Server-Timing store;dur`; `screen;dur` reads 0.0 because Workers' clock does not advance during CPU). Risk to watch: cold-isolate CPU near 10 ms; fallback = Cache API on the response keyed by etags, or precompute signal lists in the job.
- **AH job** `jobs/ah.mjs` + `.github/workflows/ah.yml` (crons 21:30, 23:00 UTC Mon-Fri, 01:30 UTC Tue-Sat; manual dispatch takes `date`). 15Min SIP bars from 16:00 ET to min(20:00 ET, now-16 min), 100 symbols per call (113 calls), then daily bars only for symbols with AH trades (regular close; QS = 3.98 matches the reference). Output `ah/latest.bin` (SNP1 format, 7,251 symbols, 193,392 bytes) + `ah/meta.json`. Local dry run (full universe, `--date 2026-10-21`): 187 calls, 75 s. Dispatched ONCE (run 39730891666): success, identical numbers. Alpaca calls: 187 at ~150/min.
- **Free limits added**: R2 Class A: +2 PUT per AH run (6 per weekday), nightly 3 PUT + prune deletes; Class B: head()s from the Function (about 2 per minute per active isolate), a few GETs per new snapshot per isolate. Actions minutes: AH run ~2 min x 3/weekday + nightly ~3 min; the repo is public so Actions minutes are free. Functions: unchanged order of magnitude (grid = 1 screen call + 8-ish bars calls per page).
- **UI**: Signal, Order by + Asc/Desc, Tickers box, Price > and Avg vol > (K) inputs, preset dropdown + Save (localStorage `fv-presets`; default preset is built in), `#page / N Total` from results, header shows AH change, tooltip has company, exchange, regular close, AH %, avg volume. Sector/industry/country/market cap are NOT available: no free source in the pipeline yet (Nasdaq lists carry none; candidates: SEC company tickers/SIC codes, Finnhub profile) -> open item.
- Notes: the AH view's "price" filter applies to the AH price; symbols not in the snapshot (no avg vol) are excluded when an avg-vol filter is set. A 16:00 bar with a few late prints counts as AH volume (STAK-like 0% rows are possible; consider requiring bars from 16:00 on with n>1 later). The status line shows the bars call's timing; the screen call's `Server-Timing` is overwritten.
- Tests: Node 22 14/14 pass (new `test/screen.test.mjs`).

## Next run (run 6)
1. Remaining run-3 UI gaps: Filters panel (descriptive/fundamental/technical from a catalog), layout/refresh polish, STALE-path probe and forced Yahoo check on `/api/bars` (`?src=yahoo` exists), canvas pool.
2. Sector/country/market-cap source (see above); Overview tab.
3. **Hub wiring (card + worker edit in gs455/hub-sites; add `/finviz-rea` to APP_ORIGINS and APP_DERIVED_KEY_PREFIXES) since Phase 2 is PASS.** Only in the final wiring run, per decision 6.
4. Watch the first scheduled AH run (21:30 UTC) and the nightly (02:30 UTC): confirm both succeed on the cron path.

## Run 6 (2026-10-22): RELEASE / hub wiring = DONE
Live: https://armanai.pages.dev/finviz-rea/ (version 0.3.0). Hub change: gs455/hub-sites commit "armanai: add /finviz-rea proxy (derived key) + hub card" (APP_ORIGINS, APP_DERIVED_KEY_PREFIXES, bare-prefix redirect list, seed card "Finviz Rea" in Finances, README + CHANGELOG). The hub deploys by GitHub Action on push (Deploy armanai, run 39817107899: success), not by box wrangler.
Baseline vs after (signed in, HTTP code + size + title); identical except the hub index, which grew by 529 bytes (the new card):
`/` 200 175988 -> 176517; /finviz/ 200 18739; /networth/ 200 6696; /muse-tax-calc/ 200 24271; /devin-wiki/ 200 1080; /tweets/ 200 3119; /crypto/ 200 20538; /drawdown/ 200 9607; /book-library/ 200 504; /mags/ 200 2577; /claude/ 200 12489; /health/ 200 3889; /usage/ 200 65909; /grok/ 200 5993; /GrokTaxCalc/ 200 212980; /todo/ 200 1296; /api/model 200 9678: all unchanged.
Signed out: /finviz-rea/ -> 302 to /__login?next=... Signed in: app HTML 200, /api/screen 200, /api/bars 200, changelog.json, history.json, js, css all 200 (all app URLs are relative, no base-path fix needed).
Screenshots through the live hub path: `shots/live_light.png`, `shots/live_dark.png` (1400x1000, Charts grid STAK/HTCO/NCPL/QSU/USGO/SNAL/AKAN/CRDF), `shots/live_menu.png` (menu open). Script: `scripts/live_shot.mjs` (Node 22).
**Hub card in the LIVE KV model NOT added**: the signed-in hub loads /api/model (KV), the seed row is only the fallback, so the card shows only after the KV model is updated (additive PUT of the latest model, per hub README "Publishing a hub row"). See next steps.
- Menu check: Changelog / Code history / version shown. The menu showed "Version 0.2.0" before this release; 0.3.0 after the deploy.

## Next run (run 7)
1. Add the Finviz Rea row to the published KV model via authenticated /api/model (fetch, append to Finances, PUT, preserve everything).
2. UI gaps: Filters panel, STALE probe, forced Yahoo (`?src=yahoo`), canvas pool, hover crosshair; theme should use the hub-wide `armanai-theme` localStorage key.
3. Sector/country/market cap source; Overview tab.
4. Confirm the first scheduled AH (21:30 UTC) and nightly (02:30 UTC) runs succeeded.

## BLOCKERS
None.
