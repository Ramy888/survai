// Checkpoint 1 (thin path): prepared files -> processing -> the engineer's layout -> up to 3 meeting rounds ->
// report + floor plan, all on the replies recorded live on Oct 27 (no network).
// protects: the whole chain fits together on real model output; fails_when: any stage stops feeding the next
// (draft not written, rounds not chaining, report missing sections); no_claim: live model behaviour today.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import meeting from "../fixtures/recorded/meeting-demo-room.json";
import processing from "../fixtures/recorded/processing-demo-room.json";
import samRacks from "../fixtures/recorded/sam-server-rack.json";
import samTiles from "../fixtures/recorded/sam-floor-tile.json";
import { createModels } from "../worker/clients/models";
import { runRound } from "../worker/meeting";
import { runProcessing, type StepRunner } from "../worker/processing";
import { buildReport } from "../worker/report";
import { buildPlan } from "../src/report/plan";

const step: StepRunner = { do: (_n, _c, fn) => fn() };
const liveRule = new Map(meeting.calcs.map((c) => [c.id, c.rule]));

/** Replays recorded replies; calc ids from the live run are mapped to this round's ids of the same rule. */
const leadRetries: number[] = [];
function replayFetch() {
  let panel = 0;
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const prompt: string = body.input?.[0]?.content?.[0]?.text ?? body.messages?.[0]?.content?.[0]?.text ?? "";
    const out = (t: string) => new Response(JSON.stringify(body.model === "meta-models/muse-spark-open-1026"
      ? { choices: [{ message: { content: t } }] } : { output: [{ type: "message", content: [{ type: "output_text", text: t }] }] }));
    if (body.model === "sam-3.1") return new Response(JSON.stringify(prompt === "floor tile" ? samTiles.response : samRacks.response));
    if (prompt.includes("power distribution")) return out(processing.replies.panel[panel++ % 2].text);
    if (prompt.includes("narrated walk")) return out(processing.replies.reader[0].text);
    if (prompt.includes("drafting the inventory")) return out(processing.replies.inventory[0].text);
    const round = Number(prompt.match(/round (\d+)/)?.[1]);
    const agent = prompt.startsWith("You are the Survey Lead") ? "lead" : prompt.match(/^You are the (\w+)/)![1].toLowerCase().replace("room", "room_manager");
    const recorded = meeting.replies.filter((r) => r.round === round && r.agent === agent).at(-1)!;
    const data = JSON.parse(prompt.slice(prompt.indexOf("<data>\n") + 7, prompt.indexOf("\n</data>")));
    const idOf = new Map((data.calculations as { id: string; rule: string }[]).map((c) => [c.rule, c.id]));
    let text = recorded.text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => idOf.get(liveRule.get(id) ?? "") ?? id);
    // The recorded round-3 Lead still asked for "a further round"; sent back with the error, it closes the meeting instead.
    if (agent === "lead" && prompt.includes("could not be used")) { leadRetries.push(round); text = text.replace(/[^.]*\b(another|next|further|new) round\b[^.]*\./gi, " The engineer must clear it before installing."); }
    return out(text);
  }) as unknown as typeof fetch;
}

