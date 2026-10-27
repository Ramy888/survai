// Shared helpers for the Day-1 checks: one live call each, raw responses saved as test fixtures.
// Run with `node --env-file=.env scripts/day1/<check>.mjs`. Keys come from .env and are never printed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const META = "https://api.meta.ai/v1/responses";
const BASETEN = "https://inference.baseten.co/v1/chat/completions";

async function post(url, key, body, timeoutMs) {
  if (!process.env[key]) throw new Error(`${key} missing from .env`);
  const t0 = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env[key]}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  const seconds = (performance.now() - t0) / 1000;
  if (!res.ok || data.error) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 400)}`);
  return { data, seconds };
}

export const meta = (body, timeoutMs = 120_000) => post(META, "META_MODEL_API_KEY", body, timeoutMs);
export const baseten = (body, timeoutMs = 120_000) => post(BASETEN, "BASETEN_API_KEY", body, timeoutMs);

/** Text of the final message of a Responses API result (tool-using runs emit several messages). */
export const responseText = (d) =>
  ((d.output ?? []).filter((o) => o.type === "message").at(-1)?.content ?? [])
    .filter((c) => c.type === "output_text").map((c) => c.text).join("");

/** First JSON object in a model reply, tolerating ```json fences and prose around it. */
export function firstJson(text) {
  if (!text) throw new Error("empty reply (the model may have spent its token budget on reasoning)");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error(`no JSON object in reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(s, e + 1));
}

export const imageDataUrl = (path) => `data:image/jpeg;base64,${readFileSync(path).toString("base64")}`;

/** Save request + raw response; image data is replaced by its file name so fixtures stay small. */
export function save(name, record) {
  mkdirSync("fixtures/recorded", { recursive: true });
  const text = JSON.stringify(record, (k, v) => (typeof v === "string" && v.startsWith("data:image/") ? "<image>" : v), 2);
  writeFileSync(`fixtures/recorded/${name}.json`, text + "\n");
  return `fixtures/recorded/${name}.json`;
}

export function report(name, pass, details) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${details}`);
  if (!pass) process.exitCode = 1;
}
