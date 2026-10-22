// Charts tab: top bar, controls, paged 2-column grid with lazy canvas rendering.
import { drawChart, drawCrosshair } from "./chart.js";
import { nyInfo } from "./session.js";

const TABS = ["Overview", "Valuation", "Financial", "Ownership", "Performance", "Technical", "Custom", "Charts",
  "Tickers", "Basic", "TA", "News", "Snapshot", "Maps", "Stats"];
const TIMEFRAMES = ["1M", "3M", "5M", "15M", "30M", "1H", "D", "W", "M"];
const OVERLAYS = [["none", "none"], ["sr", "support/resistance"], ["trend", "trend lines"]];
// Must match estimateBars() in functions/lib/timeframes.js (upper bound of bars per ticker).
const BARS_PER_TICKER = { "1M": 1920, "3M": 1280, "5M": 768, "15M": 512, "30M": 480, "1H": 464, "D": 286, "W": 215, "M": 122 };
const MAX_BARS_PER_CALL = 3000, MAX_TICKERS_PER_CALL = 8;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// Screen query fields: state key -> URL parameter. Every field is a string; "" means unset.
const DEFAULT_QUERY = { s: "ta_topgainers_ah", o: "", t: "", minPrice: "1", maxPrice: "", minAvgVol: "50", exch: "", minChange: "", maxChange: "",
  minRsi: "", maxRsi: "", sma20: "", sma50: "", sma200: "" };
const URL_KEYS = { s: "s", o: "o", t: "t", minPrice: "pmin", maxPrice: "pmax", minAvgVol: "vmin", exch: "ex", minChange: "cmin", maxChange: "cmax",
  minRsi: "rmin", maxRsi: "rmax", sma20: "sma20", sma50: "sma50", sma200: "sma200" };
function readQueryFromUrl() {
  const q = { ...DEFAULT_QUERY };
  for (const [key, name] of Object.entries(URL_KEYS)) if (params.has(name)) q[key] = params.get(name);
  return q;
}
/** Builds the /api/screen `f` parameter from the query fields. */
function filterString(q) {
  const parts = [q.minPrice && `sh_price_o${q.minPrice}`, q.maxPrice && `sh_price_u${q.maxPrice}`, q.minAvgVol && `sh_avgvol_o${q.minAvgVol}`,
    q.exch && `exch_${q.exch}`, q.minChange && `ta_change_o${q.minChange}`, q.maxChange && `ta_change_u${q.maxChange}`,
    q.minRsi && `ta_rsi_o${q.minRsi}`, q.maxRsi && `ta_rsi_u${q.maxRsi}`];
  for (const n of ["20", "50", "200"]) if (q[`sma${n}`]) parts.push(`ta_sma${n}_p${q[`sma${n}`]}`);
  return parts.filter(Boolean).join(",");
}
const state = {
  tickers: [], rows: new Map(), total: 0, asofNote: "", screenError: "",
  query: readQueryFromUrl(),
  ahAsof: "",
  tf: TIMEFRAMES.includes(params.get("tf")) ? params.get("tf") : "3M",
  overlay: 0, page: 0, perPage: 8, refreshTimer: null,
};
const barsCache = new Map(); // "SYM|tf" -> { bars, at, src }
const cells = new Map();     // symbol -> { el, canvas, visible, drawn }
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const cell = cells.get(e.target.dataset.sym);
    if (cell) { cell.visible = e.isIntersecting; if (cell.visible) paint(e.target.dataset.sym); }
  }
}, { rootMargin: "200px" });

