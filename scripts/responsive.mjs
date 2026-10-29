// Responsive QA (AC 14): every screen at phone, tablet and laptop sizes, light and dark, in headless Chrome over CDP.
// Fails when any page scrolls sideways; writes full-page screenshots for a contact-sheet review.
// Usage: node scripts/responsive.mjs <base-url> <screens.json> <out-dir>
//   screens.json: [{ "name": "1-new", "path": "/", "click": "optional button text to press first" }]
// Phone sizes use mobile emulation with touch; window-size alone would hit headless Chrome's ~500 px minimum.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, screensFile, out] = process.argv.slice(2);
if (!base || !screensFile || !out) { console.error("Usage: node scripts/responsive.mjs <base-url> <screens.json> <out-dir>"); process.exit(1); }
const screens = JSON.parse(readFileSync(screensFile, "utf8"));
const SIZES = [[360, 780, true], [390, 844, true], [820, 1180, true], [1180, 820, false]];
const MAX_H = 4000; // long pages are cut here in the screenshot only; the overflow check covers the whole page
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });

const port = 9355;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "resp-"))}`, "--hide-scrollbars", "--no-first-run", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result?.value;
await send("Page.enable");

const failures = [];
for (const [w, h, mobile] of SIZES) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  for (const theme of ["light", "dark"]) {
    for (const s of screens) {
      // the theme is read by index.html's inline script on load
      await send("Page.navigate", { url: new URL("/favicon.ico", base).href }); await sleep(300);
      await evaluate(`localStorage.setItem("theme", "${theme}")`);
      await send("Page.navigate", { url: new URL(s.path, base).href }); await sleep(2500);
      if (s.click) {
        await evaluate(`[...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === ${JSON.stringify(s.click)} || b.getAttribute("aria-label") === ${JSON.stringify(s.click)})?.click()`);
        await sleep(1500);
      }
      const over = await evaluate("document.documentElement.scrollWidth - innerWidth");
      const offenders = over > 0 ? await evaluate(`[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5)
        .slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : ""))`) : [];
      const tag = `${w}x${h}-${theme}-${s.name}`;
      if (over > 0) failures.push(`${tag}: scrolls sideways by ${over}px (${offenders.join(", ")})`);
      // Scrolled to the bottom, the page's last content must end above the fixed action bar, or it can never be reached.
      const hidden = await evaluate(`(() => { scrollTo(0, document.documentElement.scrollHeight); const bar = document.querySelector(".actions");
        const last = document.querySelector("main")?.lastElementChild?.lastElementChild ?? document.querySelector("main")?.lastElementChild;
        return bar && last ? Math.round(last.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) : 0; })()`);
      if (hidden > 0) failures.push(`${tag}: the last content ends ${hidden}px under the action bar`);
      await evaluate("scrollTo(0, 0)");
      const height = Math.min(MAX_H, await evaluate("document.documentElement.scrollHeight"));
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height, scale: 1 } });
      writeFileSync(join(out, `${tag}.png`), Buffer.from(shot.result.data, "base64"));
      console.log(`${over > 0 || hidden > 0 ? "FAIL" : "ok  "} ${tag}`);
    }
  }
}
ws.close(); chrome.kill();
if (failures.length) { console.error(`\n${failures.length} problem(s):\n${failures.join("\n")}`); process.exit(1); }
console.log(`\nNo page scrolls sideways or hides content under the action bar (${SIZES.length} sizes × 2 themes × ${screens.length} screens).`);
