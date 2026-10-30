// protects: the processing job turns uploaded files into a draft (layout items, room facts, request, round-0
// questions, SAM evidence) and only SAM or the budget fail it; fails_when: a step's output is not written, a failed
// model reading fails the survey, a SAM outage leaves it stuck in processing, or a re-run duplicates the draft;
// no_claim: answer quality (replies here are canned; the live run is recorded separately).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import samRacks from "../fixtures/recorded/sam-server-rack.json";
import samTiles from "../fixtures/recorded/sam-floor-tile.json";
import live from "../fixtures/recorded/processing-demo-room.json";
import { createModels } from "../worker/clients/models";
import { runProcessing, type StepRunner } from "../worker/processing";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2]);
const text = (t: string) => ({ output: [{ type: "message", content: [{ type: "output_text", text: t }] }] });
const INVENTORY = {
  room: { w_tiles: 14, d_tiles: 10, confidence: "low" },
  items: [
    { kind: "rack", label: "R1", x_tiles: 3, y_tiles: 2, w_tiles: 1, d_tiles: 1.7, facing: "south", contents: "active", frames: [2, 3], notes: "two devices, open shelves" },
    { kind: "door", label: "D1", x_tiles: 0.5, y_tiles: 0, facing: "north", frames: [1] },
    { kind: "panel", label: "P1", x_tiles: 12, y_tiles: 0, frames: [25] },
  ],
  observations: [{ rule: "R1", text: "loose floor tile by the wall", frames: [26] }],
  notes: "positions are rough",
};
const PANEL = { boxes: [{ breakers: [{ position: 1, kind: "MCB", poles: 1, rating_a: null, dc: true, looks_free: false }, { position: 2, kind: "MCB", poles: 1, rating_a: null, dc: true, looks_free: true }] }], free_breakers: 1, readable: "some" };
const REQUEST = { transcript_ar: "معاينة لتركيب راوتر", translation_en: "Survey to install one router", device: "Juniper MX104", quantity: 1,
  source: "rack under the two devices", route: "top of the rack, overhead ladder", destination: "transmission room rack 40",
  cables: ["single-mode fibre"], questions: [{ text: "Does the rack next to it belong to a customer?", answer_kind: "yes_no" }] };

type Plan = { sam?: "ok" | "busy"; inventory?: unknown; panel?: unknown; reader?: unknown };
function fakeFetch(plan: Plan) {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const parts = body.input?.[0]?.content ?? body.messages?.[0]?.content ?? [];
    const prompt = String(parts[0]?.text ?? "");
    const reply = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (body.model === "sam-3.1") {
      if (plan.sam === "busy") return reply(503, {});
      return reply(200, prompt === "floor tile" ? samTiles.response : samRacks.response);
    }
    const pick = prompt.includes("power distribution") ? plan.panel : prompt.includes("narrated walk") ? plan.reader : plan.inventory;
    if (pick === undefined) return reply(200, text(""));
    const t = typeof pick === "string" ? pick : JSON.stringify(pick);
    return body.model === "meta-models/muse-spark-open-1026" ? reply(200, { choices: [{ message: { content: t } }] }) : reply(200, text(t));
  }) as unknown as typeof fetch;
}
const step: StepRunner = { do: (_name, _config, fn) => fn() };

