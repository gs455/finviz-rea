# PROGRESS: finviz-rea

Read this first in every run. Plan: `/workspace/rea/finviz-screener/plan-v2/PLAN.md` (decisions are at the top). Phase 0 details: `docs/PHASE0.md`. Limits: `docs/LIMITS.md`.

## Status (after run 1, 2026-10-21)

**Phase 0 is done. Phase 1 (Charts tab) has not started.**

### Done
- PLAN.md and QUESTIONS.md updated with Arman's 10 decisions (names, phase order Charts -> Phase 2 -> hub wiring -> Overview, Tech. Analysis toggle, no logos, theme toggle) and the Phase 0 numbers (limits section 9 corrected, `[verify]` tags resolved for Cloudflare, GitHub, Alpaca).
- Local git repo created in `/workspace/finviz-rea` (no remote yet), git user `grokbot-main`.
- `docs/LIMITS.md`, `docs/PHASE0.md`, `docs/samples/` (7 Yahoo samples), `scripts/bench/` (fixtures, normalize, screener, runner), `docs/bench-output.txt`.

### Phase 0 gates
| Gate | Verdict |
|---|---|
| CPU | **GO, with design changes** (below) |
| Data source | **CONDITIONAL GO**: Alpaca confirmed from docs but untested (no keys); Yahoo works now |
| Limits | **GO** |
| Credentials | **GO** for repo, Actions, secrets; Pages write and R2 bucket creation untested (read-only run) |

### Measured numbers (Node 20 on a Xeon; apply a 2x safety factor for Workers)
- `/api/bars` normalize (parse + normalize + stringify), median: 4x350 bars 1.5 ms; 8x350 3.0 ms; 4x640 2.7 ms; **8x640 5.8 ms (p95 up to 8, outlier 11: too tight)**; 44x640 31 ms (no-go).
- `/api/screener` on 5,600 rows: **binary snapshot ~2 ms median (~5 ms cold)**; one JSON text 15-17 ms (no-go).
- Yahoo chart endpoint: 7 calls, all 200, 0.14-0.18 s each, 32-60 KB per ticker for 5m/5d, 200-260 KB for 1m/5d; pre/post market 04:00-20:00 ET present on all 5 sessions; thin ticker STAK has 29 % null bars; no 3-minute interval; last bar was the 19:59 ET close tick (effectively real-time).
- Alpaca free (docs): free, IEX real-time only, SIP delayed 15 min, 200 calls/min, since 2016, `3Min` native, `limit` 10,000 total across symbols (sorted by symbol first).

### Decisions (Arman, 2026-10-21) and design decisions taken from Phase 0
- Arman: Alpaca yes (15-min delay OK; keys as env vars, Yahoo backup if missing); IEX real-time tail in Phase 5; Pages project `fv-rea`; R2 bucket `finviz-rea-data`; public repo `gs455/finviz-rea` with Actions; Claude does hub card + worker edit **only in the final wiring run, and only after Phase 2 works end to end**; Tech. Analysis toggle cycles none / support-resistance / trend lines; light/dark icon toggle, light default; Overview first after Charts; News, Snapshot, Maps, Stats are placeholders; **no logos of any kind**.
- Phase 0 consequences: `/api/bars` carries at most 8 tickers and ~3,000 bars per call (4 tickers when more bars, and on the Yahoo fallback); snapshot is binary only (no JSON fallback); SWR is hand-written because `cache.put` does not support `stale-while-revalidate`; Alpaca adapter must set `limit=10000`, bound `start`, follow `next_page_token`; GitHub crons at odd minutes with `timezone: America/New_York`; log CPU via `Server-Timing` from day one; use `_routes.json` so static files do not invoke Functions.
- Phase 1 is developed against `fv-rea.pages.dev` only (no hub link until the wiring run).

## Credentials and access (checked read-only; no values recorded)
- `gh`: logged in as `gs455`, scopes `gist, read:org, repo, workflow`: can create the public repo, set Actions secrets, add workflows. `gs455/finviz-rea` does not exist yet.
- `CLOUDFLARE_PAGES_TOKEN`: valid; cannot list accounts, R2, KV or D1; **can list Pages projects** (needs the account id). `fv-rea` is not taken. Pages **write** (project create / deploy) not yet tested.
- `CF_R2_TOKEN` (env, found this run): lists the one account (use it to get the account id: `GET /client/v4/accounts`), R2 buckets (existing: `devin-wiki-rewrites`, `drawdown-history`, so R2 is enabled), KV namespaces, Workers. Bucket create not tested.
- Env: `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` are **missing**. `HUB_PASSWORD` is set (not used yet).
- The account id is not written anywhere in the repo; fetch it with the `CF_R2_TOKEN` call above when needed.

## BLOCKERS (need Arman)
1. **Alpaca API keys are missing** (soft blocker). Not stopping Phase 1: the Yahoo adapter is real-time and works, and the code is written against the Alpaca env vars. Needed before the Alpaca adapter can be verified (3-minute bars, pre/post coverage, real latency and payload size) and before Phase 2's nightly job gets daily bars. Arman: create a free Alpaca account (paper keys are enough) and provide `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` as env vars on this box, and later as GitHub Actions secrets in `gs455/finviz-rea` (Claude can set the GitHub secrets from the env vars, never printing them).
2. Possible later: if the Pages token cannot set the R2 binding `DATA` or create the Pages project, that dashboard step is Arman's. Unknown until tried in run 2.

## Next run (run 2) must do: Phase 1 start
1. Read this file and PLAN.md sections 1, 2, 5, 6, 7.
2. Create `gs455/finviz-rea` (public) and push; set up GitHub secrets for the deploy (Cloudflare token + account id) without printing them; run the secret scan before every commit.
3. Create the Pages project `fv-rea` (first write call; if the Pages token lacks edit rights, record it under BLOCKERS), add `functions/_middleware.js` (hub header gate) and `HUB_PROXY_KEY` secret, `_routes.json` for `/api/*`, deploy workflow.
4. Live-probe the Cache API on `fv-rea.pages.dev` (`X-Cache` header on a repeat call) and record the result.
5. Build in this order: session calendar + tests, Yahoo adapter + `/api/bars` (batch rule above) with `Server-Timing`, canvas renderer, grid, controls (3M default, Tech. Analysis cycle toggle, light/dark icon toggle, home icon, `⋯` menu with Changelog Brief/Full oldest first, Code history, version), then placeholders for the other tabs. No logos. Compact one-line rows with ellipsis + hover text.
6. Do not wire into the hub (decision 7). Do not create the R2 bucket until Phase 2 needs it.

## Log
- 2026-10-21 run 1: plan update + Phase 0 (this file's first version).