// ---------- chrome ----------
function buildChrome() {
  $("tabs").innerHTML = TABS.map((t) => `<button class="tab${t === "Charts" ? " active" : ""}" data-tab="${t}">${t}</button>`).join("");
  $("tabs").onclick = (e) => {
    const tab = e.target.dataset.tab; if (!tab) return;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === e.target));
    const isCharts = tab === "Charts";
    $("grid").hidden = !isCharts;
    document.querySelector(".controls").hidden = !isCharts;
    document.querySelector(".filterbar").hidden = !isCharts;
    let ph = $("placeholder");
    if (!ph) { ph = document.createElement("div"); ph.id = "placeholder"; ph.className = "placeholder"; $("grid").after(ph); }
    ph.hidden = isCharts; ph.textContent = `${tab} tab: coming in a later phase.`;
  };
  $("tf").innerHTML = TIMEFRAMES.map((t) => `<button data-tf="${t}">${t}</button>`).join("");
  $("tf").onclick = (e) => { if (e.target.dataset.tf) { state.tf = e.target.dataset.tf; syncControls(); render(); } };
  $("ta-btn").onclick = () => { state.overlay = (state.overlay + 1) % OVERLAYS.length; syncControls(); redrawAll(); };
  buildScreenControls();
  $("layout").onchange = () => { state.perPage = Number($("layout").value.split("x")[1]) * 2; state.page = 0; render(); };
  $("refresh").onchange = () => {
    clearInterval(state.refreshTimer);
    const s = Number($("refresh").value);
    if (s) state.refreshTimer = setInterval(() => { barsCache.clear(); render(); }, s * 1000);
  };
  $("menu-btn").onclick = (e) => { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; };
  document.addEventListener("click", () => ($("menu").hidden = true));
  $("menu").onclick = (e) => { const a = e.target.dataset.act; if (a) openModal(a); };
  $("modal-close").onclick = () => ($("modal").hidden = true);
  $("modal").onclick = (e) => { if (e.target === $("modal")) $("modal").hidden = true; };
  const theme = localStorage.getItem("armanai-theme") === "dark" ? "dark" : "light";
  setTheme(theme);
  $("theme-btn").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  syncControls();
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("armanai-theme", t);
  $("theme-btn").innerHTML = t === "dark" ? "&#9728;" : "&#9790;"; // sun / moon, icon only
  redrawAll();
}

function syncControls() {
  $("tf").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tf === state.tf));
  $("ta-btn").textContent = `Tech. Analysis: ${OVERLAYS[state.overlay][1]}`;
}

// ---------- screener (/api/screen) ----------
const DEFAULT_PRESETS = { "Top Gainers AH (price>$1, avg vol>50K)": { ...DEFAULT_QUERY } };
const loadPresets = () => ({ ...DEFAULT_PRESETS, ...JSON.parse(localStorage.getItem("fv-presets") || "{}") });
const SIGNALS = [["", "None (all stocks)"], ["ta_topgainers_ah", "Top Gainers AH"], ["ta_toplosers_ah", "Top Losers AH"],
  ["ta_topgainers", "Top Gainers"], ["ta_toplosers", "Top Losers"], ["ta_mostactive", "Most Active"]];
const ORDERS = [["", "None"], ["ticker", "Ticker"], ["price", "Price"], ["change", "Change"], ["ahChange", "AH change"], ["volume", "Volume"], ["avgVolume", "Avg volume"]];

/** The after-hours session the AH numbers belong to: "AH" once today's session closed, else "AH (Oct 21)". */
function ahLabel() {
  if (!state.ahAsof) return "AH";
  const now = nyInfo(Date.now() / 1000);
  if (state.ahAsof === now.date && now.minutes >= 960) return "AH";
  const [y, m, d] = state.ahAsof.split("-").map(Number);
  return `AH (${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})`;
}
function fillSignals() {
  const label = ahLabel();
  $("signal").innerHTML = SIGNALS.map(([v, l]) => `<option value="${v}">${l.replace(/\bAH\b/, label)}</option>`).join("");
  $("signal").value = state.query.s;
}

function buildScreenControls() {
  fillSignals();
  $("order").innerHTML = ORDERS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  fillPresets();
  const apply = (q) => { Object.assign(state.query, DEFAULT_QUERY, q); syncScreenControls(); state.page = 0; runScreen(); };
  $("preset").onchange = () => { const p = loadPresets()[$("preset").value]; if (p) apply(p); };
  $("preset-save").onclick = () => {
    const name = prompt("Preset name"); if (!name) return;
    const saved = JSON.parse(localStorage.getItem("fv-presets") || "{}"); saved[name] = { ...state.query };
    localStorage.setItem("fv-presets", JSON.stringify(saved)); fillPresets(name);
  };
  const read = () => { Object.assign(state.query, { s: $("signal").value, o: $("order").value, minPrice: $("min-price").value, minAvgVol: $("min-avgvol").value,
    t: $("tickers").value }); state.page = 0; runScreen(); };
  for (const id of ["signal", "order", "min-price", "min-avgvol", "tickers"]) $(id).onchange = read;
  $("dir").onchange = read;
  buildFiltersPanel(apply);
  syncScreenControls();
}
function fillPresets(selected) {
  const names = Object.keys(loadPresets());
  $("preset").innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join("");
  $("preset").value = selected || names[0];
}
function syncScreenControls() {
  const q = state.query;
  $("signal").value = q.s; $("order").value = q.o.replace(/^-/, ""); $("dir").value = q.o.startsWith("-") ? "Desc" : "Asc";
  $("min-price").value = q.minPrice; $("min-avgvol").value = q.minAvgVol; $("tickers").value = q.t;
  for (const input of document.querySelectorAll("#filters-panel [data-q]")) input.value = q[input.dataset.q];
}

