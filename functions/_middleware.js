// Hub gate: only requests proxied by the armanai hub (X-Hub-Proxy-Key) get through.
// Browsers visiting fv-rea.pages.dev directly are sent to the hub sign-in.
export async function onRequest({ request, env, next }) {
  const given = request.headers.get("X-Hub-Proxy-Key") || "";
  const ok = env.HUB_PROXY_KEY && given.length === env.HUB_PROXY_KEY.length
    && timingSafeEqual(given, env.HUB_PROXY_KEY);
  if (ok) return next();
  const wantsPage = (request.headers.get("Accept") || "").includes("text/html");
  if (wantsPage) return Response.redirect("https://armanai.pages.dev/finviz-rea", 301);
  return new Response("Unauthorized", { status: 401 });
}

function timingSafeEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
