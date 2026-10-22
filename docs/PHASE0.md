# Phase 0 results (2026-10-21)

Scope of this run: verify limits, test a data source with a handful of calls, measure CPU, check credentials read-only. No app code, no deploy, no repo on GitHub, no bucket, no hub change.

## Go / no-go summary

| Gate | Verdict | One line |
|---|---|---|
| CPU | **GO, with two design changes** | `/api/bars` normalize fits if a call carries at most ~2,800 bars (8 tickers x 350 bars, ~3 ms median) or 4 tickers x 640 bars (~2.8 ms). The snapshot **must** be the binary format (~2 ms); plain JSON (~15 ms) is out. |
| Data source | **GO (Alpaca primary, Yahoo fallback)** | Alpaca verified in run 2 with real keys (section below). |
| Limits | **GO** | Every figure in PLAN section 9 checked against official docs; none is worse than assumed. Three corrections (below). |
| Credentials | **GO for repo + Pages + R2 binding work, with notes** | `gh` can create the repo (`repo`, `workflow` scopes). `CLOUDFLARE_PAGES_TOKEN` is valid and lists Pages projects, but cannot read the account list or R2/KV. `CF_R2_TOKEN` (found in the environment) lists accounts, R2 buckets, KV and Workers; R2 is already enabled on the account. Bucket creation and Pages deploy were not tried (read-only run). |

## 1. Limits (details and URLs in `LIMITS.md`)

Everything the plan marked **[verify]** matched, except:

1. **`cache.put`/`cache.match` do not support `stale-while-revalidate` / `stale-if-error`.** The plan's SWR has to be hand-written (freshness timestamp in a header, refresh through `ctx.waitUntil`).
2. **Cache API calls count toward the same 50-per-request quota as subrequests.** The planned 8-ticker call (1 upstream + 8 match + 8 put = 17) is still fine; a 44-ticker single call would not be (88).
3. **Alpaca `limit` (max 10,000) is a total across all symbols and results are sorted by symbol first**, so one page may hold only the first symbols. The adapter must always set `limit=10000`, bound `start`, and follow `next_page_token`.

New useful facts: GitHub cron supports an IANA `timezone` (no manual DST shift) and schedules are dropped/delayed around the top of the hour (use odd minutes); Pages Functions have a working Cache API on `*.pages.dev`; R2 is already enabled on this account (two buckets exist), so the "card on file" worry is moot here.

## 2. Data-source test

`ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` are **not set**, so per the standing rules the Yahoo chart endpoint was used. 7 calls total (limit was ~20), made from this box; the endpoint answered 200 every time.

Samples (raw JSON, no secrets) are in `docs/samples/`:

| Sample | Interval/range | Bytes | Time | Bars | Null bars | Zero-volume bars |
|---|---|---|---|---|---|---|
| AAPL | 5m / 5d | 60,130 | 0.17 s | 949 | 0 | 561 |
| F | 5m / 5d | 54,729 | 0.15 s | 822 | 0 | 432 |
| NCPL | 5m / 5d | 56,936 | 0.16 s | 949 | 1 | 562 |
| QS | 5m / 5d | 49,678 | 0.15 s | 758 | 0 | 368 |
| STAK (thin) | 5m / 5d | 32,122 | 0.14 s | 496 | **142** | 251 |
| AAPL | 1m / 5d | 261,377 | 0.18 s | 4,057 | 0 | 2,102 |
| QS | 1m / 5d | 201,291 | 0.15 s | 2,759 | 1 | 806 |

Findings:
- **Fields:** `chart.result[0]` has `meta` (32 keys including `regularMarketTime`, `chartPreviousClose`, `previousClose`, `exchangeTimezoneName`, `currentTradingPeriod.{pre,regular,post}`, `tradingPeriods`, `longName`), `timestamp[]` (epoch seconds) and `indicators.quote[0].{open,high,low,close,volume}`. About 65 bytes per bar of JSON.
- **Extended hours: yes.** With `includePrePost=true` every liquid ticker has bars from 04:00 to 19:55-19:59 ET on all 5 sessions (the last bar on a day is stamped at the last tick, for example 19:59). The sessions line up with the plan's 04:00-20:00 grid.
- **Gap handling differs by liquidity.** Liquid and mid names come back already gap-filled (about half of the bars are zero-volume carry-forward bars); the thin name STAK has 142 of 496 bars with `null` OHLC and starts as late as 05:00 on some days. The adapter must treat `null` as "no trade" (same as an absent Alpaca bar) and the client does its own carry-forward fill.
- **No 3-minute interval.** 1m covers about 5-8 days, so a 3M chart means aggregating 1m (200-260 KB per ticker for 5 days, so 44 tickers is ~10 MB: only workable in batches or per ticker in the browser, one reason Alpaca stays primary).
- **One ticker per call**, ~0.15 s each from this box. 44 tickers = 44 calls (and the Pages subrequest limit is 50). Fine as an emergency fallback only.
- **Delay:** Yahoo's last bar was the 19:59 ET close tick, i.e. effectively real-time. That is *better* than the free Alpaca SIP feed (15 min behind), which makes Yahoo attractive but unofficial; keep it as fallback and note the difference in the UI chip.
- Alpaca: not called. Latency, payload size, extended-hours coverage and the 3-minute bars are **unverified until keys exist**.