// Filters panel: every field maps to a query field and then to a /api/screen filter (see filterString).
const FILTER_FIELDS = [
  ["Descriptive", [
    ["Exchange", "select", "exch", [["", "Any"], ["nasd", "NASDAQ"], ["nyse", "NYSE"], ["amex", "AMEX"], ["arca", "NYSE Arca"]]],
    ["Price min $", "num", "minPrice"], ["Price max $", "num", "maxPrice"], ["Avg volume min (K)", "num", "minAvgVol"]]],
  ["Technical", [
    ["Change min %", "num", "minChange"], ["Change max %", "num", "maxChange"], ["RSI (14) min", "num", "minRsi"], ["RSI (14) max", "num", "maxRsi"],
    ["Price vs SMA 20", "select", "sma20", SMA_OPTIONS()], ["Price vs SMA 50", "select", "sma50", SMA_OPTIONS()], ["Price vs SMA 200", "select", "sma200", SMA_OPTIONS()]]],
];
function SMA_OPTIONS() { return [["", "Any"], ["a", "Above"], ["b", "Below"]]; }

function buildFiltersPanel(apply) {
  $("filters-panel").innerHTML = FILTER_FIELDS.map(([group, fields]) => `<fieldset><legend>${group}</legend>${fields.map(([label, kind, key, options]) =>
    `<label>${label} ${kind === "select"
      ? `<select data-q="${key}">${options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`
      : `<input class="num" data-q="${key}" inputmode="decimal">`}</label>`).join("")}</fieldset>`).join("")
    + `<div class="panel-actions"><button id="filters-reset" class="btn">Reset</button></div>`;
  $("filters-btn").onclick = (e) => { e.stopPropagation(); $("filters-panel").hidden = !$("filters-panel").hidden; };
  $("filters-panel").onclick = (e) => e.stopPropagation();
  $("filters-panel").onchange = (e) => {
    const key = e.target.dataset.q; if (!key) return;
    apply({ ...state.query, [key]: e.target.value.trim() });
  };
  $("filters-reset").onclick = () => apply({ ...DEFAULT_QUERY });
  document.addEventListener("click", () => ($("filters-panel").hidden = true));
}

