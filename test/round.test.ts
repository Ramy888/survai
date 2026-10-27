// protects: one meeting round end to end on stored data: calculations per round, assigned agents in parallel,
// findings and questions stored with the layout version, the Lead's note and proposed items, and when the meeting
// continues, waits or ends (AC 5, 6, 13); fails_when: a round runs twice, a question does not stop the meeting, more
// than 3 rounds run, the Lead's fallback is not recorded, or Lead items bump the layout version; no_claim: live model
// quality (the recorded live meeting is replayed separately).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createModels } from "../worker/clients/models";
import { runRound } from "../worker/meeting";
import type { StepRunner } from "../worker/processing";

const step: StepRunner = { do: (_n, _c, fn) => fn() };
type Script = { agents?: (agent: string, round: number, prompt: string) => object | string; lead?: (round: number) => object | "timeout" };
const prompts: { agent: string; text: string }[] = [];

function fakeFetch(s: Script) {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const text: string = body.input?.[0]?.content?.[0]?.text ?? body.messages?.[0]?.content?.[0]?.text ?? "";
    const round = Number(text.match(/round (\d+)/)?.[1] ?? 0);
    const ok = (t: string) => body.model === "meta-models/muse-spark-open-1026"
      ? new Response(JSON.stringify({ choices: [{ message: { content: t } }] }))
      : new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: t }] }] }));
    if (text.startsWith("You are the Survey Lead")) {
      prompts.push({ agent: "lead", text });
      const l = s.lead?.(round) ?? { round, placement: { target: "rack:R3", reason: "fits" }, propose_items: [], conflicts: [], summary: `lead round ${round}`, next: "done" };
      if (l === "timeout" && body.model === "muse-wonder-1.0") throw new DOMException("slow", "TimeoutError");
      return ok(JSON.stringify(l === "timeout" ? { round, placement: { target: "none", reason: "fallback" }, propose_items: [], conflicts: [], summary: "fallback lead", next: "done" } : l));
    }
    const agent = text.match(/^You are the (\w+)/)?.[1]?.toLowerCase().replace("room", "room_manager") ?? "?";
    prompts.push({ agent, text });
    const a = s.agents?.(agent, round, text) ?? { verdict: "approve", statement: `${agent.toUpperCase()}-R${round}: fine from ${agent}.` };
    return ok(typeof a === "string" ? a : JSON.stringify({ items: [], rule_refs: [], evidence: [], question: null, ...a }));
  }) as unknown as typeof fetch;
}

const started: { run: number; round: number }[] = [];
const go = (id: string, s: Script, round = 1, run = 1) =>
  runRound({ env, models: createModels({ env, fetch: fakeFetch(s), sleep: async () => {}, log: () => {} }), step, startRound: async (_e, _id, r, n) => void started.push({ run: r, round: n }) }, id, run, round);
const all = <T>(sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).all<T>().then((r) => r.results);

async function seed(facts: Record<string, unknown> = {}, rackFree = [{ from_u: 18, to_u: 24 }]) {
  const id = crypto.randomUUID();
  const room = crypto.randomUUID();
  const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
  await env.DB.batch([
    q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, layout_version, request_json, created_at) VALUES (?1, 'S', 'P', 'Juniper MX104', 1, 'same_room', 'deliberating', 3, ?2, 'now')",
      id, JSON.stringify({ source: "R3", route: "overhead ladder", destination: "TX rack 40", questions: [] })),
    ...["space", "power", "cooling", "execution", "room_manager"].map((a) => q("INSERT INTO survey_reps (survey_id, agent) VALUES (?1, ?2)", id, a)),
    q("INSERT INTO device_specs (survey_id, height_u, power_w, feed_type, feed_count, confirmed) VALUES (?1, 3.5, 800, 'DC', 2, 1)", id),
    q("INSERT INTO rooms (id, survey_id, role, name, facts_json, layout_saved) VALUES (?1, ?2, 'devices_hall', 'Devices hall', ?3, 1)", room, id, JSON.stringify({
      size_tiles: { w: 9, d: 12 }, spare_ac_btu: 4800, ladder_height_m: 2.6,
      breakers_confirmed: [{ position: 1, dc: true, rating_a: 16, free: true }, { position: 2, dc: true, rating_a: 16, free: true }],
      observations: [{ rule: "R1", text: "stepladder", frames: [1] }], ...facts,
    })),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, facing, props_json, source) VALUES (?1, ?2, 'rack', 'R3', 0.5, 5, 1, 1.7, 'east', ?3, 'engineer')",
      crypto.randomUUID(), room, JSON.stringify({ is_target: true, free_blocks: rackFree, height_u: 42, top_height_m: 2 })),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, props_json, source) VALUES (?1, ?2, 'door', 'D1', 1.5, 0, 1.5, 0.2, '{}', 'ai')", crypto.randomUUID(), room),
    ...[1, 2, 3].map((n) => q("INSERT INTO files (id, room_id, kind, r2_key, created_at) VALUES (?1, ?2, 'key_frame', 'k', ?3)", `f_${id}_${n}`, room, `2026-10-27T00:00:0${n}Z`)),
  ]);
  return { id, room };
}

