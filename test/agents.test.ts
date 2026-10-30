// protects: how a department agent meets (AC 5: round n sees every other agent's round n-1 statement and the Lead's
// conflicts), forced objections and questions from the calculations, owner-only objections with evidence, the merge
// precedence, and the unavailable path; fails_when: an agent can downgrade a forced result, object with another
// department's rule or without evidence, or loses a question in the merge; no_claim: the quality of model statements.
import { describe, expect, it } from "vitest";
import type { Calc } from "../worker/calc";
import { OWNED_RULES } from "../worker/agents/config";
import { mergeFinding } from "../worker/agents/merge";
import { leadPrompt, leadSchema } from "../worker/agents/lead";
import { buildAgentPrompt, runAgent, type MeetingInput } from "../worker/agents/runner";

const calc = (id: string, rule: string, pass: boolean | null, result: Record<string, unknown> = {}): Calc & { id: string } => ({ id, rule, inputs: {}, result, pass });

function input(over: Partial<MeetingInput> = {}): MeetingInput {
  return {
    round: 2,
    quantity: 1,
    device: { model: "Juniper MX104", height_u: 3.5, power_w: 800, feed_type: "DC", feed_count: 2, breaker_rating_a: null },
    request: { source: "rack R3 under the two devices", route: "overhead ladder", destination: "transmission room rack 40", questions: [] },
    rooms: [{
      role: "devices_hall", size_tiles: { w: 9, d: 12 },
      facts: { spare_ac_btu: 4800, ladder_height_m: 2.6, ac_count: 2, inter_room_m: null, breakers_confirmed: 4 },
      items: [{ id: "i_r3", kind: "rack", label: "R3", x: 0.5, y: 5, w: 1, d: 1.7, facing: "east", props: { is_target: true, free_blocks: [{ from_u: 18, to_u: 24 }] } }],
      observations: [{ rule: "R1", text: "Wooden stepladder left by the left rack", frames: [1] }],
    }],
    frames: [{ n: 1, fileId: "f_1" }, { n: 9, fileId: "f_9" }],
    calcs: [calc("c_r8", "R8", true, { needed_u: 6 }), calc("c_r10", "R10", true, { heat_btu: 2729.6 })],
    previous: [
      { agent: "space", verdict: "approve", statement: "SPACE-SAYS: R3 has room at U18-24." },
      { agent: "power", verdict: "object", statement: "POWER-SAYS: no free 16 A DC breaker confirmed." },
      { agent: "cooling", verdict: "approve", statement: "COOLING-SAYS: 2,730 BTU/h fits." },
      { agent: "execution", verdict: "approve", statement: "EXECUTION-SAYS: cables up to the ladder." },
      { agent: "room_manager", verdict: "question", statement: "ROOM-MANAGER-SAYS: is R4 a customer rack?" },
    ],
    lead: { conflicts: [{ agents: ["power", "space"], resolution: "LEAD-SAYS: power must confirm breakers first" }], summary: "round 1" },
    answers: [{ question: "Does R4 hold access devices?", answer: "yes" }],
    ...over,
  };
}

const reply = (o: Record<string, unknown>) => JSON.stringify({ items: [], rule_refs: [], evidence: [], question: null, ...o });
function fakeModels(texts: string[]) {
  const prompts: string[] = [];
  return {
    prompts,
    models: {
      run: async (_route: string, p: { text: string }) => {
        prompts.push(p.text);
        const t = texts.shift();
        if (t === undefined) throw Object.assign(new (await import("../worker/clients/models")).ModelRateLimited("busy", "muse-spark-1.3"));
        return { text: t, model: "muse-spark-open", fellBack: false, raw: null };
      },
    } as never,
  };
}

describe("the meeting input (AC 5)", () => {
  it("gives round n every other agent's round n-1 statement, the Lead's conflicts and the answers", () => {
    const prompt = buildAgentPrompt("cooling", input());
    for (const s of ["SPACE-SAYS", "POWER-SAYS", "EXECUTION-SAYS", "ROOM-MANAGER-SAYS", "LEAD-SAYS", "Does R4 hold access devices?"]) expect(prompt).toContain(s);
    expect(prompt).toContain("R10"); // its own rule, with text
    expect(prompt).toContain("c_r8"); // the calculations, as facts with ids
    expect(prompt).not.toContain("COOLING-SAYS: 2,730"); // the spec sends every OTHER agent's statement
  });
});