async function runScreen() {
  const q = state.query, dir = $("dir").value === "Desc" ? "-" : "";
  q.o = $("order").value ? dir + $("order").value : "";
  const url = `api/screen?${new URLSearchParams({ s: q.s, f: filterString(q), o: q.o, t: q.t.trim(), n: "200" })}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const body = await res.json();
    state.rows = new Map(body.rows.map((r) => [r[0], Object.fromEntries(body.cols.map((c, i) => [c, r[i]]))]));
    state.tickers = [...state.rows.keys()]; state.total = body.total; state.screenError = ""; state.ahAsof = body.ahAsof || "";
    fillSignals();
    state.asofNote = `snapshot ${body.asof}${body.ahBuilt ? ` · AH ${body.ahBuilt.slice(11, 16)}Z` : ""} · ${res.headers.get("Server-Timing") || ""}`;
  } catch (err) {
    state.tickers = []; state.rows = new Map(); state.total = 0; state.screenError = `screen failed: ${err.message}`;
  }
  render();
}

// ---------- data ----------
async function loadBars(symbols) {
  const need = symbols.filter((s) => !barsCache.has(`${s}|${state.tf}`));
  const perCall = Math.max(1, Math.min(MAX_TICKERS_PER_CALL, Math.floor(MAX_BARS_PER_CALL / BARS_PER_TICKER[state.tf])));
  const jobs = [];
  for (let i = 0; i < need.length; i += perCall) jobs.push(need.slice(i, i + perCall));
  await Promise.all(jobs.map(async (batch) => {
    const tf = state.tf;
    try {
      const res = await fetch(`api/bars?t=${batch.join(",")}&tf=${tf}`);
      if (!res.ok) throw new Error(res.status);
      const body = await res.json();
      for (const s of batch) barsCache.set(`${s}|${tf}`, { bars: body.bars[s], src: body.src, at: Date.now(), cache: res.headers.get("X-Cache") });
      $("status").textContent = `${body.src} · ${res.headers.get("X-Cache") || ""} · ${res.headers.get("Server-Timing") || ""}`;
    } catch (err) {
      for (const s of batch) barsCache.set(`${s}|${tf}`, { error: String(err.message) });
      $("status").textContent = `error ${err.message}`;
    }
  }));
}

// ---------- grid ----------
function pageSymbols() {
  return state.tickers.slice(state.page * state.perPage, (state.page + 1) * state.perPage);
}

async function render() {
  const total = state.total, pages = Math.max(1, Math.ceil(state.tickers.length / state.perPage));
  $("pager").innerHTML = `<button class="icon-btn" id="prev" aria-label="Previous">&lsaquo;</button>#${state.page + 1} / ${total} Total <button class="icon-btn" id="next" aria-label="Next">&rsaquo;</button>`;
  $("prev").onclick = () => { state.page = Math.max(0, state.page - 1); render(); };
  $("next").onclick = () => { state.page = Math.min(pages - 1, state.page + 1); render(); };

  const symbols = pageSymbols();
  observer.disconnect(); cells.clear();
  $("grid").style.setProperty("--rows", Math.ceil(state.perPage / 2));
  $("grid").replaceChildren(...symbols.map(makeCell));
  const urlParams = new URLSearchParams({ tf: state.tf });
  for (const [key, name] of Object.entries(URL_KEYS)) if (state.query[key] !== DEFAULT_QUERY[key]) urlParams.set(name, state.query[key]);
  history.replaceState(null, "", `?${urlParams}`);
  if (!symbols.length) $("grid").innerHTML = `<div class="placeholder">${esc(state.screenError || "No results.")}</div>`;
  $("status").textContent = state.asofNote;
  await loadBars(symbols);
  for (const s of symbols) { updateHeader(s); if (cells.get(s)?.visible) paint(s); }
}

function makeCell(sym) {
  const el = document.createElement("div");
  el.className = "cell"; el.dataset.sym = sym;
  el.innerHTML = `<div class="cell-head"><span class="sym">${sym}</span><span class="meta">loading…</span></div><div class="plot"><canvas></canvas><canvas class="xhair"></canvas></div>`;
  const canvas = el.querySelector("canvas"), xhair = el.querySelector(".xhair");
  cells.set(sym, { el, canvas, xhair, visible: false });
  observer.observe(el);
  el.addEventListener("mousemove", (e) => { showTip(e, sym); moveCrosshair(e, sym); });
  el.addEventListener("mouseleave", () => { $("tip").hidden = true; moveCrosshair(null, sym); });
  return el;
}

function summary(sym) {
  const entry = barsCache.get(`${sym}|${state.tf}`);
  const b = entry?.bars;
  if (!b || !b.t.length) return null;
  const n = b.t.length, last = b.c[n - 1], first = b.o[0];
  const change = ((last - first) / first) * 100;
  const vol = b.v.reduce((a, v) => a + (v || 0), 0);
  return { last, change, vol, src: entry.src, open: b.o[n - 1], high: b.h[n - 1], low: b.l[n - 1], barVol: b.v[n - 1] || 0, time: b.t[n - 1] };
}