async function processingSurvey() {
  const id = crypto.randomUUID();
  const room = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, created_at) VALUES (?1, 'S', 'P', 'M', 1, 'same_room', 'processing', 'now')").bind(id),
    env.DB.prepare("INSERT INTO rooms (id, survey_id, role, name) VALUES (?1, ?2, 'devices_hall', 'Devices hall')").bind(room, id),
  ]);
  const add = async (kind: string, bytes: Uint8Array, type: string, i: number) => {
    const key = `t/${id}/${kind}-${i}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
    await env.DB.prepare("INSERT INTO files (id, room_id, kind, r2_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(crypto.randomUUID(), room, kind, key, `2026-10-27T00:00:${String(i).padStart(2, "0")}Z`).run();
  };
  for (let i = 0; i < 8; i++) await add("key_frame", JPEG, "image/jpeg", i);
  await add("path_clip", MP4, "video/mp4", 20);
  await add("panel_photo", JPEG, "image/jpeg", 21);
  return { id, room };
}
const run = (id: string, plan: Plan) => runProcessing({ env, models: createModels({ env, fetch: fakeFetch(plan), sleep: async () => {}, log: () => {} }), step }, id);
const row = <T>(sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).first<T>();

beforeEach(async () => {
  for (const t of ["surveys", "rooms", "files", "layout_items", "findings", "questions", "usage_counters"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("runProcessing", () => {
  it("replays the recorded live run on the demo room into a full draft", async () => {
    const { id, room } = await processingSurvey();
    const [panelA, panelB] = live.replies.panel.map((r) => r.text);
    let panels = 0;
    const plan = { inventory: live.replies.inventory[0].text, reader: live.replies.reader[0].text, get panel() { return panels++ % 2 ? panelB : panelA; } };
    await run(id, plan as Plan);
    const racks = (await env.DB.prepare("SELECT label FROM layout_items WHERE room_id = ?1 AND kind = 'rack'").bind(room).all()).results;
    expect(racks).toHaveLength(6);
    const facts = JSON.parse((await row<{ facts_json: string }>("SELECT facts_json FROM rooms WHERE id = ?1", room))!.facts_json);
    expect(facts.size_tiles).toMatchObject({ w: 9, d: 12 });
    expect(facts.observations.map((o: { rule: string }) => o.rule)).toEqual(["R1", "R2"]);
    const req = JSON.parse((await row<{ request_json: string }>("SELECT request_json FROM surveys WHERE id = ?1", id))!.request_json);
    expect(req).toMatchObject({ device: expect.stringMatching(/MX104/), destination: expect.stringMatching(/40/) });
    expect(req.questions[0].text).toMatch(/customer/);
  });

  it("writes the draft layout, room facts, request and round-0 questions, then moves to layout review", async () => {
    const { id, room } = await processingSurvey();
    await run(id, { inventory: INVENTORY, panel: PANEL, reader: REQUEST });
    expect((await row<{ status: string }>("SELECT status FROM surveys WHERE id = ?1", id))!.status).toBe("layout_review");
    const items = (await env.DB.prepare("SELECT kind, label, props_json, source FROM layout_items WHERE room_id = ?1 ORDER BY label").bind(room).all<{ kind: string; label: string; props_json: string; source: string }>()).results;
    expect(items.map((i) => `${i.kind}:${i.label}:${i.source}`)).toEqual(["door:D1:ai", "panel:P1:ai", "rack:R1:ai"]);
    expect(JSON.parse(items[2].props_json)).toMatchObject({ height_u: 42, is_target: false, off_limits: false, contents: "active" });
    const facts = JSON.parse((await row<{ facts_json: string }>("SELECT facts_json FROM rooms WHERE id = ?1", room))!.facts_json);
    expect(facts.size_tiles).toEqual({ w: 14, d: 10, confidence: "low" });
    expect(facts.sam).toMatchObject({ frames: 8, tile_grid_ratio: 1 });
    expect(facts.breakers_draft).toHaveLength(2);
    const req = JSON.parse((await row<{ request_json: string }>("SELECT request_json FROM surveys WHERE id = ?1", id))!.request_json);
    expect(req.destination).toBe("transmission room rack 40");
    const q = await row<{ text: string; agent: string; round: number }>("SELECT q.text, f.agent, f.round FROM questions q JOIN findings f ON f.id = q.finding_id WHERE f.survey_id = ?1", id);
    expect(q).toMatchObject({ agent: "request", round: 0, text: "Does the rack next to it belong to a customer?" });
    expect((await row<{ n: number }>("SELECT COUNT(*) AS n FROM files WHERE masks_json IS NOT NULL"))!.n).toBe(8);
  });

  it("deletes the narrated video once it is read, so only the blurred frames are kept", async () => {
    const { id } = await processingSurvey();
    const key = (await row<{ r2_key: string }>("SELECT r2_key FROM files WHERE kind = 'path_clip'"))!.r2_key;
    await run(id, { inventory: INVENTORY, panel: PANEL, reader: REQUEST });
    expect((await row<{ n: number }>("SELECT COUNT(*) AS n FROM files WHERE kind = 'path_clip'"))!.n).toBe(0);
    expect(await env.MEDIA.head(key)).toBeNull();
    expect(JSON.parse((await row<{ request_json: string }>("SELECT request_json FROM surveys WHERE id = ?1", id))!.request_json).destination).toBe("transmission room rack 40");
  });

  it("still reaches layout review when the model readings fail, with the reasons noted", async () => {
    const { id, room } = await processingSurvey();
    await run(id, { inventory: "I cannot see a room here.", panel: undefined, reader: { transcript_ar: "x" } });
    expect((await row<{ status: string }>("SELECT status FROM surveys WHERE id = ?1", id))!.status).toBe("layout_review");
    expect((await row<{ n: number }>("SELECT COUNT(*) AS n FROM layout_items WHERE room_id = ?1", room))!.n).toBe(0);
    const req = JSON.parse((await row<{ request_json: string }>("SELECT request_json FROM surveys WHERE id = ?1", id))!.request_json);
    expect(req.notes.join(" ")).toMatch(/room inventory.*panel photo|panel photo.*room inventory/s);
    const facts = JSON.parse((await row<{ facts_json: string }>("SELECT facts_json FROM rooms WHERE id = ?1", room))!.facts_json);
    expect(facts.processing_notes.join(" ")).toMatch(/room inventory/); // kept even when the clip reading succeeds
  });

  it("sends the survey back to uploading with a reason when SAM is down", async () => {
    const { id } = await processingSurvey();
    await run(id, { sam: "busy" });
    expect(await row("SELECT status, processing_error FROM surveys WHERE id = ?1", id)).toMatchObject({
      status: "uploading", processing_error: expect.stringContaining("Image analysis is unavailable"),
    });
  });

  it("does not duplicate the draft when it runs again", async () => {
    const { id, room } = await processingSurvey();
    await run(id, { inventory: INVENTORY, panel: PANEL, reader: REQUEST });
    await env.DB.prepare("UPDATE surveys SET status = 'processing' WHERE id = ?1").bind(id).run();
    await run(id, { inventory: INVENTORY, panel: PANEL, reader: REQUEST });
    expect((await row<{ n: number }>("SELECT COUNT(*) AS n FROM layout_items WHERE room_id = ?1", room))!.n).toBe(3);
    expect((await row<{ n: number }>("SELECT COUNT(*) AS n FROM questions"))!.n).toBe(1);
  });

  it("reads the narrated clip first, so the draft marks the rack the engineer named as the target", async () => {
    const { id, room } = await processingSurvey();
    const prompts: string[] = [];
    const base = fakeFetch({ panel: PANEL, reader: REQUEST, inventory: { ...INVENTORY, items: INVENTORY.items.map((i) => (i.label === "R1" ? { ...i, target: true } : i)) } });
    const spy = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      prompts.push(String((body.input?.[0]?.content ?? body.messages?.[0]?.content ?? [])[0]?.text ?? ""));
      return base(url, init);
    }) as unknown as typeof fetch;
    await runProcessing({ env, models: createModels({ env, fetch: spy, sleep: async () => {}, log: () => {} }), step }, id);
    const inventoryPrompt = prompts.find((p) => p.includes("drafting the inventory"))!;
    expect(prompts.findIndex((p) => p.includes("narrated walk"))).toBeLessThan(prompts.indexOf(inventoryPrompt));
    expect(inventoryPrompt).toContain("rack under the two devices");
    const r1 = await row<{ props_json: string }>("SELECT props_json FROM layout_items WHERE room_id = ?1 AND label = 'R1'", room);
    expect(JSON.parse(r1!.props_json).is_target).toBe(true);
    const facts = JSON.parse((await row<{ facts_json: string }>("SELECT facts_json FROM rooms WHERE id = ?1", room))!.facts_json);
    expect(facts.inventory_model).toBe("muse-spark-open");
    expect(facts).toHaveProperty("sam_free_u");
    // SAM is also asked for the devices in the racks and the shelves, and they are kept with each frame.
    const masks = JSON.parse((await row<{ masks_json: string }>("SELECT masks_json FROM files WHERE kind = 'key_frame' LIMIT 1"))!.masks_json);
    expect(Object.keys(masks).sort()).toEqual(["devices", "racks", "shelves", "tiles"]);
  });
});
