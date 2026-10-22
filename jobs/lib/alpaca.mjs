// Alpaca daily bars, many symbols per call, paced under the free 200 calls/minute limit.
const BASE = "https://data.alpaca.markets/v2/stocks/bars";
const MIN_GAP_MS = 400; // about 150 calls/minute

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, headers, attempt = 0) {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(url, { headers });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`alpaca ${res.status} after retries`);
    await sleep(2000 * 2 ** attempt);
    return call(url, headers, attempt + 1);
  }
  if (!res.ok) throw new Error(`alpaca ${res.status}`);
  return res.json();
}

export const stats = { calls: 0, bars: 0 };

/** Daily split-adjusted bars for `symbols` since `start` (ISO date). Returns { SYM: {d,o,h,l,c,v} } (d = YYYY-MM-DD). */
export async function dailyBars(symbols, start, env) {
  const headers = { "APCA-API-KEY-ID": env.ALPACA_API_KEY_ID, "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET_KEY };
  const out = {};
  let pageToken = null;
  do {
    const params = new URLSearchParams({ symbols: symbols.join(","), timeframe: "1Day", start, limit: "10000", adjustment: "split", feed: "sip" });
    if (pageToken) params.set("page_token", pageToken);
    const json = await call(`${BASE}?${params}`, headers);
    stats.calls++;
    for (const [sym, bars] of Object.entries(json.bars || {})) {
      const col = (out[sym] ||= { d: [], o: [], h: [], l: [], c: [], v: [] });
      for (const b of bars) {
        col.d.push(b.t.slice(0, 10)); col.o.push(b.o); col.h.push(b.h); col.l.push(b.l); col.c.push(b.c); col.v.push(b.v);
        stats.bars++;
      }
    }
    pageToken = json.next_page_token;
  } while (pageToken);
  return out;
}
