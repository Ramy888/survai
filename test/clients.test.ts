// protects: model calls retry, fall back and respect the daily caps exactly as the spec's error map says;
// fails_when: a retry/backoff/fallback rule changes, the cap lets a call through, a reply is parsed wrong, or a
// key reaches the logs; no_claim: live API behaviour (replayed from fixtures/recorded, recorded Oct 27).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import datasheet from "../fixtures/recorded/datasheet-mx104.json";
import lead from "../fixtures/recorded/lead-round1.json";
import panelOpen from "../fixtures/recorded/panel-pwr1-spark-open.json";
import samTiles from "../fixtures/recorded/sam-floor-tile.json";
import {
  BudgetExceeded, ModelRateLimited, ModelRequestError, SamUnavailable, createModels, parseSamBoxes,
} from "../worker/clients/models";

type Step = { status?: number; body?: unknown; timeout?: boolean };
const metaOk = (response: unknown): Step => ({ status: 200, body: response });
const basetenText = (content: string): Step => ({ status: 200, body: { choices: [{ message: { content } }] } });
const metaText = (text: string): Step => ({ status: 200, body: { output: [{ type: "message", content: [{ type: "output_text", text }] }] } });

function harness(script: Record<string, Step[]>, vars: Partial<Env> = {}) {
  const calls: { model: string; url: string; body: Record<string, unknown> }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const model = body.model as string;
    calls.push({ model, url, body });
    const step = script[model]?.shift();
    if (!step) throw new Error(`unexpected call to ${model}`);
    if (step.timeout) throw new DOMException("timed out", "TimeoutError");
    return new Response(JSON.stringify(step.body ?? {}), { status: step.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  const models = createModels({ env: { ...env, ...vars }, fetch, sleep: async (ms) => void sleeps.push(ms), log: (r) => void logs.push(JSON.stringify(r)) });
  return { models, calls, sleeps, logs };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM usage_counters").run();
});

describe("replies from recorded responses", () => {
  it("reads the Lead's final message from a Muse Wonder response", async () => {
    const h = harness({ "muse-wonder-1.0": [metaOk(lead.response)] });
    const r = await h.models.run("lead", { text: "round 1" });
    expect(r.model).toBe("muse-wonder-1.0");
    expect(r.fellBack).toBe(false);
    expect(JSON.parse(r.text).next).toBe("another_round");
  });

  it("reads the last message of a multi-message web-search response", async () => {
    const h = harness({ "muse-spark-1.3": [metaOk(datasheet.response)] });
    const r = await h.models.run("datasheet", { text: "MX104", webSearch: true });
    expect(JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)).height_u).toBe(3.5);
  });

  it("reads a Baseten chat completion for the department agents", async () => {
    const h = harness({ "meta-models/muse-spark-open-1026": [metaOk(panelOpen.response)] });
    const r = await h.models.run("agent", { text: "panel", images: ["data:image/jpeg;base64,AAAA"] });
    expect(r.model).toBe("muse-spark-open");
    expect(h.calls[0].url).toContain("baseten");
  });
});

describe("request bodies", () => {
  it("sends the walk-through video to Meta without storing the request (a 20 MB video is over the stored-request size)", async () => {
    const h = harness({ "muse-spark-1.3": [metaText("{}")] });
    await h.models.run("reader", { text: "narration", videos: ["data:video/mp4;base64,AAAA"] });
    expect(h.calls[0].body.store).toBe(false);
    expect(JSON.stringify(h.calls[0].body.input)).toContain("input_video");
  });
});