## 3. CPU measurement (`scripts/bench/`, `node scripts/bench/run.mjs 500`)

Method: Node 20 on an 8-core Xeon (not Workers). Fixtures are built from the recorded samples (`fixtures.mjs`): Alpaca-shaped JSON (`{"bars":{"SYM":[{c,h,l,n,o,t,v,vw}]}}`, trade bars only, aggregated to 3 minutes) replicated to N symbols, and a fake 5,600-row snapshot with 70 float32 columns. 500 iterations each; the table is the median of two full runs (full output in `docs/bench-output.txt`; single runs vary by about 10-15 %).

`/api/bars` step = `JSON.parse` + per-bar normalize (ISO date to epoch, rounding, session volume, regular close) + `JSON.stringify` per ticker:

| Payload | JSON size | Parse only | + normalize | + stringify (what a miss costs) | p95 | Max seen |
|---|---|---|---|---|---|---|
| 4 tickers x 350 bars | 149 KB | ~0.7 ms | ~1.0 ms | **~1.5 ms** | 2.0 ms | 3.0 ms |
| 8 tickers x 350 bars | 295 KB | ~1.3 ms | ~1.8 ms | **~3.0 ms** | 3.5-6.3 ms | 11 ms |
| 4 tickers x 640 bars | 268 KB | 1.2 ms | 1.7 ms | **~2.7 ms** | 3.3 ms | 4.9 ms |
| 8 tickers x 640 bars (plan: 5,120 bars, 546 KB) | 546 KB | 2.5 ms | 3.4 ms | **~5.8 ms** | 6.7-8.2 ms | 11.3 ms |
| 44 tickers x 640 bars | 2,990 KB | 14 ms | 20 ms | **~31 ms** | 35 ms | 53 ms |

(The very first iteration in a fresh process, the JIT-cold case, is 1.0-1.5x the median for the small payloads, up to 2x for 8 x 640 and for the binary screener, and 1.3-2x for JSON.parse of the snapshot. Isolates stay warm between requests, so cold cost applies to the first request after a deploy or idle period.)

`/api/screener` step = price > 1 and avgVol > 50K, sort by AH change, top 120 rows of 12 columns as JSON:

| Snapshot format | Size | First (cold) | Median | p95 |
|---|---|---|---|---|
| Binary: JSON header (tickers, offsets) + float32 columns via typed-array views | 1.52 MB + 58 KB header | 4.9-5.3 ms | **~2.0 ms** | 2.2-2.9 ms |
| One column-oriented JSON text | 2.63 MB | 19-30 ms | **~15-17 ms** | 16-20 ms |