describe("thin path on recorded replies", () => {
  it("goes from prepared files to a three-round meeting and a full report", async () => {
    const models = createModels({ env, fetch: replayFetch(), sleep: async () => {}, log: () => {} });
    const id = crypto.randomUUID();
    const room = crypto.randomUUID();
    const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
    await env.DB.batch([
      q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, created_at) VALUES (?1, 'Demo room', 'Router install', 'Juniper MX104', 1, 'same_room', 'processing', '2026-10-27T12:00:00Z')", id),
      ...["space", "power", "cooling", "execution", "room_manager"].map((a) => q("INSERT INTO survey_reps (survey_id, agent) VALUES (?1, ?2)", id, a)),
      q("INSERT INTO device_specs (survey_id, height_u, depth_mm, power_w, feed_type, feed_count, breaker_rating_a, confirmed) VALUES (?1, 3.5, 240, 800, 'DC', 2, 16, 1)", id),
      q("INSERT INTO rooms (id, survey_id, role, name) VALUES (?1, ?2, 'devices_hall', 'Devices hall')", room, id),
    ]);
    const add = async (kind: string, n: number, bytes: number[], type: string) => {
      await env.MEDIA.put(`thin/${id}/${kind}${n}`, new Uint8Array(bytes), { httpMetadata: { contentType: type } });
      await q("INSERT INTO files (id, room_id, kind, r2_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", crypto.randomUUID(), room, kind, `thin/${id}/${kind}${n}`, `2026-10-27T12:00:${String(n).padStart(2, "0")}Z`).run();
    };
    for (let n = 1; n <= 30; n++) await add("key_frame", n, [0xff, 0xd8, 0xff, n], "image/jpeg");
    await add("path_clip", 40, [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], "video/mp4");
    await add("panel_photo", 41, [0xff, 0xd8, 0xff, 1], "image/jpeg");
    await add("panel_photo", 42, [0xff, 0xd8, 0xff, 2], "image/jpeg");

    // 1. Processing writes the draft.
    await runProcessing({ env, models, step }, id);
    expect((await q("SELECT status FROM surveys WHERE id = ?1", id).first<{ status: string }>())!.status).toBe("layout_review");

    // 2. The engineer's layout step: target rack, free U, room facts; the layout is saved.
    await env.DB.batch([
      q("UPDATE layout_items SET source = 'engineer', props_json = json_set(props_json, '$.is_target', json('true'), '$.free_blocks', json('[{\"from_u\":10,\"to_u\":30}]')) WHERE room_id = ?1 AND kind = 'rack' AND label = 'R5'", room),
      q("UPDATE layout_items SET props_json = json_set(props_json, '$.off_limits', json('true')) WHERE room_id = ?1 AND kind = 'rack' AND label = 'R3'", room),
      q("UPDATE rooms SET layout_saved = 1, facts_json = json_set(facts_json, '$.ladder_height_m', 2.6, '$.spare_ac_btu', 6000, '$.breakers_confirmed', json('[{\"position\":3,\"dc\":true,\"rating_a\":16,\"free\":true},{\"position\":4,\"dc\":true,\"rating_a\":16,\"free\":true}]')) WHERE id = ?1", room),
      q("UPDATE surveys SET status = 'deliberating', layout_version = 1 WHERE id = ?1", id),
    ]);

    // 3. The meeting: rounds chain until the Lead says done or round 3.
    let round = 1;
    for (;;) {
      const r = await runRound({ env, models, step, startRound: async () => {} }, id, 1, round);
      if (r.outcome !== "next") { expect(r.outcome).toBe("done"); break; }
      round++;
    }
    expect(round).toBeLessThanOrEqual(3);
    const verdicts = await env.DB.prepare("SELECT agent, verdict FROM findings WHERE survey_id = ?1 AND round = ?2 ORDER BY agent").bind(id, round).all();
    expect(verdicts.results).toEqual([
      { agent: "cooling", verdict: "approve" }, { agent: "execution", verdict: "approve" }, { agent: "power", verdict: "approve" },
      { agent: "room_manager", verdict: "object" }, { agent: "space", verdict: "approve" },
    ]);

    // 4. The report and floor plan.
    const report = (await buildReport(env.DB, id))!;
    expect(report.header.devices).toBe("1 × Juniper MX104");
    expect(report.lead?.placement.target).toBe("rack:R5");
    expect(leadRetries).toEqual([3]); // only the last round's "another round" was sent back
    expect(report.statements).toHaveLength(5);
    expect(report.objections).toEqual([{ agent: "room_manager", rules: expect.arrayContaining(["R1", "R2"]), override_reason: null }]);
    const plan = buildPlan(report.plan as never);
    expect(plan.shapes.filter((s) => s.type === "rect" && s.kind === "rack")).toHaveLength(6);
    expect(plan.shapes.find((s) => s.type === "rect" && s.label === "R5")).toMatchObject({ target: true });
    expect(plan.shapes.find((s) => s.type === "rect" && s.label === "R3")).toMatchObject({ hatched: "off_limits" });
    const paths = plan.shapes.filter((s) => s.type === "path");
    expect(paths.length).toBeGreaterThan(0); // the Lead's cable paths survive to the report
    for (const p of paths) {
      const len = report.cable_lengths.find((c) => p.label.startsWith(c.cable_type))?.length_m;
      expect(p.label).toBe(`${p.cable_type} · ${len == null ? "length unknown" : `${len} m`}`); // labels equal the calculations
    }
  });
});
