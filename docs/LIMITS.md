# Verified free-tier limits

Checked on **2026-10-21** by fetching the official pages with `curl` (the Cloudflare pages carry their own "last updated" date).
"Plan said" is what PLAN.md section 9 assumed from memory.

## Cloudflare Workers / Pages Functions (Workers Free plan)

Source: https://developers.cloudflare.com/workers/platform/limits/ (also checked https://developers.cloudflare.com/pages/functions/pricing/, https://developers.cloudflare.com/pages/platform/limits/)

| Item | Verified value | Plan said | Notes |
|---|---|---|---|
| Requests | **100,000 / day**, resets at 00:00 UTC; error 1027 beyond (fail open or closed per setting) | 100,000/day | Pages Functions share this account-wide quota with Workers. Static asset requests (not invoking a Function) are **free and unlimited**. |
| CPU time per HTTP request | **10 ms** | ~10 ms | Waiting on `fetch`, R2, KV, cache does not count. Docs: average Worker ~2.2 ms; parsing large payloads typically 10-20 ms. Over the limit gives error 1102. |
| Memory | 128 MB per isolate | n/a | 2.5 MB snapshot + a few MB of bars is fine. |
| Subrequests per invocation | **50** (external `fetch`, R2, KV, D1 and so on) | 50 | Internal-service subrequests: 1,000. |
| Cache API calls per request | **50** (`put`/`match`/`delete`), **shared with the 50 subrequests** per the docs ("same quota as subrequests") | not known | Planned 8 tickers: 1 upstream + 8 match + 8 put = 17. OK. Cache max object 512 MB. |
| Duration | no hard wall-clock limit while the client is connected; `waitUntil` up to 30 s after response | n/a | |
| Pages: files / file size | 20,000 files, 25 MiB per file | n/a | Irrelevant here. |
| Pages: builds | 500 / month (Git-integrated builds only) | n/a | We deploy with `wrangler pages deploy` from Actions, so no Pages build minutes. |
| Pages: projects | 100 per account (first 48 h of an account have a creation throttle) | n/a | 10+ projects exist now. |

## Cache API

Source: https://developers.cloudflare.com/workers/runtime-apis/cache/

- **Pages Functions have functional Cache API operations on both custom domains and `*.pages.dev`** (explicit sentence in the docs). The plan's worry is resolved on paper; confirm with a live probe in Phase 1 (`X-Cache` header).
- The cache is **per data centre, not replicated**; entries are evictable.
- **`stale-while-revalidate` and `stale-if-error` are NOT supported by `cache.put` / `cache.match`.** The plan's "SWR" must be implemented by hand: store `fetchedAt` in a header and decide freshness in code, refreshing with `ctx.waitUntil`.
- `cache.put` only accepts GET keys, no 206, no `Vary: *`; responses with `Set-Cookie` are not stored; `Cache-Control` on the stored response sets the TTL.
- Not available for Workers behind Cloudflare Access or in dashboard previews (not our case).

## Cloudflare R2

Source: https://developers.cloudflare.com/r2/pricing/ (updated 2026-10-01)

| Item | Verified (Standard storage, free tier, per month) | Plan said |
|---|---|---|
| Storage | **10 GB-month** | 10 GB |
| Class A (writes, lists, copy, multipart) | **1,000,000** | 1,000,000 |
| Class B (reads, head) | **10,000,000** | 10,000,000 |
| Egress | **free** (also via Workers API and S3 API) | free |
| Deletes, abort multipart | **free** | free |
| Infrequent Access class | not in free tier | n/a (we use Standard) |

- Unauthorized (401) requests are not charged.
- A card on file: the pricing page does not say. **Evidence from this account: two R2 buckets already exist (`devin-wiki-rewrites`, `drawdown-history`), so R2 is enabled here and no new payment step is expected.**

## Cloudflare KV

Source: https://developers.cloudflare.com/kv/platform/limits/ and /kv/platform/pricing/

| Item | Verified (Free) | Plan said |
|---|---|---|
| Reads | **100,000 / day** | 100,000/day |
| Writes (different keys) | **1,000 / day**; same key 1 per second | 1,000/day |
| Deletes | 1,000 / day | n/a |
| List requests | 1,000 / day | n/a |
| Storage | 1 GB per account/namespace | n/a |
| Value size | 25 MiB | n/a |
| Ops per Worker invocation | 1,000 | n/a |

