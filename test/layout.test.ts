// protects: the engineer's layout save (version check, validation, Lead items untouched, facts merged) and the move
// into the meeting once every room is saved; fails_when: a stale tab overwrites a newer layout, bad racks or facts
// are stored, Lead items are lost or bumped, or the meeting starts before every room is saved or starts twice;
// no_claim: the screen (checked in the browser).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../worker/index";

const started: string[] = [];
const app = createApp({ startRound: async (_e, id, run, round) => void started.push(`${id}:${run}:${round}`) });
const req = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { "Content-Type": "application/json", "X-Passcode": env.DEMO_PASSCODE, "CF-Connecting-IP": "203.0.113.50", ...init.headers } }, env);
const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);

async function seed(connects_to = "same_room", status = "layout_review") {
  const id = crypto.randomUUID();
  const hall = crypto.randomUUID();
  const other = crypto.randomUUID();
  await env.DB.batch([
    q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, layout_version, request_json, created_at) VALUES (?1, 'S', 'P', 'M', 1, ?2, ?3, 0, ?4, 'now')",
      id, connects_to, status, JSON.stringify({ source: "R5", route: "ladder", destination: "TX 40", translation_en: "Install one router" })),
    q("INSERT INTO rooms (id, survey_id, role, name, facts_json) VALUES (?1, ?2, 'devices_hall', 'Devices hall', ?3)", hall, id,
      JSON.stringify({ size_tiles: { w: 9, d: 12, confidence: "low" }, sam: { frames: 30 }, breakers_draft: [{ position: 1, kind: "MCB" }], observations: [{ rule: "R1", text: "stepladder", frames: [1] }], spare_ac_btu: null })),
    ...(connects_to === "other_room" ? [q("INSERT INTO rooms (id, survey_id, role, name, facts_json) VALUES (?1, ?2, 'connect_to', 'Connect-to room', '{}')", other, id)] : []),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, facing, props_json, source) VALUES ('ai_r5', ?1, 'rack', 'R5', 0.5, 7.8, 1, 1.7, 'east', '{\"height_u\":42}', 'ai')", hall),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, props_json, source) VALUES ('ai_c1', ?1, 'column', 'C1', 2.2, 9, 1, 1, '{}', 'ai')", hall),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, props_json, source) VALUES ('lead_p', ?1, 'cable_path', 'fibre-1', 1, 1, '{\"cable_type\":\"fibre\",\"route\":\"overhead\",\"points\":[[1,1],[2,1]]}', 'lead')", hall),
  ]);
  return { id, hall };
}

const rack = (o: object = {}) => ({ id: "ai_r5", kind: "rack", label: "R5", x_tiles: 0.5, y_tiles: 7.8, w_tiles: 1, d_tiles: 1.7, facing: "east", props: { height_u: 42, free_blocks: [{ from_u: 10, to_u: 30 }], is_target: true, off_limits: false }, ...o });
const facts = { spare_ac_btu: 6000, ladder_height_m: 2.6, ac_count: 2, breakers_confirmed: [{ position: 3, dc: true, rating_a: 16, free: true }] };
const save = (id: string, body: object, role = "devices_hall") => req(`/api/surveys/${id}/rooms/${role}/layout`, { method: "PUT", body: JSON.stringify(body) });

beforeEach(async () => {
  started.length = 0;
  for (const t of ["surveys", "rooms", "layout_items", "passcode_failures"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("GET layout", () => {
  it("returns the draft items, facts, version and request", async () => {
    const { id } = await seed();
    const r = await (await req(`/api/surveys/${id}/rooms/devices_hall/layout`)).json<Record<string, any>>();
    expect(r.layout_version).toBe(0);
    expect(r.items.map((i: { label: string }) => i.label).sort()).toEqual(["C1", "R5", "fibre-1"]);
    expect(r.facts).toMatchObject({ breakers_draft: [{ position: 1 }], observations: [{ rule: "R1" }] });
    expect(r.request).toMatchObject({ destination: "TX 40" });
  });
});

describe("PUT layout", () => {
  it("saves the engineer's items and facts, keeps Lead items, bumps the version and starts the meeting", async () => {
    const { id, hall } = await seed();
    const res = await save(id, { layout_version: 0, items: [rack()], facts });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ layout_version: 1, status: "deliberating", meeting_started: true });
    const items = await env.DB.prepare("SELECT label, source FROM layout_items WHERE room_id = ?1 ORDER BY label").bind(hall).all();
    expect(items.results).toEqual([{ label: "R5", source: "engineer" }, { label: "fibre-1", source: "lead" }]); // C1 removed by the engineer
    const f = JSON.parse((await env.DB.prepare("SELECT facts_json FROM rooms WHERE id = ?1").bind(hall).first<{ facts_json: string }>())!.facts_json);
    expect(f).toMatchObject({ spare_ac_btu: 6000, ladder_height_m: 2.6, breakers_confirmed: [{ position: 3 }], sam: { frames: 30 }, observations: [{ rule: "R1" }] });
    expect(started).toEqual([`${id}:1:1`]);
  });

  it("refuses a stale save from a second tab", async () => {
    const { id } = await seed();
    expect((await save(id, { layout_version: 0, items: [rack()], facts })).status).toBe(200);
    const stale = await save(id, { layout_version: 0, items: [rack({ label: "R9" })], facts });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ layout_version: 1 });
  });

  it("waits for every room before the meeting starts, then starts it once", async () => {
    const { id } = await seed("other_room");
    expect(await (await save(id, { layout_version: 0, items: [rack()], facts })).json()).toMatchObject({ status: "layout_review", meeting_started: false });
    expect(await (await save(id, { layout_version: 1, items: [], facts: { inter_room_m: 25 } }, "connect_to")).json()).toMatchObject({ status: "deliberating", meeting_started: true });
    expect(started).toEqual([`${id}:1:1`]);
  });

  it("only bumps the version during the meeting (the engineer reruns it)", async () => {
    const { id } = await seed("same_room", "deliberating");
    expect(await (await save(id, { layout_version: 0, items: [rack()], facts })).json()).toEqual({ layout_version: 1, status: "deliberating", meeting_started: false });
    expect(started).toEqual([]);
  });

  it("rejects two target racks, free U outside the rack, bad facts and Lead items", async () => {
    const { id } = await seed();
    expect((await save(id, { layout_version: 0, items: [rack(), rack({ id: undefined, label: "R6" })], facts })).status).toBe(400);
    expect((await save(id, { layout_version: 0, items: [rack({ props: { height_u: 42, free_blocks: [{ from_u: 40, to_u: 45 }], is_target: true } })], facts })).status).toBe(400);
    expect((await save(id, { layout_version: 0, items: [rack()], facts: { spare_ac_btu: -5 } })).status).toBe(400);
    expect((await save(id, { layout_version: 0, items: [rack(), { id: "lead_p", kind: "cable_path", label: "x", x_tiles: 1, y_tiles: 1, props: {} }], facts })).status).toBe(400);
    expect(started).toEqual([]);
  });

  it("refuses saves outside layout review and the meeting", async () => {
    const { id } = await seed("same_room", "approved");
    expect((await save(id, { layout_version: 0, items: [rack()], facts })).status).toBe(409);
  });
});
