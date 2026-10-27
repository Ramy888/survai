// protects: the datasheet lookup (cited answers only, cached per model, manual fallback) and device confirmation
// moving a draft survey to uploading; fails_when: an uncited or failed lookup is accepted, a cached model is looked
// up again, a bad spec is stored, or confirmation skips the state machine; no_claim: live web-search quality
// (replayed from fixtures/recorded/datasheet-mx104.json, recorded Oct 27).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import datasheet from "../fixtures/recorded/datasheet-mx104.json";
import { createApp } from "../worker/index";

type Reply = { status: number; body: unknown };
function appWith(replies: Reply[]) {
  const calls: string[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)).model);
    const r = replies.shift();
    if (!r) throw new Error("unexpected model call");
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof globalThis.fetch;
  return { app: createApp({ fetch, sleep: async () => {} }), calls };
}
const send = (app: ReturnType<typeof createApp>, path: string, method = "GET", body?: unknown, passcode = env.DEMO_PASSCODE) =>
  app.request(path, { method, headers: { "Content-Type": "application/json", "X-Passcode": passcode, "CF-Connecting-IP": "203.0.113.20" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

async function newSurvey(app: ReturnType<typeof createApp>, model = "Juniper MX104") {
  const res = await send(app, "/api/surveys", "POST", { site: "S", project: "P", device_model: model, quantity: 1, connects_to: "same_room" });
  return (await res.json<{ id: string }>()).id;
}
const confirmBody = { height_u: 3.5, depth_mm: 240, power_w: 800, feed_type: "DC", feed_count: 2, breaker_rating_a: 16, airflow: "side-to-side", weight_kg: 14.5 };

beforeEach(async () => {
  for (const t of ["surveys", "survey_reps", "rooms", "device_specs", "device_cache", "passcode_failures", "usage_counters"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("POST /api/surveys/:id/device/lookup", () => {
  it("returns the cited datasheet values and caches them per model", async () => {
    const { app, calls } = appWith([{ status: 200, body: datasheet.response }]);
    const id = await newSurvey(app);
    const res = await send(app, `/api/surveys/${id}/device/lookup`, "POST");
    expect(res.status).toBe(200);
    const got = await res.json<{ cached: boolean; spec: Record<string, unknown> }>();
    expect(got.cached).toBe(false);
    expect(got.spec).toMatchObject({ height_u: 3.5, power_w: 800, feed_count: 2, feed_type: "DC" });
    expect((got.spec.sources as { url: string }[]).length).toBeGreaterThan(0);

    const other = await newSurvey(app, "  juniper   mx104 ");
    const again = await (await send(app, `/api/surveys/${other}/device/lookup`, "POST")).json<{ cached: boolean }>();
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("offers manual entry when the lookup fails or has no source", async () => {
    const uncited = { output: [{ type: "message", content: [{ type: "output_text", text: '{"height_u":3.5,"power_w_max":800,"feed_types":["DC"],"feed_count":2,"sources":[]}' }] }] };
    const { app } = appWith([{ status: 200, body: uncited }, ...Array(4).fill({ status: 503, body: {} })]);
    const id = await newSurvey(app);
    for (let i = 0; i < 2; i++) {
      const res = await send(app, `/api/surveys/${id}/device/lookup`, "POST");
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ manual: true });
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM device_cache").first<{ n: number }>())?.n).toBe(0);
  });

  it("says so when the daily budget is used", async () => {
    await env.DB.prepare("INSERT INTO usage_counters (day, kind, count) VALUES (?1, 'model', 1500)").bind(new Date().toISOString().slice(0, 10)).run();
    const { app, calls } = appWith([]);
    const id = await newSurvey(app);
    const res = await send(app, `/api/surveys/${id}/device/lookup`, "POST");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "Processing budget reached" });
    expect(calls).toHaveLength(0);
  });

  it("needs the passcode (it spends credits)", async () => {
    const { app } = appWith([]);
    const id = await newSurvey(app);
    expect((await send(app, `/api/surveys/${id}/device/lookup`, "POST", undefined, "nope")).status).toBe(401);
  });
});

describe("PUT /api/surveys/:id/device", () => {
  it("stores the confirmed device and moves the survey to uploading", async () => {
    const { app } = appWith([]);
    const id = await newSurvey(app);
    const res = await send(app, `/api/surveys/${id}/device`, "PUT", confirmBody);
    expect(res.status).toBe(200);
    const survey = await (await send(app, `/api/surveys/${id}`)).json<Record<string, unknown>>();
    expect(survey.status).toBe("uploading");
    expect(survey.device).toMatchObject({ ...confirmBody, confirmed: true });
  });

  it("rejects impossible values and a second confirmation", async () => {
    const { app } = appWith([]);
    const id = await newSurvey(app);
    expect((await send(app, `/api/surveys/${id}/device`, "PUT", { ...confirmBody, height_u: 0 })).status).toBe(400);
    expect((await send(app, `/api/surveys/${id}/device`, "PUT", { ...confirmBody, feed_type: "solar" })).status).toBe(400);
    expect((await send(app, `/api/surveys/${id}/device`, "PUT", confirmBody)).status).toBe(200);
    expect((await send(app, `/api/surveys/${id}/device`, "PUT", confirmBody)).status).toBe(409);
  });

  it("returns 404 for an unknown survey", async () => {
    const { app } = appWith([]);
    expect((await send(app, "/api/surveys/00000000-0000-4000-8000-000000000000/device", "PUT", confirmBody)).status).toBe(404);
  });
});
