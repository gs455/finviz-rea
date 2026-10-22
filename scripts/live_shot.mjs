// Screenshot the LIVE app through the hub (signed in) with headless Chrome over CDP.
// Usage: HUB_PASSWORD=... node scripts/live_shot.mjs <light|dark> <out.png> [--click "<selector>"]
// Needs Node 22 (global WebSocket/fetch). The password and cookie are never printed.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [theme, outFile] = process.argv.slice(2);
const HUB = "https://armanai.pages.dev";
const PORT = 9333;

const loginResponse = await fetch(`${HUB}/__login`, {
  method: "POST",
  body: new URLSearchParams({ pw: process.env.HUB_PASSWORD, next: "/" }),
  redirect: "manual",
});
const setCookie = loginResponse.headers.get("set-cookie") || "";
const [cookieName, cookieValue] = setCookie.split(";")[0].split("=");
if (!cookieValue) throw new Error("hub sign-in failed");

const chrome = spawn("/usr/bin/google-chrome", [
  "--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`,
  "--window-size=1400,1000", "--user-data-dir=/tmp/live-shot-profile", "about:blank",
], { stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 2500));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((resolve) => (socket.onopen = resolve));
let nextId = 1;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) pending.get(message.id)(message.result);
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});

await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Network.setCookie", { name: cookieName, value: cookieValue, domain: "armanai.pages.dev", path: "/", secure: true });
await send("Page.navigate", { url: `${HUB}/finviz-rea/` });
await new Promise((resolve) => setTimeout(resolve, 9000));
if (theme === "dark") {
  await send("Runtime.evaluate", { expression: "document.getElementById('theme-btn')?.click()" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
const extra = process.argv.indexOf("--click");
if (extra > 0) {
  await send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(process.argv[extra + 1])})?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(outFile, Buffer.from(shot.data, "base64"));
chrome.kill();
socket.close();