Reading the numbers (Workers differ: Cloudflare's CPU clock excludes I/O waits, and its cores are about the same speed as this box to maybe 1.5x slower; assume a 2x safety factor):
- 8 x 640 (the plan's design): ~5.8 ms median, 7-8 ms p95, an 11 ms outlier. With a 2x factor that is 11-12 ms: **over the limit. Not acceptable as designed.**
- 8 x 350 (what a chart really needs: ~150 visible + 200 warm-up slots) ~3 ms, 4 x 640 ~2.7 ms: with 2x about 6 ms: **fits, p95 included.**
- 4 x 350 ~1.5 ms: very comfortable, but doubles the number of calls.
- 44 per call: 31 ms: **no-go** (as expected).
- Screener: binary ~2 ms median, ~5 ms on a cold isolate: fits; JSON.parse of the whole snapshot: 15+ ms: **no-go** (the plan's fallback JSON format is dropped). Keep the typed-array views and cache the parsed header in module scope between requests; the 1.5 MB download from R2 is I/O, not CPU.

Design changes to carry into the plan:
1. `/api/bars`: **at most 8 tickers and at most ~3,000 bars per upstream call**; ask Alpaca for `start` just early enough for 350 slots (not 640); switch to **4 tickers per call** when the response has more than 3,000 bars (for example 1M/3M charts with a long warm-up) or when running the Yahoo fallback.
2. Never normalize in the Function what the browser can do: the Function could return the **upstream columnar form unparsed** and let the client aggregate; keep that as the escape hatch if production `Server-Timing` shows more than ~6 ms.
3. Snapshot is binary only. JSON fallback removed.
4. Add a CPU guard in Phase 1: `Server-Timing: cpu;dur=` using `performance.now()` around the work, and log it so the first real traffic proves the estimate.

## 4. Cloudflare and GitHub access (read-only)

| Check | Result |
|---|---|
| `CLOUDFLARE_PAGES_TOKEN` valid | yes (`tokens/verify` active) |
| ...can list accounts | **no** (empty list), so the account id cannot be found with this token |
| ...can list Pages projects | **yes** (needs the account id: found via the other token). 10 projects visible: armanai, armanmuse, arman-bookmarks, armanclaude, arman-cloudflare-inventory, arman-usage, arman-repos-table, arman-muse-kindle-library, arman-networth, arman-nyt. **`fv-rea` is not among them** (name free); `fv-rea.pages.dev` does not resolve. |
| ...R2 / KV / D1 | no (authentication error). Workers scripts list: allowed, empty. |
| `CF_R2_TOKEN` (also in env) | valid; **lists accounts (one account)** so the account id is discoverable with it; lists R2 buckets (**`devin-wiki-rewrites`, `drawdown-history`** exist, so R2 is enabled on the account), 11 KV namespaces, Workers scripts (empty). Cannot list Pages projects or D1. Whether it can *create* a bucket is untested (POST not allowed this run). |
| GitHub | `gs455`, token scopes `gist, read:org, repo, workflow`: can create a public repo and add Actions workflows; `gs455/finviz-rea` does not exist yet. Secrets on other repos include `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (names only; values unreadable). |

What this means for the next runs:
- Repo creation, Actions secrets (`gh secret set`) and workflows: possible now.
- Pages: creating the project and `wrangler pages deploy` need a token with Pages edit; `CLOUDFLARE_PAGES_TOKEN` read works, **write is untested**. Test with the real project creation (that is a write, so do it in the Phase 1 run, not here).
- The Pages Function binding `DATA` to the R2 bucket is a project setting (dashboard or API with the Pages token, or `wrangler.toml` on deploy); the Pages token cannot see R2, so confirm in Phase 1 that the binding can be set. If not, it is an Arman action (dashboard click) and goes under BLOCKERS.
- GitHub Actions jobs writing to R2 need either an R2 S3 key pair (access key id + secret, created in the dashboard) or the REST API with `CF_R2_TOKEN`; decide in the Phase 2 run. Today the Function reads R2 through its binding, jobs write through whatever works.

## 5. Open items this run could not close

- Alpaca keys missing (the only item that needs Arman). Soft blocker: the Yahoo adapter covers Phase 1 development, but the primary source, its 3-minute bars, its pre/post coverage and its real latency stay unmeasured.
- Live Cache API probe on the real Pages project (docs say it works).
- Hub-wiring dry run (Phase 0 list in the plan): deferred, it is only allowed in the final wiring run.

## Alpaca verification (run 2, 2026-10-22 04:46 UTC, after hours)

Three calls, all HTTP 200, headers `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY` (values never logged). Samples in `docs/samples/alpaca_*.json`.

| Call | Latency | Size | Result |
|---|---|---|---|
| 3Min, feed=sip, end = now-16 min, 5 symbols (STAK NCPL QS AAPL F), 5 days, limit=10000 | 0.31 s | 374 KB | AAPL 947, F 760, NCPL 932, QS 743, STAK 349 bars; 04:00-19:57 ET incl. pre/post; no `next_page_token` |
| 3Min, feed=iex, same | 0.27 s | 138 KB | AAPL 391, F 395, QS 363, NCPL 218, STAK 24 bars: **IEX is far too thin for small caps** (STAK 24 vs 349) |
| 1Day, feed=sip, 5 symbols, 30 days | 0.23 s | 11.6 KB | 22 bars per symbol, includes the current day's bar |

Findings: SIP with an end bound of now-16 min works on the free plan; `3Min` native; ~100 B per bar raw JSON (~40 B after normalizing to columnar arrays). Bars exist only where trades happened (thin tickers have gaps; the renderer must handle missing slots). IEX is only for the Phase 5 real-time tail. Daily multi-symbol call is cheap: ~2.3 KB per symbol-month, so a 5,600-symbol nightly job is ~100 calls of 50 symbols (well under 200/min).

CPU bench on the Alpaca-shaped payload (`scripts/bench/alpaca_bench.mjs`, 5 symbols x ~750 bars = 3,731 bars): parse + normalize + stringify **median 3.95 ms, p95 5.2 ms** on Node (x2 for Workers ~ 8-10 ms): within budget only with the ~3,000-bar cap per call; keep the 8-ticker/3,000-bar rule and keep normalization minimal.
