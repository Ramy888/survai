// protects: the optional in-app blur. One frame goes to SAM 3.1 to find what to blur; the route returns boxes and
// stores nothing; it is passcode-only, open only while uploading, JPEG-only, size-capped and on the SAM budget.
// The footage note records how a room's frames were made (video or prepared, blurred or not) for the replay.
// fails_when: the frame is written to R2 or the database, a low-confidence box is kept, a closed survey or a
// non-JPEG is accepted, or the budget is skipped; no_claim: how well SAM finds people (checked live by the owner).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../worker/index";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const samText = (boxes: string) => ({ output: [{ type: "message", content: [{ type: "output_text", text: boxes }] }] });
const box = (x1: number, y1: number, x2: number, y2: number, c: number) => `<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=478;h=850;c=${c}|><|mask;x=0;y=0;c=${c};data=1,1,!|>`;

function appWith(byConcept: Record<string, string>) {
  const asked: string[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const concept = body.input[0].content[0].text as string;
    asked.push(concept);
    return new Response(JSON.stringify(samText(byConcept[concept] ?? "")), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { app: createApp({ fetch, sleep: async () => {} }), asked };
}

const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
async function seed(status = "uploading") {
  const id = crypto.randomUUID();
  await env.DB.batch([
    q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, layout_version, created_at) VALUES (?1, 'S', 'P', 'M', 1, 'same_room', ?2, 0, 'now')", id, status),
    q("INSERT INTO rooms (id, survey_id, role, name, facts_json, layout_saved) VALUES (?1, ?2, 'devices_hall', 'Devices hall', '{\"spare_ac_btu\":6000}', 0)", crypto.randomUUID(), id),
  ]);
  return id;
}
const post = (app: ReturnType<typeof createApp>, path: string, body: BodyInit, type = "image/jpeg", passcode = env.DEMO_PASSCODE) =>
  app.request(path, { method: "POST", headers: { "Content-Type": type, "X-Passcode": passcode, "CF-Connecting-IP": "203.0.113.90" }, body }, env);

beforeEach(async () => {
  for (const t of ["surveys", "rooms", "files", "usage_counters", "passcode_failures"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("POST /api/surveys/:id/redact", () => {
  it("returns SAM 3.1's boxes for labels and people, drops low-confidence ones, and stores nothing", async () => {
    const id = await seed();
    const { app, asked } = appWith({ label: box(40, 120, 267, 188, 0.92) + box(0, 0, 5, 5, 0.2), person: box(300, 100, 420, 800, 0.81) });
    const res = await post(app, `/api/surveys/${id}/redact`, JPEG);
    expect(res.status).toBe(200);
    expect(asked.sort()).toEqual(["label", "person"]);
    expect(await res.json()).toEqual({
      width: 478, height: 850,
      boxes: [{ x1: 40, y1: 120, x2: 267, y2: 188, concept: "label" }, { x1: 300, y1: 100, x2: 420, y2: 800, concept: "person" }],
    });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM files").first<{ n: number }>())!.n).toBe(0);
    expect((await env.MEDIA.list()).objects.filter((o) => o.key.includes(id))).toEqual([]);
  });

  it("is passcode-only, open only while uploading, and takes only a JPEG up to 3 MB", async () => {
    const { app } = appWith({});
    const id = await seed();
    expect((await post(app, `/api/surveys/${id}/redact`, JPEG, "image/jpeg", "wrong")).status).toBe(401);
    expect((await post(app, `/api/surveys/${id}/redact`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).status).toBe(415);
    expect((await post(app, `/api/surveys/${id}/redact`, new Uint8Array(3 * 1024 * 1024 + 10).fill(0xff))).status).toBe(413);
    const closed = await seed("layout_review");
    expect((await post(app, `/api/surveys/${closed}/redact`, JPEG)).status).toBe(409);
    expect((await post(app, "/api/surveys/00000000-0000-4000-8000-000000000000/redact", JPEG)).status).toBe(404);
  });

  it("refuses with the budget message once the day's SAM calls are used up", async () => {
    const id = await seed();
    await env.DB.prepare("INSERT INTO usage_counters (day, kind, count) VALUES (?1, 'sam', ?2)").bind(new Date().toISOString().slice(0, 10), Number(env.SAM_DAILY_CAP)).run();
    const { app, asked } = appWith({ label: box(1, 1, 9, 9, 0.9) });
    expect((await post(app, `/api/surveys/${id}/redact`, JPEG)).status).toBe(429);
    expect(asked).toEqual([]);
  });
});

describe("POST /api/surveys/:id/rooms/:role/footage", () => {
  it("records how the room's frames were made, keeping the room's other facts", async () => {
    const id = await seed();
    const { app } = appWith({});
    const res = await post(app, `/api/surveys/${id}/rooms/devices_hall/footage`, JSON.stringify({ source: "video", blurred: true }), "application/json");
    expect(res.status).toBe(200);
    const facts = JSON.parse((await env.DB.prepare("SELECT facts_json FROM rooms WHERE survey_id = ?1").bind(id).first<{ facts_json: string }>())!.facts_json);
    expect(facts).toEqual({ spare_ac_btu: 6000, footage: { source: "video", blurred: true } });
    expect((await post(app, `/api/surveys/${id}/rooms/devices_hall/footage`, JSON.stringify({ source: "phone" }), "application/json")).status).toBe(400);
  });
});
