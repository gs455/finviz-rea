// Charts tab: top bar, controls, paged 2-column grid with lazy canvas rendering.
import { drawChart } from "./chart.js";

const TABS = ["Overview", "Valuation", "Financial", "Ownership", "Performance", "Technical", "Custom", "Charts",
  "Tickers", "Basic", "TA", "News", "Snapshot", "Maps", "Stats"];
const TIMEFRAMES = ["1M", "3M", "5M", "15M", "30M", "1H", "D", "W", "M"];
const OVERLAYS = [["none", "none"], ["sr", "support/resistance"], ["trend", "trend lines"]];
const BARS_PER_TICKER = { "1M": 1000, "3M": 600, "5M": 600, "15M": 400, "30M": 300, "1H": 300, "D": 290, "W": 220, "M": 120 };
const MAX_BARS_PER_CALL = 3000, MAX_TICKERS_PER_CALL = 8;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = {
  tickers: (params.get("t") || "AAPL,F,QS,NCPL,STAK,MSFT,NVDA,TSLA,AMD").toUpperCase().split(/[\s,]+/).filter(Boolean),
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
  $("tickers").value = state.tickers.join(", ");
  $("tickers").onchange = () => {
    state.tickers = $("tickers").value.toUpperCase().split(/[\s,]+/).filter(Boolean); state.page = 0; render();
  };
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
  const theme = localStorage.getItem("fv-theme") || "light";
  setTheme(theme);
  $("theme-btn").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  syncControls();
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("fv-theme", t);
  $("theme-btn").innerHTML = t === "dark" ? "&#9728;" : "&#9790;"; // sun / moon, icon only
  redrawAll();
}

function syncControls() {
  $("tf").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tf === state.tf));
  $("ta-btn").textContent = `Tech. Analysis: ${OVERLAYS[state.overlay][1]}`;
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
  const total = state.tickers.length, pages = Math.max(1, Math.ceil(total / state.perPage));
  $("pager").innerHTML = `<button class="icon-btn" id="prev" aria-label="Previous">&lsaquo;</button>#${state.page + 1} / ${total} Total <button class="icon-btn" id="next" aria-label="Next">&rsaquo;</button>`;
  $("prev").onclick = () => { state.page = Math.max(0, state.page - 1); render(); };
  $("next").onclick = () => { state.page = Math.min(pages - 1, state.page + 1); render(); };

  const symbols = pageSymbols();
  observer.disconnect(); cells.clear();
  $("grid").replaceChildren(...symbols.map(makeCell));
  history.replaceState(null, "", `?t=${state.tickers.join(",")}&tf=${state.tf}`);
  await loadBars(symbols);
  for (const s of symbols) { updateHeader(s); if (cells.get(s)?.visible) paint(s); }
}

function makeCell(sym) {
  const el = document.createElement("div");
  el.className = "cell"; el.dataset.sym = sym;
  el.innerHTML = `<div class="cell-head"><span class="sym">${sym}</span><span class="meta">loading…</span></div><canvas></canvas>`;
  const canvas = el.querySelector("canvas");
  cells.set(sym, { el, canvas, visible: false });
  observer.observe(el);
  el.addEventListener("mousemove", (e) => showTip(e, sym));
  el.addEventListener("mouseleave", () => ($("tip").hidden = true));
  return el;
}

function summary(sym) {
  const entry = barsCache.get(`${sym}|${state.tf}`);
  const b = entry?.bars;
  if (!b || !b.t.length) return null;
  const last = b.c[b.c.length - 1], first = b.o[0];
  const change = ((last - first) / first) * 100;
  const vol = b.v.reduce((a, v) => a + (v || 0), 0);
  return { last, change, vol, src: entry.src };
}

function updateHeader(sym) {
  const cell = cells.get(sym); if (!cell) return;
  const s = summary(sym), entry = barsCache.get(`${sym}|${state.tf}`);
  const meta = cell.el.querySelector(".meta");
  if (entry?.error) meta.textContent = `error ${entry.error}`;
  else if (!s) meta.textContent = "no data";
  else {
    meta.innerHTML = `${s.last.toFixed(2)} <span class="${s.change >= 0 ? "up" : "down"}">${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)}%</span> · vol ${compact(s.vol)}`;
    meta.title = `${sym}: last ${s.last.toFixed(4)}, ${s.change.toFixed(2)}% over the window, volume ${s.vol.toLocaleString()} (${s.src})`;
  }
}

function paint(sym) {
  const cell = cells.get(sym), entry = barsCache.get(`${sym}|${state.tf}`);
  if (!cell || !entry?.bars) return;
  cell.geometry = drawChart(cell.canvas, entry.bars, { overlay: OVERLAYS[state.overlay][0], intraday: !["D", "W", "M"].includes(state.tf) });
}
function redrawAll() { for (const s of cells.keys()) if (cells.get(s).visible) paint(s); }

function showTip(e, sym) {
  const s = summary(sym), tip = $("tip");
  if (!s) { tip.hidden = true; return; }
  // Company, sector, country and market cap appear once the Phase 2 snapshot provides them.
  tip.innerHTML = `<b>${sym}</b><br>Last ${s.last.toFixed(2)} (${s.change.toFixed(2)}%)<br>Volume ${s.vol.toLocaleString()}`;
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
render();
