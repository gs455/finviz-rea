// Universe from the Nasdaq Trader symbol directories (static files, no key).
const NASDAQ = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";

// Security names that are not plain common stock / ETF shares.
const SKIP_NAME = /\b(warrants?|rights?|units?|preferred|depositary|notes?|debentures?|subordinated|% )\b|\bdue\b/i;
const EXCHANGE = { Q: "NASDAQ", N: "NYSE", A: "AMEX", P: "ARCA", Z: "BATS", V: "IEX" };

function rows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("File Creation Time"));
  const header = lines.shift().split("|");
  return lines.map((l) => Object.fromEntries(l.split("|").map((v, i) => [header[i], v])));
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

/** Returns [{ symbol, name, exchange, etf }] sorted by symbol. */
export async function loadUniverse() {
  const [nasdaq, other] = await Promise.all([get(NASDAQ), get(OTHER)]);
  const list = [];
  for (const r of rows(nasdaq)) {
    list.push({ symbol: r.Symbol, name: r["Security Name"], exchange: "NASDAQ", etf: r.ETF === "Y", test: r["Test Issue"] === "Y" });
  }
  for (const r of rows(other)) {
    list.push({ symbol: r["ACT Symbol"], name: r["Security Name"], exchange: EXCHANGE[r.Exchange] || r.Exchange, etf: r.ETF === "Y", test: r["Test Issue"] === "Y" });
  }
  const seen = new Set();
  return list
    .filter((u) => u.symbol && !u.test && /^[A-Z]{1,5}(\.[A-Z])?$/.test(u.symbol) && !SKIP_NAME.test(u.name))
    .filter((u) => (seen.has(u.symbol) ? false : seen.add(u.symbol)))
    .map(({ test, ...u }) => u)
    .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}
