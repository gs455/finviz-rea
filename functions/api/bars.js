// GET /api/bars?t=AAPL,F&tf=3M  ->  { src, tf, bars: { SYM: { t:[], o:[], h:[], l:[], c:[], v:[] } } }
import { TIMEFRAMES, MAX_TICKERS, MAX_BARS_PER_CALL, estimateBars } from "../lib/timeframes.js";
import { fetchAlpaca } from "../lib/alpaca.js";
import { fetchYahoo } from "../lib/yahoo.js";
import { withSwr } from "../lib/swr.js";

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const tf = url.searchParams.get("tf") || "3M";
  const symbols = [...new Set((url.searchParams.get("t") || "").toUpperCase().split(",")
    .map((s) => s.trim()).filter((s) => /^[A-Z.\-]{1,10}$/.test(s)))].sort();

  if (!TIMEFRAMES[tf]) return json({ error: "bad tf" }, 400);
  if (!symbols.length) return json({ error: "no tickers" }, 400);
  if (symbols.length > MAX_TICKERS) return json({ error: `max ${MAX_TICKERS} tickers per call` }, 400);
  if (symbols.length * estimateBars(tf) > MAX_BARS_PER_CALL) {
    return json({ error: "batch too large for this timeframe", perTicker: estimateBars(tf) }, 400);
  }

  const intraday = TIMEFRAMES[tf].minutes < 1440;
  const policy = { fresh: intraday ? 30 : 300, staleFor: intraday ? 300 : 3600 };
  const t0 = Date.now();

  const res = await withSwr(request, ctx, policy, async () => {
    const now = Math.floor(Date.now() / 1000);
    let src = "alpaca", bars;
    try {
      if (!env.ALPACA_API_KEY_ID) throw new Error("no alpaca key");
      bars = await fetchAlpaca(symbols, tf, env, now);
    } catch (e) {
      src = "yahoo";
      try { bars = await fetchYahoo(symbols, tf); }
      catch (e2) { return json({ error: "upstream failed" }, 502); }
    }
    return json({ src, tf, bars });
  });

  const out = new Response(res.body, res);
  out.headers.set("Server-Timing", `total;dur=${Date.now() - t0}`);
  return out;
}
