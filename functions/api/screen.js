// GET /api/screen?f=sh_price_o1,sh_avgvol_o50&s=ta_topgainers_ah&o=-ahChange&r=1&n=120&t=AAPL,F
// Filters, ranks and pages the R2 snapshot in memory. See functions/lib/screen.js for the rules.
import { loadStore } from "../lib/store.js";
import { screen } from "../lib/screen.js";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.search.length > 2048) return json({ error: "query too long" }, 400);
  const t0 = Date.now();
  const { snap, ah } = await loadStore(env);
  const t1 = Date.now();
  if (!snap) return json({ error: "no snapshot yet" }, 503);
  const q = Object.fromEntries(url.searchParams);
  const cpu0 = performance.now();
  const body = screen(snap, ah, q);
  const compute = performance.now() - cpu0;
  return json(body, 200, {
    "Cache-Control": "private, max-age=60",
    "Server-Timing": `store;dur=${t1 - t0}, screen;dur=${compute.toFixed(1)}, total;dur=${Date.now() - t0}`,
  });
}