const barTime = (epochSec) => {
  const d = new Date(epochSec * 1000);
  const part = (opts) => d.toLocaleString("en-US", { timeZone: "America/New_York", ...opts });
  const clock = part({ hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, "");
  return `${part({ month: "short", day: "numeric" })} ${clock}`;
};
const signed = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const price = (p) => p.toFixed(p < 10 ? 3 : 2);

function updateHeader(sym) {
  const cell = cells.get(sym); if (!cell) return;
  const s = summary(sym), entry = barsCache.get(`${sym}|${state.tf}`);
  const meta = cell.el.querySelector(".meta");
  if (entry?.error) meta.textContent = `error ${entry.error}`;
  else if (!s) meta.textContent = "no data";
  else {
    const intraday = !["D", "W", "M"].includes(state.tf);
    const when = intraday ? barTime(s.time) : new Date(s.time * 1000).toISOString().slice(0, 10);
    const ah = state.rows.get(sym)?.ahChange;
    const ahText = ah == null ? "" : ` <span class="${ah >= 0 ? "up" : "down"}">${ahLabel()} ${signed(ah)}</span>`;
    meta.innerHTML = `<span class="when">${when}</span> O ${price(s.open)} H ${price(s.high)} L ${price(s.low)} C ${price(s.last)} Vol ${compact(s.barVol)} `
      + `<span class="${s.change >= 0 ? "up" : "down"}">${signed(s.change)}</span>${ahText}`;
    meta.title = `${sym} ${when} ET: O ${s.open} H ${s.high} L ${s.low} C ${s.last}, bar volume ${s.barVol.toLocaleString()}; `
      + `${signed(s.change)} over the window, window volume ${s.vol.toLocaleString()} (${s.src})`;
  }
}

function paint(sym) {
  const cell = cells.get(sym), entry = barsCache.get(`${sym}|${state.tf}`);
  if (!cell || !entry?.bars) return;
  const row = state.rows.get(sym);
  cell.geometry = drawChart(cell.canvas, entry.bars, { overlay: OVERLAYS[state.overlay][0], intraday: !["D", "W", "M"].includes(state.tf),
    regClose: row?.ahChange != null ? row.regClose : null });
}
function redrawAll() { for (const s of cells.keys()) if (cells.get(s).visible) paint(s); }

function moveCrosshair(e, sym) {
  const cell = cells.get(sym), bars = barsCache.get(`${sym}|${state.tf}`)?.bars;
  if (!cell || !bars) return;
  const r = cell.xhair.getBoundingClientRect();
  drawCrosshair(cell.xhair, cell.geometry, bars, e && { x: e.clientX - r.left, y: e.clientY - r.top }, { intraday: !["D", "W", "M"].includes(state.tf) });
}

function showTip(e, sym) {
  const s = summary(sym), tip = $("tip");
  if (!s) { tip.hidden = true; return; }
  // Sector, industry, country and market cap have no free source yet; shown once the snapshot carries them.
  const row = state.rows.get(sym) || {};
  const lines = [`<b>${sym}</b> ${esc(row.company || "")}`, row.exchange && `Exchange ${esc(row.exchange)}`,
    `Last ${s.last.toFixed(2)} (${s.change.toFixed(2)}% over the window)`, row.regClose != null && `Regular close ${row.regClose}`,
    row.ahChange != null && `${ahLabel()} ${row.ahChange.toFixed(2)}% on ${compact(row.ahVolume)} shares`,
    `Volume ${s.vol.toLocaleString()}`, row.avgVolume != null && `Avg volume ${compact(row.avgVolume)}`];
  tip.innerHTML = lines.filter(Boolean).join("<br>");
  tip.title = "";
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 220)}px`; tip.style.top = `${e.clientY + 14}px`;
}

const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "K" : String(n));

// ---------- changelog / code history ----------
async function openModal(kind) {
  $("menu").hidden = true; $("modal").hidden = false;
  if (kind === "changelog") {
    const log = await (await fetch("changelog.json")).json();
    $("modal-title").textContent = "Changelog";
    const draw = (mode) => {
      $("modal-body").innerHTML = log.versions.map((v) =>
        `<div class="ver"><h4>${v.version} · ${v.date}</h4><ul>${(mode === "brief" ? v.brief : v.full).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`).join("");
    };
    $("modal-tabs").innerHTML = `<button class="btn" data-m="brief">Brief</button> <button class="btn" data-m="full">Full</button>`;
    $("modal-tabs").onclick = (e) => e.target.dataset.m && draw(e.target.dataset.m);
    draw("brief");
  } else {
    const hist = await (await fetch("history.json")).json();
    $("modal-title").textContent = "Code history"; $("modal-tabs").innerHTML = "";
    $("modal-body").innerHTML = hist.commits.map((c) =>
      `<div class="ver"><h4>${c.hash} · ${c.date} · ${esc(c.subject)}</h4>${c.files.map((f) =>
        `<details><summary>${esc(f.file)}</summary><pre>${esc(f.diff)}</pre></details>`).join("")}</div>`).join("");
  }
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

fetch("changelog.json").then((r) => r.json()).then((l) => ($("version").textContent = `Version ${l.versions[l.versions.length - 1].version}`)).catch(() => {});
buildChrome();
runScreen();