Dashboard and wrangler operations count as usage. Plan unchanged: **zero KV writes for data.**

## GitHub Actions

Sources: https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions and https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

| Item | Verified | Plan said |
|---|---|---|
| Standard GitHub-hosted runners in **public** repos | **free** | unlimited for public |
| GitHub Free private repos | **2,000 minutes / month**, 500 MB artifact storage, 10 GB cache | 2,000 |
| Scheduled workflows | run on the default branch only; **in a public repo they are disabled automatically after 60 days without repository activity** | 60 days |
| Schedule delay | can be delayed under high load; **load peaks at the start of every hour and queued jobs may be dropped**, so avoid `:00` | not known |
| Shortest schedule | 5 minutes | n/a |
| **New:** time zone in cron | an IANA `timezone` can be given for a schedule (DST-aware; skipped hours advance to the next valid time) | not known |

Consequences: the repo is public (Arman's decision), so minutes are not a concern. Schedule the jobs at odd minutes (for example `:17`, `:43`), use the IANA time zone `America/New_York` so DST needs no manual shift, and have the nightly job make a trivial commit or the Pages deploy run at least every few weeks to avoid the 60-day pause (or document the manual re-enable).

## Alpaca Market Data (free "Basic" plan)

Sources: https://docs.alpaca.markets/docs/about-market-data-api, https://docs.alpaca.markets/docs/market-data-faq, https://docs.alpaca.markets/reference/stockbars

| Item | Verified | Plan said |
|---|---|---|
| Price | **Free**; Basic is the default for **both paper and live** accounts (paper keys are enough) | free, paper keys enough [verify] |
| Real-time coverage | **IEX only** | IEX real-time |
| SIP (all exchanges) historical | free plan: **latest 15 minutes withheld** ("no restriction" only on Algo Trader Plus, $99/month); querying SIP data newer than 15 min returns the error "subscription does not permit querying recent SIP data" | 15 min delay |
| History depth | **since 2016** | since 2016 |
| Historical API calls | **200 / minute** | ~200/min |
| Websocket | 30 symbols (IEX only) | n/a |
| `GET https://data.alpaca.markets/v2/stocks/bars` | multi-symbol (`symbols=A,B,..`), `limit` 1-10,000 **total data points across all symbols, not per symbol**, default 1,000; results sorted by symbol then time; follow `next_page_token`; `adjustment` raw/split/dividend/spin-off/all; default `end` on free = now minus 15 min | multi-symbol, 10,000 per page |
| Auth headers | `APCA-API-KEY-ID`, `APCA-API-SECRET-KEY` | n/a |

Important consequence of "limit is total across symbols, sorted by symbol": with 8 symbols x 350 bars = 2,800 points a single page is enough, but requests must set `limit=10000` (default 1,000 would silently return only the first symbol(s)) and always loop on `next_page_token`.

Also read from the `stockbars` reference page:
- `timeframe` accepts `[1-59]Min` or `[1-59]T` (so **`3Min` is native**), `[1-23]Hour`/`H`, `1Day`, `1Week`, `[1,2,3,4,6,12]Month`.
- `feed` defaults to **`sip`** (options `iex`, `otc`, `sip`, `boats` = Blue Ocean overnight). On the free plan the default `end` is already now minus 15 minutes, so a request without `end` is safe; an explicit `end` newer than that returns the "recent SIP data" error.
- `sort=asc|desc` exists, but results are ordered by symbol first, so "latest N bars per symbol" needs a `start` bound (for example 5 trading days back) and `limit=10000`, not `sort=desc`.
- There is **no `extended_hours` parameter** on this endpoint. Whether the bars include pre/post market by default is not stated on the page; it must be checked with the first real key (Yahoo does include 04:00-20:00 with `includePrePost=true`, see PHASE0.md).
- Still unverified without a key: the real response size per bar and the real latency from a GitHub runner / Cloudflare edge.

## Yahoo chart endpoint (unofficial)

No official documentation or free-tier terms; the endpoint is undocumented and may change or rate limit without notice. Measured behaviour is in `docs/PHASE0.md`. Fallback only.