describe("runAgent", () => {
  it("turns a model approve into a forced objection when its own calculation fails", async () => {
    const { models } = fakeModels([reply({ verdict: "approve", statement: "The block at U18-22 looks fine." })]);
    const f = await runAgent(models, "execution", input({ calcs: [calc("c_r8", "R8", false, { needed_u: 6, block: { units: 5 } })] }));
    expect(f).toMatchObject({ verdict: "object", forced_rules: ["R8"], statement: "The block at U18-22 looks fine." });
    expect(f.rule_refs).toContain("R8");
    expect(f.evidence).toContainEqual({ calc_id: "c_r8" });
  });

  it("forces a question when its calculation is missing an input", async () => {
    const { models } = fakeModels([reply({ verdict: "approve", statement: "Heat load is modest." })]);
    const f = await runAgent(models, "cooling", input({ calcs: [calc("c_r10", "R10", null, { missing: ["spare_ac_btu"] })] }));
    expect(f.verdict).toBe("question");
    expect(f.question).toMatchObject({ answer_kind: "number", target_fact: "spare_ac_btu" });
  });

  it("does not ask a missing-input question again once the engineer has answered it", async () => {
    const { models } = fakeModels([reply({ verdict: "approve", statement: "Breakers noted from the answer." })]);
    const answers = [{ question: "Which breakers on the panel are free, and what are their type and rating?", answer: "3 and 4, 16 A DC" }];
    const f = await runAgent(models, "power", input({ answers, calcs: [calc("c_r11", "R11", null, { missing: ["breakers_confirmed"] })] }));
    expect(f.verdict).toBe("approve");
    expect(f.question).toBeNull();
  });

  it("retries an objection with another department's rule, then accepts a valid one", async () => {
    const bad = reply({ verdict: "object", statement: "No space.", rule_refs: ["R8"], evidence: [{ frame: 9 }] });
    const good = reply({ verdict: "object", statement: "Power runs beside the fibre.", rule_refs: ["R3"], evidence: [{ frame: 9 }] });
    const { models, prompts } = fakeModels([bad, good]);
    const f = await runAgent(models, "power", input());
    expect(prompts[1]).toMatch(/R8 belongs to another department/);
    expect(f).toMatchObject({ verdict: "object", rule_refs: ["R3"], evidence: [{ frame_id: "f_9" }] });
  });

  it("gives an agent a second retry with the exact error before giving up, so one slip does not silence a department", async () => {
    const foreign = reply({ verdict: "object", statement: "No space.", rule_refs: ["R8"], evidence: [{ frame: 9 }] });
    const badCalc = reply({ verdict: "object", statement: "No space.", rule_refs: ["R4"], evidence: [{ calc: "nope" }] });
    const good = reply({ verdict: "approve", statement: "Fits.", rule_refs: [], evidence: [] });
    const { models, prompts } = fakeModels([foreign, badCalc, good]);
    expect(await runAgent(models, "space", input())).toMatchObject({ verdict: "approve", statement: "Fits." });
    expect(prompts[2]).toMatch(/nope is not a calculation/);
  });

  it("rejects an objection without evidence or with an unknown frame", async () => {
    const noEvidence = reply({ verdict: "object", statement: "Messy.", rule_refs: ["R2"], evidence: [] });
    const unknownFrame = reply({ verdict: "object", statement: "Messy.", rule_refs: ["R2"], evidence: [{ frame: 77 }] });
    const { models } = fakeModels([noEvidence, unknownFrame, unknownFrame]);
    expect(await runAgent(models, "room_manager", input())).toMatchObject({ verdict: "unavailable" });
  });

  it("keeps a forced objection, with a written statement, when the model is unavailable", async () => {
    const { models } = fakeModels([]);
    const f = await runAgent(models, "execution", input({ calcs: [calc("c_r8", "R8", false, { needed_u: 6, block: { units: 5 } })] }));
    expect(f).toMatchObject({ verdict: "object", forced_rules: ["R8"], model: "unavailable" });
    expect(f.statement).toMatch(/R8/);
  });

  it("is unavailable when the model fails and nothing is forced", async () => {
    const { models } = fakeModels([]);
    expect(await runAgent(models, "space", input())).toMatchObject({ verdict: "unavailable", rule_refs: [], forced_rules: [] });
  });
});

