// Canvas candlestick renderer: session shading, volume, price axis, day separators, overlays.
import { nyInfo, sessionOf } from "./session.js";
import { supportResistance, trendLines } from "./indicators.js";

const AXIS_W = 52, TIME_H = 16, VOL_FRAC = 0.2;

const fmtPrice = (p) => p.toFixed(p < 10 ? 3 : 2);

export function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const get = (n) => css.getPropertyValue(n).trim();
  return { bg: get("--bg"), text: get("--text"), muted: get("--muted"), grid: get("--grid"),
           up: get("--up"), down: get("--down"), panel: get("--panel"), accent: get("--accent") };
}

/** Draw bars (columnar {t,o,h,l,c,v}) onto a canvas; returns geometry used for hover lookups. */
export const SMA_LINES = [[50, "#e08a00"], [100, "#9b59d0"], [200, "#0aa5b5"]];

/** Simple moving average over closes; entries before the first full window are null. */
export function smaSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** regClose: regular-session close drawn as a dotted line when it differs from the last bar. */
export function drawChart(canvas, bars, { overlay = "none", intraday = true, regClose = null } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const col = themeColors();
  g.fillStyle = col.bg; g.fillRect(0, 0, w, h);

  const n = bars.t.length;
  if (!n) { g.fillStyle = col.muted; g.fillText("No data", 10, 20); return null; }

  const plotW = w - AXIS_W, priceH = (h - TIME_H) * (1 - VOL_FRAC), volTop = priceH, volH = (h - TIME_H) * VOL_FRAC;
  let lo = Infinity, hi = -Infinity, vmax = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, bars.l[i]); hi = Math.max(hi, bars.h[i]); vmax = Math.max(vmax, bars.v[i] || 0); }
  const pad = (hi - lo) * 0.05 || hi * 0.01;
  lo -= pad; hi += pad;
  const slot = plotW / n, bodyW = Math.max(1, slot * 0.7);
  const x = (i) => i * slot + slot / 2;
  const y = (p) => priceH - ((p - lo) / (hi - lo)) * priceH;

  // Session shading (pre/post) and day separators for intraday data.
  if (intraday) {
    let prevDate = null;
    for (let i = 0; i < n; i++) {
      const { date, minutes } = nyInfo(bars.t[i]);
      if (sessionOf(minutes) !== "regular") { g.fillStyle = col.panel; g.fillRect(i * slot, 0, slot + 0.5, priceH); }
      if (prevDate && date !== prevDate) { g.strokeStyle = col.grid; g.beginPath(); g.moveTo(i * slot, 0); g.lineTo(i * slot, h - TIME_H); g.stroke(); }
      prevDate = date;
    }
  }

  // Price grid and axis labels.
  g.font = "10px system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "middle";
  for (let k = 0; k <= 4; k++) {
    const p = lo + ((hi - lo) * k) / 4, yy = y(p);
    g.strokeStyle = col.grid; g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke();
    g.fillStyle = col.muted; g.fillText(p.toFixed(p < 10 ? 3 : 2), plotW + 4, Math.min(Math.max(yy, 6), priceH - 6));
  }

  // Candles and volume.
  for (let i = 0; i < n; i++) {
    const up = bars.c[i] >= bars.o[i];
    g.fillStyle = g.strokeStyle = up ? col.up : col.down;
    g.beginPath(); g.moveTo(x(i), y(bars.h[i])); g.lineTo(x(i), y(bars.l[i])); g.stroke();
    const top = y(Math.max(bars.o[i], bars.c[i])), bh = Math.max(1, Math.abs(y(bars.o[i]) - y(bars.c[i])));
    g.fillRect(x(i) - bodyW / 2, top, bodyW, bh);
    if (vmax) { const vh = ((bars.v[i] || 0) / vmax) * volH; g.globalAlpha = 0.45; g.fillRect(x(i) - bodyW / 2, volTop + volH - vh, bodyW, vh); g.globalAlpha = 1; }
  }

  // SMA lines over the bars of this timeframe; a line is hidden when there are fewer bars than its period.
  const legend = [];
  g.setLineDash([]); g.lineWidth = 1.2;
  for (const [period, color] of SMA_LINES) {
    if (n < period) continue;
    const values = smaSeries(bars.c, period);
    g.strokeStyle = color; g.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      if (values[i] == null) continue;
      if (started) g.lineTo(x(i), y(values[i])); else { g.moveTo(x(i), y(values[i])); started = true; }
    }
    g.stroke();
    legend.push({ text: `SMA ${period} \u00b7 ${values[n - 1].toFixed(values[n - 1] < 1 ? 4 : 2)}`, color });
  }
  g.lineWidth = 1;

  // Tech. Analysis overlays.
  g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeStyle = col.accent; g.fillStyle = col.accent;
  if (overlay === "sr") {
    for (const lv of supportResistance(bars)) {
      const yy = y(lv.price); g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke();
    }
  } else if (overlay === "trend") {
    for (const { a, b } of trendLines(bars)) {
      const slope = (b.price - a.price) / (b.i - a.i);
      g.beginPath(); g.moveTo(x(a.i), y(a.price)); g.lineTo(x(n - 1), y(b.price + slope * (n - 1 - b.i))); g.stroke();
    }
  }
  g.setLineDash([]);

  // Legend, top-left.
  g.font = "10px system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "top";
  legend.forEach((item, k) => { g.fillStyle = item.color; g.fillText(item.text, 6, 4 + k * 12); });

  // Regular-close dotted line and last-price badge on the price axis.
  const lastClose = bars.c[n - 1];
  const badge = (price, fill, textColor) => {
    const yy = Math.min(Math.max(y(price), 7), priceH - 7);
    g.fillStyle = fill; g.fillRect(plotW, yy - 7, AXIS_W, 14);
    g.fillStyle = textColor; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(fmtPrice(price), plotW + 4, yy);
  };
  if (regClose != null && Math.abs(regClose - lastClose) > 1e-9 && regClose >= lo && regClose <= hi) {
    g.strokeStyle = col.muted; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(0, y(regClose)); g.lineTo(plotW, y(regClose)); g.stroke(); g.setLineDash([]);
    badge(regClose, col.muted, col.bg);
  }
  badge(lastClose, bars.c[n - 1] >= bars.o[n - 1] ? col.up : col.down, "#fff");

  // Time axis: label the first bar of each day (intraday) or every ~6th label slot.
  g.fillStyle = col.muted; g.textBaseline = "top"; g.textAlign = "left";
  let lastLabelX = -100, prevDay = null;
  for (let i = 0; i < n; i++) {
    const d = new Date(bars.t[i] * 1000);
    const day = d.toISOString().slice(0, 10);
    const isNewDay = intraday ? nyInfo(bars.t[i]).date !== prevDay : i % Math.ceil(n / 6) === 0;
    if (intraday) prevDay = nyInfo(bars.t[i]).date;
    if (isNewDay && x(i) - lastLabelX > 44) {
      g.fillText(intraday ? day.slice(5) : day.slice(2, 7), x(i), h - TIME_H + 3);
      lastLabelX = x(i);
    }
  }
  return { slot, plotW, priceH, lo, hi, w, h, n };
}

