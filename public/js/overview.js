// Overview tab: one compact table row per stock, sortable headers, pager. Pure view code: app.js owns the data and the URL.
export const OVERVIEW_PAGE_SIZE = 20;

// [header, row field, kind, sortable]. Sector, industry, country, market cap and P/E have no free data source yet, so they stay blank ("-").
const COLUMNS = [
  ["No.", null, "num", false], ["Ticker", "ticker", "text", true], ["Company", "company", "text", true], ["Sector", "sector", "text", false],
  ["Industry", "industry", "text", false], ["Country", "country", "text", false], ["Market Cap", "marketCap", "num", false],
  ["P/E", "pe", "num", false], ["Price", "price", "num", true], ["Change", "change", "num", true], ["Volume", "volume", "num", true],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const dash = "-";

function cellText(row, field) {
  const v = row[field];
  if (v == null || v === "") return { text: dash };
  if (field === "price") return { text: v.toFixed(2) };
  if (field === "volume") return { text: Math.round(v).toLocaleString("en-US") };
  if (field === "change" || field === "ahChange") return { text: `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, cls: v >= 0 ? "up" : "down" };
  if (typeof v === "number") return { text: v.toLocaleString("en-US") };
  return { text: v };
}

/**
 * ctx: { rows, total, first, error, note, ah, sortKey, desc, onSort(key), onPage(pageIndex), onTicker(symbol) }.
 * With an after-hours signal the Change column shows (and sorts by) the after-hours change.
 */
export function renderOverview(root, ctx) {
  const changeField = ctx.ah ? "ahChange" : "change";
  const field = (f) => (f === "change" ? changeField : f);
  const pages = Math.max(1, Math.ceil(ctx.total / OVERVIEW_PAGE_SIZE)), page = Math.floor((ctx.first - 1) / OVERVIEW_PAGE_SIZE);
  const head = COLUMNS.map(([label, f, kind, sortable]) => {
    const key = f && field(f), active = sortable && key === ctx.sortKey;
    const arrow = active ? (ctx.desc ? " ▼" : " ▲") : "";
    return `<th class="${kind}${sortable ? " sortable" : ""}"${sortable ? ` data-sort="${key}"` : ""}>${label}${arrow}</th>`;
  }).join("");
  const body = ctx.rows.map((row, i) => `<tr>${COLUMNS.map(([, f, kind]) => {
    if (!f) return `<td class="num">${ctx.first + i}</td>`;
    const { text, cls } = cellText(row, field(f));
    const inner = f === "ticker" ? `<a href="#" class="tk" data-sym="${esc(text)}">${esc(text)}</a>` : esc(text);
    return `<td class="${kind}${cls ? ` ${cls}` : ""}" title="${esc(text)}">${inner}</td>`;
  }).join("")}</tr>`).join("");
  root.innerHTML = `<div class="ov-bar"><span class="grow status" title="${esc(ctx.note || "")}">${esc(ctx.note || "")}</span>`
    + `<span class="pager"><button class="icon-btn" data-page="${page - 1}" aria-label="Previous"${page ? "" : " disabled"}>&lsaquo;</button>`
    + `#${ctx.total ? ctx.first : 0} / ${ctx.total} Total <button class="icon-btn" data-page="${page + 1}" aria-label="Next"${page + 1 < pages ? "" : " disabled"}>&rsaquo;</button></span></div>`
    + `<table class="ov-table"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLUMNS.length}" class="empty">${esc(ctx.error || "No results.")}</td></tr>`}</tbody></table>`;
  root.onclick = (e) => {
    const th = e.target.closest("th[data-sort]"), btn = e.target.closest("button[data-page]"), tk = e.target.closest("a.tk");
    if (th) ctx.onSort(th.dataset.sort);
    else if (btn && !btn.disabled) ctx.onPage(Number(btn.dataset.page));
    else if (tk) { e.preventDefault(); ctx.onTicker(tk.dataset.sym); }
  };
}
