// Alpaca market-data adapter (primary). Free plan: SIP is delayed 15 min, so `end` is bounded.
import { TIMEFRAMES } from "./timeframes.js";

const BASE = "https://data.alpaca.markets/v2/stocks/bars";
const SIP_DELAY_SEC = 16 * 60;

export async function fetchAlpaca(symbols, tf, env, nowSec) {
  const spec = TIMEFRAMES[tf];
  const params = new URLSearchParams({
    symbols: symbols.join(","), timeframe: spec.alpaca, limit: "10000",
    adjustment: "split", feed: "sip",
    start: new Date((nowSec - spec.days * 86400) * 1000).toISOString(),
    end: new Date((nowSec - SIP_DELAY_SEC) * 1000).toISOString(),
  });
  const headers = {
    "APCA-API-KEY-ID": env.ALPACA_API_KEY_ID,
    "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET_KEY,
  };
  const out = {};
  for (const s of symbols) out[s] = { t: [], o: [], h: [], l: [], c: [], v: [] };

  let pageToken = null;
  for (let page = 0; page < 3; page++) {
    if (pageToken) params.set("page_token", pageToken);
    const res = await fetch(`${BASE}?${params}`, { headers });
    if (!res.ok) throw new Error(`alpaca ${res.status}`);
    const json = await res.json();
    for (const [sym, bars] of Object.entries(json.bars || {})) {
      const col = out[sym];
      if (!col) continue;
      for (const b of bars) {
        col.t.push(Math.floor(Date.parse(b.t) / 1000));
        col.o.push(b.o); col.h.push(b.h); col.l.push(b.l); col.c.push(b.c); col.v.push(b.v);
      }
    }
    pageToken = json.next_page_token;
    if (!pageToken) break;
  }
  return out;
}
