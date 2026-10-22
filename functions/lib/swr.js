// Hand-written stale-while-revalidate on the Cache API (cache.put ignores the SWR directive).
// Entries are stored for `maxAge + staleFor` seconds; `x-fetched-at` says when they were made.

export async function withSwr(request, ctx, { fresh, staleFor }, produce) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  const now = Date.now();

  if (hit) {
    const age = (now - Number(hit.headers.get("x-fetched-at"))) / 1000;
    if (age <= fresh) return tag(hit, "HIT", age);
    ctx.waitUntil(refresh());
    return tag(hit, "STALE", age);
  }
  return tag(await refresh(), "MISS", 0);

  async function refresh() {
    const res = await produce();
    if (!res.ok) return res;
    const stored = new Response(res.clone().body, res);
    stored.headers.set("x-fetched-at", String(Date.now()));
    stored.headers.set("Cache-Control", `public, max-age=${fresh + staleFor}`);
    ctx.waitUntil(cache.put(key, stored));
    return res;
  }
}

function tag(res, state, age) {
  const out = new Response(res.body, res);
  out.headers.set("X-Cache", state);
  out.headers.set("Age-Seconds", age.toFixed(0));
  return out;
}