/** Draw a crosshair plus price/time readout on the overlay canvas; pass null to clear it. */
export function drawCrosshair(canvas, geo, bars, pos, { intraday = true } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!geo || !pos || pos.x > geo.plotW || pos.y > h - TIME_H) return;
  const col = themeColors();
  const i = Math.min(geo.n - 1, Math.max(0, Math.floor(pos.x / geo.slot)));
  const cx = i * geo.slot + geo.slot / 2;
  g.strokeStyle = col.muted; g.lineWidth = 1; g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h - TIME_H); g.moveTo(0, pos.y); g.lineTo(geo.plotW, pos.y); g.stroke();
  g.setLineDash([]);
  g.font = "10px system-ui, sans-serif"; g.textBaseline = "middle";
  if (pos.y <= geo.priceH) {
    const price = geo.hi - (pos.y / geo.priceH) * (geo.hi - geo.lo);
    g.fillStyle = col.text; g.fillRect(geo.plotW, pos.y - 7, AXIS_W, 14);
    g.fillStyle = col.bg; g.textAlign = "left"; g.fillText(price.toFixed(price < 10 ? 3 : 2), geo.plotW + 4, pos.y);
  }
  const d = new Date(bars.t[i] * 1000);
  const label = intraday ? d.toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
                         : d.toISOString().slice(0, 10);
  g.textAlign = "center"; const tw = g.measureText(label).width + 8;
  const lx = Math.min(Math.max(cx, tw / 2), geo.plotW - tw / 2);
  g.fillStyle = col.text; g.fillRect(lx - tw / 2, h - TIME_H, tw, TIME_H);
  g.fillStyle = col.bg; g.textBaseline = "middle"; g.fillText(label, lx, h - TIME_H / 2);
}
