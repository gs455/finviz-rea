// Pure screening logic: filter + signal + order + page over the decoded snapshot (and the optional after-hours object).
// No I/O here, so it runs identically in Functions and in Node tests.

export const COLS = ["ticker", "company", "exchange", "price", "change", "regClose", "ahLast", "ahChange", "volume", "ahVolume", "avgVolume", "rsi", "sma20", "sma50", "sma200"];
const SIGNAL_CAP = 200;

/**
 * Parses "sh_price_o1,sh_avgvol_o50,ta_rsi_u30,ta_sma50_pa,exch_nasd" style filters.
 * Rules: { col, min, max } range tests, { col, rel, above } price-vs-SMA tests, { exchange } prefix tests.
 */
export function parseFilters(f) {
  const rules = [], applied = [], ignored = [];
  // key -> [column, multiplier]; "price" is the AH price when the AH signal is active.
  const known = { sh_price: ["price", 1], sh_avgvol: ["avgVolume", 1000], sh_curvol: ["volume", 1000], ta_change: ["change", 1], ta_rsi: ["rsi", 1] };
  const exchanges = { nasd: "NASDAQ", nyse: "NYSE", amex: "AMEX", arca: "NYSE ARCA" };
  for (const part of (f || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    let m = /^c?(\w+?)_([ou])(-?\d+(?:\.\d+)?)$/.exec(part);
    const spec = m && known[m[1]];
    if (spec) {
      const value = Number(m[3]) * spec[1];
      rules.push(m[2] === "o" ? { col: spec[0], min: value } : { col: spec[0], max: value });
      applied.push(part);
    } else if ((m = /^ta_sma(20|50|200)_p([ab])$/.exec(part))) {
      rules.push({ col: "price", rel: `sma${m[1]}`, above: m[2] === "a" });
      applied.push(part);
    } else if ((m = /^exch_(\w+)$/.exec(part)) && exchanges[m[1]]) {
      rules.push({ exchange: exchanges[m[1]] });
      applied.push(part);
    } else ignored.push(part);
  }
  return { rules, applied, ignored };
}

const SIGNALS = {
  ta_topgainers_ah: { ah: true, key: "ahChange", dir: -1, needsAh: "ahVolume" },
  ta_toplosers_ah: { ah: true, key: "ahChange", dir: 1, needsAh: "ahVolume" },
  ta_topgainers: { key: "change", dir: -1 },
  ta_toplosers: { key: "change", dir: 1 },
  ta_mostactive: { key: "volume", dir: -1 },
};

/**
 * snap: { header, col(name) }; ah: same shape or null. query: { f, s, o, r, n }.
 * Returns the /api/screen body.
 */
const indexCache = new WeakMap();
function symbolIndex(snap) {
  let index = indexCache.get(snap);
  if (!index) { index = new Map(snap.header.symbols.map((sym, i) => [sym, i])); indexCache.set(snap, index); }
  return index;
}

export function screen(snap, ah, query) {
  const { header } = snap;
  const price = snap.col("price"), change = snap.col("change"), volume = snap.col("volume"), avgVol = snap.col("avgVol");
  // Older snapshots may lack the indicator columns: treat them as all-NaN.
  const optional = (name) => (header.columns.includes(name) ? snap.col(name) : new Float32Array(header.rows).fill(NaN));
  const rsi = optional("rsi"), sma20 = optional("sma20"), sma50 = optional("sma50"), sma200 = optional("sma200");
  const arrays = { price, change, volume, avgVolume: avgVol, rsi, sma20, sma50, sma200 };
  // One rule against snapshot row i; `v` is the rule's own column value, `priceNow` the price to compare with the SMA.
  const ruleHolds = (rule, v, i, priceNow) => {
    if (rule.exchange) return i >= 0 && header.exchanges[i].toUpperCase() === rule.exchange;
    if (rule.rel) {
      const p = rule.col === "price" && priceNow === priceNow ? priceNow : v, ref = i >= 0 ? arrays[rule.rel][i] : NaN;
      return p === p && ref === ref && (rule.above ? p > ref : p < ref);
    }
    return v === v && (rule.min === undefined || v >= rule.min) && (rule.max === undefined || v <= rule.max);
  };
  const signal = SIGNALS[query.s] || null;
  const { rules, applied, ignored } = parseFilters(query.f);
  if (query.s && !signal) ignored.push(`s=${query.s}`);

  // Row source: the snapshot rows, or for AH signals the symbols that traded after hours.
  const index = symbolIndex(snap);
  const ahRows = [];
  if (signal?.ah) {
    if (!ah) return { asof: header.asof, ahAsof: null, total: 0, firstRow: 1, pageSize: 0, cols: COLS, rows: [], applied, ignored, signal: query.s, warning: "no after-hours data yet" };
    const regClose = ah.col("regClose"), ahLast = ah.col("ahLast"), ahVolume = ah.col("ahVolume");
    ah.header.symbols.forEach((sym, k) => {
      if (!(ahVolume[k] > 0) || !(regClose[k] > 0)) return;
      const i = index.has(sym) ? index.get(sym) : -1;
      // Cheap rejection on the typed arrays before any object is built (columns from the snapshot are NaN when unknown).
      for (const rule of rules) {
        const v = rule.col === "price" ? ahLast[k] : i >= 0 && rule.col ? arrays[rule.col][i] : NaN;
        if (!ruleHolds(rule, v, i, rule.col === "price" ? ahLast[k] : NaN)) return;
      }
      ahRows.push({ i, sym, regClose: regClose[k], ahLast: ahLast[k], ahVolume: ahVolume[k], ahChange: (ahLast[k] / regClose[k] - 1) * 100 });
    });
  }

  // Unified row accessor so filters/order work for both sources.
  const make = (i, extra) => {
    const sym = extra ? extra.sym : header.symbols[i];
    return {
      i, ticker: sym, company: i >= 0 ? header.names[i] : "", exchange: i >= 0 ? header.exchanges[i] : "",
      price: extra ? extra.ahLast : price[i], change: i >= 0 ? change[i] : NaN, regClose: extra ? extra.regClose : price[i],
      ahLast: extra ? extra.ahLast : NaN, ahChange: extra ? extra.ahChange : NaN, volume: i >= 0 ? volume[i] : NaN,
      ahVolume: extra ? extra.ahVolume : NaN, avgVolume: i >= 0 ? avgVol[i] : NaN,
      rsi: i >= 0 ? rsi[i] : NaN, sma20: i >= 0 ? sma20[i] : NaN, sma50: i >= 0 ? sma50[i] : NaN, sma200: i >= 0 ? sma200[i] : NaN,
    };
  };
  const tickers = (query.t || "").toUpperCase().split(/[\s,]+/).filter(Boolean);
  const want = tickers.length ? new Set(tickers) : null;
  let rows;
  if (signal?.ah) {
    rows = ahRows.map((e) => make(e.i, e)).filter((r) => (!want || want.has(r.ticker)) && rules.every((rule) => ruleHolds(rule, r[rule.col], r.i, r.price)));
  } else {
    // Filter on the typed arrays first; build row objects only for the survivors (11k rows, ~10 ms CPU budget).
    rows = [];
    for (let i = 0; i < header.rows; i++) {
      if (want && !want.has(header.symbols[i])) continue;
      if (!rules.every((rule) => ruleHolds(rule, rule.col ? arrays[rule.col][i] : NaN, i, price[i]))) continue;
      rows.push(make(i));
    }
  }

  // Signal ranking first (and cap), then the user's order on top of it.
  if (signal) {
    rows.sort((a, b) => (a[signal.key] - b[signal.key]) * signal.dir || (a.ticker < b.ticker ? -1 : 1));
    if (rows.length > SIGNAL_CAP) rows.length = SIGNAL_CAP;
  }
  let sort = signal ? { key: signal.key, dir: signal.dir } : { key: "ticker", dir: 1 };
  const o = query.o || "";
  const orderKey = o.replace(/^-/, "");
  if (orderKey && COLS.includes(orderKey)) {
    const dir = o.startsWith("-") ? -1 : 1;
    sort = { key: orderKey, dir };
    rows.sort((a, b) => {
      const x = a[orderKey], y = b[orderKey];
      if (typeof x === "string") return x < y ? -dir : x > y ? dir : 0;
      const nx = x !== x, ny = y !== y; // NaN last
      return nx || ny ? (nx - ny) : (x - y) * dir;
    });
  } else if (orderKey) ignored.push(`o=${o}`);

  const pageSize = Math.min(Math.max(Number(query.n) || 120, 1), 200);
  const firstRow = Math.max(1, Number(query.r) || 1);
  const page = rows.slice(firstRow - 1, firstRow - 1 + pageSize);
  const round = (v) => (v === v ? Math.round(v * 10000) / 10000 : null);
  return {
    asof: header.asof, ahAsof: ah ? ah.header.asof : null, ahBuilt: ah ? ah.header.built : null,
    total: rows.length, firstRow, pageSize, signal: query.s || null, sort, applied, ignored, cols: COLS,
    rows: page.map((r) => COLS.map((c) => (typeof r[c] === "string" ? r[c] : round(r[c])))),
  };
}