describe("retries and fallbacks", () => {
  it("retries 429 with 1-2-4 s backoff, then falls back from Spark Open to Spark 1.3", async () => {
    const busy = { status: 429, body: { error: "busy" } };
    const h = harness({ "meta-models/muse-spark-open-1026": [busy, busy, busy, busy], "muse-spark-1.3": [metaText("ok")] });
    const r = await h.models.run("agent", { text: "x" });
    expect(h.sleeps).toEqual([1000, 2000, 4000]);
    expect(r).toMatchObject({ model: "muse-spark-1.3", fellBack: true, text: "ok" });
  });

  it("recovers after one 503 without falling back", async () => {
    const h = harness({ "muse-spark-1.3": [{ status: 503 }, metaText("ok")] });
    expect((await h.models.run("reader", { text: "x" })).fellBack).toBe(false);
    expect(h.sleeps).toEqual([1000]);
  });

  it("sends a slow Lead straight to Spark 1.3 (no retry on Muse Wonder)", async () => {
    const h = harness({ "muse-wonder-1.0": [{ timeout: true }], "muse-spark-1.3": [metaText("{}")] });
    const r = await h.models.run("lead", { text: "x" });
    expect(h.calls.map((c) => c.model)).toEqual(["muse-wonder-1.0", "muse-spark-1.3"]);
    expect(r.fellBack).toBe(true);
  });

  it("retries a Spark 1.3 timeout once", async () => {
    const h = harness({ "muse-spark-1.3": [{ timeout: true }, metaText("ok")] });
    expect((await h.models.run("panel", { text: "x" })).text).toBe("ok");
  });

  it("treats an empty reply as a refusal and falls back", async () => {
    const h = harness({ "meta-models/muse-spark-open-1026": [basetenText("")], "muse-spark-1.3": [metaText("ok")] });
    expect((await h.models.run("agent", { text: "x" })).model).toBe("muse-spark-1.3");
  });

  it("does not retry a 400 on the same model but tries the next one (limits differ per model)", async () => {
    const h = harness({ "meta-models/muse-spark-open-1026": [{ status: 400, body: { error: { message: "Too many images: 12 (max 8)" } } }], "muse-spark-1.3": [metaText("ok")] });
    expect((await h.models.run("inventory", { text: "x" })).model).toBe("muse-spark-1.3");
    expect(h.calls.map((c) => c.model)).toEqual(["meta-models/muse-spark-open-1026", "muse-spark-1.3"]);
  });

  it("fails with ModelRequestError when the last model also rejects the request", async () => {
    const h = harness({ "muse-spark-1.3": [{ status: 400, body: { error: { message: "bad" } } }] });
    await expect(h.models.run("reader", { text: "x" })).rejects.toBeInstanceOf(ModelRequestError);
    expect(h.calls).toHaveLength(1);
  });

  it("fails with ModelRateLimited when the last model in a route stays busy", async () => {
    const busy = { status: 502 };
    const h = harness({ "muse-spark-1.3": [busy, busy, busy, busy] });
    await expect(h.models.run("reader", { text: "x" })).rejects.toBeInstanceOf(ModelRateLimited);
  });
});

describe("SAM 3.1", () => {
  it("parses boxes, image size and confidence from the recorded reply", () => {
    const text = samTiles.response.output.flatMap((o: { content?: { text?: string }[] }) => o.content ?? []).map((c) => c.text ?? "").join("");
    const r = parseSamBoxes(text);
    expect(r.boxes).toHaveLength(8);
    expect(r).toMatchObject({ width: 478, height: 850 });
    expect(r.boxes[0]).toEqual({ x1: 455, y1: 448, x2: 477, y2: 465, c: expect.closeTo(0.675, 3) });
  });

  it("treats no match as an empty result, not an error", () => {
    expect(parseSamBoxes("")).toEqual({ boxes: [], width: 0, height: 0 });
  });

  it("gives up with SamUnavailable after three retries", async () => {
    const busy = { status: 429 };
    const h = harness({ "sam-3.1": [busy, busy, busy, busy] });
    await expect(h.models.segment("data:image/jpeg;base64,AAAA", "floor tile")).rejects.toBeInstanceOf(SamUnavailable);
  });
});

describe("daily caps", () => {
  it("refuses before calling once the day's model cap is used", async () => {
    const h = harness({ "muse-spark-1.3": [metaText("1"), metaText("2"), metaText("3")] }, { MODEL_DAILY_CAP: "2" });
    await h.models.run("reader", { text: "a" });
    await h.models.run("reader", { text: "b" });
    await expect(h.models.run("reader", { text: "c" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(h.calls).toHaveLength(2);
  });

  it("counts SAM separately from model calls", async () => {
    await env.DB.prepare("INSERT INTO usage_counters (day, kind, count) VALUES (?1, 'model', 1500)").bind(new Date().toISOString().slice(0, 10)).run();
    const h = harness({ "sam-3.1": [metaText("")] });
    await expect(h.models.segment("data:image/jpeg;base64,AAAA", "floor tile")).resolves.toMatchObject({ boxes: [] });
  });
});

it("never writes an API key into the logs", async () => {
  const h = harness({ "muse-spark-1.3": [{ status: 503 }, metaText("ok")] });
  await h.models.run("reader", { text: "x" }, { survey: "s1", round: 1, agent: "request" });
  expect(h.logs.length).toBeGreaterThan(0);
  for (const key of [env.META_MODEL_API_KEY, env.BASETEN_API_KEY]) expect(h.logs.join("\n")).not.toContain(key);
  expect(JSON.parse(h.logs[0])).toMatchObject({ survey: "s1", round: 1, agent: "request", model: "muse-spark-1.3" });
});
