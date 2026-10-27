// protects: the report mirrors every field of the company survey form from stored data (AC 10), the floor plan's
// labels equal the calculations (cable lengths, clearances), the reserved area is hatched, and model text can never
// be rendered as HTML; fails_when: a form section or field disappears, a label drifts from its calculation, or raw
// HTML rendering is added to the app (scripts/guards.mjs); no_claim: print layout (checked by hand in print preview).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../worker/index";
import { buildPlan } from "../src/report/plan";

const app = createApp();
const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);

async function seedMet() {
  const id = crypto.randomUUID();
  const room = crypto.randomUUID();
  const f = (agent: string, verdict: string, body: object) =>
    q("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, 1, 2, ?3, ?4, ?5, 2, 'now')",
      crypto.randomUUID(), id, agent, verdict, JSON.stringify({ agent, verdict, statement: `${agent} statement <b>bold</b>`, items: [], rule_refs: [], evidence: [], question: null, forced_rules: [], model: "muse-spark-open", ...body }));
  await env.DB.batch([
    q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, layout_version, deliberated_layout_version, request_json, created_at) VALUES (?1, 'Site A', 'Router install', 'Juniper MX104', 1, 'same_room', 'deliberating', 2, 2, ?2, '2026-10-27T10:00:00Z')",
      id, JSON.stringify({ source: "R5 under the two devices", route: "overhead ladder", destination: "TX rack 40", translation_en: "Survey for installing one router", questions: [] })),
    q("INSERT INTO device_specs (survey_id, height_u, depth_mm, power_w, feed_type, feed_count, breaker_rating_a, confirmed) VALUES (?1, 3.5, 240, 800, 'DC', 2, 16, 1)", id),
    q("INSERT INTO rooms (id, survey_id, role, name, facts_json) VALUES (?1, ?2, 'devices_hall', 'Devices hall', ?3)", room, id,
      JSON.stringify({ size_tiles: { w: 9, d: 12 }, ladder_height_m: 2.6, spare_ac_btu: 6000, ac_count: 2 })),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, facing, props_json, source) VALUES (?1, ?2, 'rack', 'R5', 0.5, 7.8, 1, 1.7, 'east', ?3, 'engineer')",
      crypto.randomUUID(), room, JSON.stringify({ is_target: true, free_blocks: [{ from_u: 10, to_u: 30 }] })),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, facing, props_json, source) VALUES (?1, ?2, 'rack', 'R3', 0.5, 5, 1, 1.7, 'east', ?3, 'ai')",
      crypto.randomUUID(), room, JSON.stringify({ off_limits: true })),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, props_json, source) VALUES (?1, ?2, 'cable_path', 'fibre-1', 1.3, 7.8, ?3, 'lead')",
      crypto.randomUUID(), room, JSON.stringify({ cable_type: "fibre", route: "overhead", points: [[1.3, 7.8], [3.6, 7.8], [3.6, 11]], leaves_room: false })),
    q("INSERT INTO calcs (id, survey_id, run, round, rule, inputs_json, result_json, pass) VALUES ('c_len', ?1, 1, 2, 'LEN', ?2, ?3, 1)", id,
      JSON.stringify({ path: "fibre-1", cable_type: "fibre", route: "overhead" }), JSON.stringify({ length_m: 6, run_m: 3.3, drops_m: 1.2 })),
    q("INSERT INTO calcs (id, survey_id, run, round, rule, inputs_json, result_json, pass) VALUES ('c_r10', ?1, 1, 2, 'R10', '{}', ?2, 1)", id, JSON.stringify({ heat_btu: 2729.6, spare_btu: 6000 })),
    f("space", "approve", { items: [{ kind: "approved", text: "R5 U10-U30 holds the MX104" }] }),
    f("execution", "approve", { items: [{ kind: "spec", text: "Leave 2U above the router" }], rule_refs: ["R8", "R9"] }),
    f("room_manager", "object", { rule_refs: ["R1", "R2"], evidence: [{ frame_id: "f1" }] }),
    q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, fell_back, outcome, created_at) VALUES (?1, 1, 2, ?2, 'muse-wonder-1.0', 0, 'done', 'now')", id,
      JSON.stringify({ round: 2, placement: { target: "rack:R5", reason: "fits" }, propose_items: [], conflicts: [], summary: "Placed in R5.", next: "done" })),
  ]);
  return id;
}