describe("mergeFinding", () => {
  it("orders forced object > model object > question > approve and keeps the question", () => {
    const merged = mergeFinding({
      forced: [{ rule: "R11", calc_id: "c_r11" }],
      forcedQuestion: null,
      model: { verdict: "question", statement: "Which breaker?", items: [], rule_refs: [], evidence: [{ frame_id: "f_1" }],
        question: { text: "Which breaker feeds R3?", answer_kind: "text", target_item_id: null, target_fact: null } },
    });
    expect(merged.verdict).toBe("object");
    expect(merged.question?.text).toBe("Which breaker feeds R3?");
    expect(merged.rule_refs).toEqual(["R11"]);
    expect(merged.evidence).toEqual([{ frame_id: "f_1" }, { calc_id: "c_r11" }]);
  });
});

describe("rule ownership", () => {
  it("matches the spec's rulebook", () => {
    expect(OWNED_RULES).toEqual({
      space: ["R4", "R5"], power: ["R3", "R11"], cooling: ["R10"], execution: ["R8", "R9"], transmission: ["R12"], room_manager: ["R1", "R2", "R6", "R7"],
    });
  });
});

describe("the Survey Lead's prompt", () => {
  const base = { device: {}, quantity: 1, items: [], calcs: [], findings: [] };
  it("tells the Lead the last round is the last, so it closes the meeting instead of asking for another", () => {
    expect(leadPrompt({ ...base, round: 3, final: true })).toMatch(/last round.*"done"/s);
    expect(leadPrompt({ ...base, round: 1, final: false })).not.toMatch(/last round/);
  });
  it("weighs two placements in the open: rules, then Cooling's preference, then cost; Cooling compares them", () => {
    expect(leadPrompt({ ...base, round: 1, final: false })).toMatch(/\(1\) passes the calculated rules; \(2\) better for cooling.*\(3\) cheaper/s);
    expect(leadPrompt({ ...base, round: 1, final: false })).toMatch(/Cooling has not compared[\s\S]*another_round/);
    expect(buildAgentPrompt("cooling", input())).toMatch(/compare the target rack and the best free spot for cooling/);
    expect(buildAgentPrompt("space", input())).toMatch(/name both placements/);
    expect(buildAgentPrompt("power", input())).not.toMatch(/both placements|best free spot/); // only the departments who weigh placement
  });

  it("closes the meeting in the last round even when the Lead asks for another", () => {
    const note = { round: 3, placement: { target: "none", reason: "r" }, summary: "s", next: "another_round" };
    expect(leadSchema([], true).parse(note).next).toBe("done");
    expect(leadSchema([], false).parse(note).next).toBe("another_round");
  });

  it("sends back a closing verdict that still asks for another round, so the report never contradicts itself", () => {
    const note = (summary: string) => ({ round: 3, placement: { target: "none", reason: "r" }, summary, next: "done" });
    const asks = leadSchema([], true).safeParse(note("Power still objects. Another round is required."));
    expect(asks.success).toBe(false);
    expect(asks.error?.issues[0].message).toMatch(/last round/);
    expect(leadSchema([], true).safeParse(note("Closing verdict: R4 is agreed; the engineer must provide two DC feeds before installing.")).success).toBe(true);
    expect(leadSchema([], false).safeParse(note("Another round is required.")).success).toBe(true); // earlier rounds may ask
  });
});

describe("the Survey Lead's cable paths", () => {
  const note = (points: [number, number][]) => ({ round: 1, placement: { target: "none", reason: "r" }, summary: "s", next: "done",
    propose_items: [{ kind: "cable_path", x_tiles: points[0][0], y_tiles: points[0][1], props: { cable_type: "fibre", route: "overhead", points } }] });
  const door = { label: "D1", x0: 2, x1: 4.5, y0: 0, y1: 1.7 }; // the door and its swing
  it("may run over racks but never through a door or its swing, so the Lead is asked again", () => {
    const through = leadSchema([], false, [door]).safeParse(note([[3, 5], [3, 0]]));
    expect(through.success).toBe(false);
    expect(JSON.stringify(through.error?.issues)).toMatch(/fibre path crosses door D1/);
    expect(leadSchema([], false, [door]).safeParse(note([[6, 5], [6, 0]])).success).toBe(true);
  });
});