beforeEach(async () => {
  prompts.length = 0;
  started.length = 0;
  for (const t of ["surveys", "survey_reps", "device_specs", "rooms", "layout_items", "files", "calcs", "findings", "questions", "lead_notes", "usage_counters"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("runRound", () => {
  it("stores calcs, one finding per assigned agent with the layout version, the Lead note, and starts the next round", async () => {
    const { id } = await seed();
    const out = await go(id, { lead: (r) => ({ round: r, placement: { target: "rack:R3", reason: "space fits" }, propose_items: [], conflicts: [], summary: "ok", next: "another_round" }) });
    expect(out).toMatchObject({ outcome: "next", round: 1 });
    const findings = await all<{ agent: string; layout_version: number; run: number }>("SELECT agent, layout_version, run FROM findings WHERE survey_id = ?1 AND round = 1 ORDER BY agent", id);
    expect(findings.map((f) => f.agent)).toEqual(["cooling", "execution", "power", "room_manager", "space"]);
    expect(findings.every((f) => f.layout_version === 3 && f.run === 1)).toBe(true);
    expect((await all<{ rule: string }>("SELECT rule FROM calcs WHERE survey_id = ?1 AND round = 1 AND run = 1", id)).map((c) => c.rule).sort()).toEqual(["R10", "R11", "R6", "R8"]);
    expect(await all("SELECT model, fell_back FROM lead_notes WHERE survey_id = ?1", id)).toEqual([{ model: "muse-wonder-1.0", fell_back: 0 }]);
    expect(started).toEqual([{ run: 1, round: 2 }]);
  });

  it("gives round 2 agents every other agent's round 1 statement (AC 5)", async () => {
    const { id } = await seed();
    await go(id, { lead: () => ({ round: 1, placement: { target: "rack:R3", reason: "x" }, propose_items: [], conflicts: [{ agents: ["power", "space"], resolution: "LEAD-CONFLICT-NOTE" }], summary: "s", next: "another_round" }) });
    prompts.length = 0;
    await go(id, {}, 2);
    const space = prompts.find((p) => p.agent === "space")!.text;
    for (const other of ["POWER-R1", "COOLING-R1", "EXECUTION-R1", "ROOM_MANAGER-R1", "LEAD-CONFLICT-NOTE"]) expect(space).toContain(other);
    expect(space).not.toContain("SPACE-R1");
  });

  it("forces Execution's objection when the target rack is too full", async () => {
    const { id } = await seed({}, [{ from_u: 18, to_u: 22 }]);
    await go(id, {});
    const f = (await all<{ verdict: string; body_json: string }>("SELECT verdict, body_json FROM findings WHERE survey_id = ?1 AND agent = 'execution'", id))[0];
    expect(f.verdict).toBe("object");
    expect(JSON.parse(f.body_json).forced_rules).toEqual(["R8"]);
  });

  it("waits for the engineer when a question is open, without starting the next round", async () => {
    const { id } = await seed({ spare_ac_btu: null });
    const out = await go(id, { lead: () => ({ round: 1, placement: { target: "none", reason: "wait" }, propose_items: [], conflicts: [], summary: "s", next: "another_round" }) });
    expect(out.outcome).toBe("waiting");
    expect(await all("SELECT q.target_fact FROM questions q JOIN findings f ON f.id = q.finding_id WHERE f.survey_id = ?1", id)).toEqual([{ target_fact: "spare_ac_btu" }]);
    expect(started).toEqual([]);
  });

  it("moves on, not waits, when the engineer answers while the Lead is still thinking", async () => {
    const { id } = await seed({ spare_ac_btu: null });
    const base = fakeFetch({ lead: () => ({ round: 1, placement: { target: "none", reason: "x" }, propose_items: [], conflicts: [], summary: "s", next: "another_round" }) });
    const answerFirst = (async (url: string, init: RequestInit) => {
      if (String(init.body).includes("You are the Survey Lead")) await env.DB.prepare("UPDATE questions SET answer = '6000' WHERE answer IS NULL").run();
      return base(url, init);
    }) as unknown as typeof fetch;
    const models = createModels({ env, fetch: answerFirst, sleep: async () => {}, log: () => {} });
    const out = await runRound({ env, models, step, startRound: async (_e, _id, r, n) => void started.push({ run: r, round: n }) }, id, 1, 1);
    expect(out.outcome).toBe("next");
    expect(started).toEqual([{ run: 1, round: 2 }]);
  });

  it("ends when the Lead says done, and after round 3 whatever the Lead says", async () => {
    const a = await seed();
    expect((await go(a.id, {})).outcome).toBe("done");
    const b = await seed();
    expect((await go(b.id, { lead: (r) => ({ round: r, placement: { target: "none", reason: "x" }, propose_items: [], conflicts: [], summary: "s", next: "another_round" }) }, 3)).outcome).toBe("done");
    expect(started).toEqual([]);
  });

  it("runs a round once, however often it is started", async () => {
    const { id } = await seed();
    const lead = () => ({ round: 1, placement: { target: "rack:R3", reason: "x" }, propose_items: [], conflicts: [], summary: "s", next: "another_round" });
    await go(id, { lead });
    const calls = prompts.length;
    await go(id, { lead });
    expect(prompts.length).toBe(calls);
    expect((await all("SELECT id FROM findings WHERE survey_id = ?1", id)).length).toBe(5);
    expect(started).toEqual([{ run: 1, round: 2 }]);
  });

  it("runs the Lead on Spark 1.3 when Muse Wonder is too slow, and records it (AC 13)", async () => {
    const { id } = await seed();
    await go(id, { lead: () => "timeout" });
    expect(await all("SELECT model, fell_back FROM lead_notes WHERE survey_id = ?1", id)).toEqual([{ model: "muse-spark-1.3", fell_back: 1 }]);
  });

  it("stores the Lead's proposed items as lead items without bumping the layout version", async () => {
    const { id, room } = await seed();
    const reserved = { kind: "reserved", x_tiles: 4, y_tiles: 4, w_tiles: 1, d_tiles: 1.7, props: {} };
    await go(id, { lead: () => ({ round: 1, placement: { target: "reserved", reason: "new rack" }, propose_items: [reserved], conflicts: [], summary: "s", next: "another_round" }) });
    await go(id, { lead: () => ({ round: 2, placement: { target: "reserved", reason: "moved" }, propose_items: [{ ...reserved, x_tiles: 5 }], conflicts: [], summary: "s", next: "done" }) }, 2);
    expect(await all("SELECT x_tiles, source FROM layout_items WHERE room_id = ?1 AND kind = 'reserved'", room)).toEqual([{ x_tiles: 5, source: "lead" }]);
    await go(id, { lead: () => ({ round: 3, placement: { target: "rack:R3", reason: "kept" }, propose_items: [], conflicts: [], summary: "s", next: "done" }) }, 3);
    expect(await all("SELECT x_tiles FROM layout_items WHERE room_id = ?1 AND kind = 'reserved'", room)).toEqual([{ x_tiles: 5 }]); // not proposed again: kept
    expect((await env.DB.prepare("SELECT layout_version FROM surveys WHERE id = ?1").bind(id).first<{ layout_version: number }>())!.layout_version).toBe(3);
    expect((await all<{ rule: string }>("SELECT rule FROM calcs WHERE survey_id = ?1 AND round = 2", id)).map((c) => c.rule)).toContain("CLR");
  });
});

describe("POST /api/surveys/:id/deliberate", () => {
  it("starts run 1 round 1 once the survey is deliberating, then run 2 after a finished run", async () => {
    const { createApp } = await import("../worker/index");
    const calls: string[] = [];
    const app = createApp({ startRound: async (_e, id, run, round) => void calls.push(`${id}:${run}:${round}`) });
    const post = (id: string) => app.request(`/api/surveys/${id}/deliberate`, { method: "POST", headers: { "X-Passcode": env.DEMO_PASSCODE, "CF-Connecting-IP": "203.0.113.40" } }, env);
    const { id } = await seed();
    expect((await post(id)).status).toBe(200);
    expect((await post(id)).status).toBe(200); // a double click lands on the same run
    expect(calls).toEqual([`${id}:1:1`, `${id}:1:1`]);
    await go(id, {});
    expect(await (await post(id)).json()).toEqual({ run: 2 });
    await env.DB.prepare("UPDATE surveys SET status = 'layout_review' WHERE id = ?1").bind(id).run();
    expect((await post(id)).status).toBe(409);
  });
});

describe("the recorded live meeting (AC 6)", async () => {
  const live = (await import("../fixtures/recorded/meeting-demo-room.json")).default;
  const { replySchema } = await import("../worker/agents/runner");
  const { leadSchema } = await import("../worker/agents/lead");
  const { parseAnswer } = await import("../worker/agents/json");
  const { OWNED_RULES } = await import("../worker/agents/config");

  it("ended within 3 rounds, and every objection cites the department's own rule and real evidence", () => {
    const rounds = new Set(live.replies.map((r) => r.round));
    expect(Math.max(...rounds)).toBeLessThanOrEqual(3);
    for (const r of live.replies.filter((x) => x.agent !== "lead")) {
      const input = { frames: Array.from({ length: live.frames }, (_, i) => ({ n: i + 1, fileId: `f${i + 1}` })), calcs: live.calcs.filter((c) => c.round === r.round) } as never;
      const f = parseAnswer(r.text, replySchema(r.agent as never, input), r.agent);
      if (f.verdict === "object") {
        expect(f.rule_refs.some((ref) => OWNED_RULES[r.agent as keyof typeof OWNED_RULES].includes(ref))).toBe(true);
        expect(f.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("has a valid Lead note for every round (the last answer when it was retried)", () => {
    for (const round of [1, 2, 3]) {
      const last = live.replies.filter((r) => r.agent === "lead" && r.round === round).at(-1)!;
      expect(parseAnswer(last.text, leadSchema(live.racks), "lead").placement.target).toBe("rack:R5");
    }
  });
});