beforeEach(async () => {
  for (const t of ["surveys", "device_specs", "rooms", "layout_items", "calcs", "findings", "lead_notes", "signoffs"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("GET /api/surveys/:id/report", () => {
  it("contains every section and field of the mirrored survey form (AC 10)", async () => {
    const id = await seedMet();
    const r = await (await app.request(`/api/surveys/${id}/report`, {}, env)).json<Record<string, any>>();
    expect(r.header).toMatchObject({ site: "Site A", project: "Router install", devices: "1 × Juniper MX104", date: "2026-10-27", day: "Tuesday", status: "deliberating" });
    expect(Object.keys(r.devices_hall)).toEqual(["floor", "floor_type", "model", "space_for_new_rack_cm", "patch_cord_m", "interconnect_m", "ladder_m", "duct_m", "notes"]);
    expect(Object.keys(r.power)).toEqual(["required_feeds", "sources", "panel", "power_cable_m", "notes"]);
    expect(r.power.required_feeds).toBe("2 × DC, 16 A breakers");
    expect(Object.keys(r.cooling)).toEqual(["heat_load_btu", "ac_units", "ac_condition", "orientation_and_place", "notes"]);
    expect(r.cooling.heat_load_btu).toBe(2729.6);
    expect(r.statements.map((s: { agent: string }) => s.agent)).toEqual(["execution", "room_manager", "space"]);
    expect(r.approved_items).toEqual(["R5 U10-U30 holds the MX104"]);
    expect(r.rules).toContainEqual({ rule: "R8", text: "Leave 2U above an installed active device" });
    expect(r.cable_lengths).toEqual([{ path: "fibre-1", cable_type: "fibre", route: "overhead", length_m: 6 }]);
    expect(r.objections).toEqual([{ agent: "room_manager", rules: ["R1", "R2"], override_reason: null }]);
    expect(r.lead).toMatchObject({ summary: "Placed in R5.", model: "muse-wonder-1.0" });
    expect(r.signoffs).toEqual([]);
    expect(r.plan.items.length).toBe(3);
  });

  it("is 404 for an unknown survey", async () => {
    expect((await app.request("/api/surveys/00000000-0000-4000-8000-000000000000/report", {}, env)).status).toBe(404);
  });
});

describe("buildPlan", () => {
  const items = [
    { id: "a", kind: "rack", label: "R5", x: 0.5, y: 7.8, w: 1, d: 1.7, facing: "east", props: { is_target: true }, source: "engineer" },
    { id: "b", kind: "rack", label: "R3", x: 0.5, y: 5, w: 1, d: 1.7, facing: "east", props: { off_limits: true }, source: "ai" },
    { id: "c", kind: "reserved", label: "NEW", x: 4, y: 4, w: 1, d: 1.7, facing: null, props: {}, source: "lead" },
    { id: "d", kind: "cable_path", label: "fibre-1", x: 1.3, y: 7.8, w: null, d: null, facing: null, props: { cable_type: "fibre", route: "overhead", points: [[1.3, 7.8], [3.6, 7.8], [3.6, 11]] }, source: "lead" },
    { id: "e", kind: "cable_path", label: "power-1", x: 1, y: 1, w: null, d: null, facing: null, props: { cable_type: "power", route: "underfloor", points: [[1, 1], [2, 1]] }, source: "lead" },
  ];
  const plan = buildPlan({ size: { w: 9, d: 12 }, items, lengths: { "fibre-1": 6, "power-1": null }, clearances: [{ to: "rack R2", m: 0.6, from: [5, 4.85], at: [6, 4.85] }] });

  it("labels cable paths with the calculated length, or says it is unknown", () => {
    expect(plan.shapes.filter((s) => s.type === "path").map((s) => s.label)).toEqual(["fibre · 6 m", "power · length unknown"]);
  });
  it("hatches the reserved area and off-limits racks, and marks the target", () => {
    const rects = plan.shapes.filter((s) => s.type === "rect");
    expect(rects.find((r) => r.label === "NEW")).toMatchObject({ hatched: "reserved" });
    expect(rects.find((r) => r.label === "R3")).toMatchObject({ hatched: "off_limits" });
    expect(rects.find((r) => r.label === "R5")).toMatchObject({ target: true });
  });
  it("draws clearance arrows with their calculated metres", () => {
    expect(plan.shapes.filter((s) => s.type === "arrow")).toEqual([{ type: "arrow", from: [5, 4.85], at: [6, 4.85], label: "0.6 m" }]);
  });
});
