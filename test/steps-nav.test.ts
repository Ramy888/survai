// protects: the top stepper lets the engineer go back to any step already reached (and forward again), and a locked
// step shows what was saved there; fails_when: a reached step is not a button, an unreached one is, or the device
// summary drops a saved value or offers an input; no_claim: keeping unsaved inputs across switches (checked in a
// browser) and the server's own state rules (covered by the route tests).
// Type-checked with the app (browser) config, not the Worker one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { describe, expect, it } from "vitest";
import { Stepper, StepNav } from "../src/components/Shell";
import { DeviceSummary } from "../src/steps/DeviceStep";
import { calcLine, decision, openQuestions, phase, Roster, roundsToShow, RoundView, verdictTrack } from "../src/steps/MeetingStep";
import { KINDS, Slot } from "../src/steps/UploadStep";
import { feedRows } from "../src/steps/feeds";
import { nextLabel, panelLine, samLine } from "../src/steps/LayoutStep";
import { ReportSheet } from "../src/report/ReportPage";

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>.*?<\/button>/g)].map((m) => m[0]);

describe("the top stepper", () => {
  it("makes every reached step a button except the one shown", () => {
    const html = renderToStaticMarkup(createElement(StepNav.Provider, { value: { reached: 4, go: () => {} } }, createElement(Stepper, { step: 2 })));
    const b = buttons(html);
    expect(b.map((x) => x.match(/Survey|Upload|Layout|Meeting|Report/)?.[0])).toEqual(["Survey", "Layout", "Meeting"]);
    expect(html).toMatch(/aria-current="step"[^>]*>(?:(?!<\/li>).)*Upload/);
    expect(b.join("")).not.toContain("Report");
  });

  it("is plain text where there is nothing to go back to (a new survey)", () => {
    const html = renderToStaticMarkup(createElement(Stepper, { step: 1 }));
    expect(buttons(html)).toEqual([]);
  });
});

describe("the locked survey step", () => {
  it("shows the saved survey and device, read-only", () => {
    const survey = {
      id: "s", site: "Demo room", project: "Core upgrade", device_model: "Juniper MX104", quantity: 1, connects_to: "same_room", status: "layout_review",
      reps: ["space", "power"], rooms: ["devices_hall"], processing_error: null,
      device: { confirmed: true, height_u: 3.5, depth_mm: 240, power_w: 800, feed_type: "DC", feed_count: 2, breaker_rating_a: 40, airflow: "side to side", weight_kg: 14.5,
        sources: [{ url: "https://example.com/mx104", title: "MX104 datasheet" }] },
    } as const;
    const html = renderToStaticMarkup(createElement(DeviceSummary, { survey: survey as never }));
    for (const v of ["Demo room", "Core upgrade", "Juniper MX104", "Space", "Power", "3.5", "800", "DC", "40", "240", "14.5", "side to side", "MX104 datasheet", "· example.com</span>"]) expect(html).toContain(v);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
  });
});

describe("the meeting's open questions", () => {
  const q = (id: string, text: string) => ({ id, text, answer_kind: "yes_no", answer: null });
  const t = {
    status: "deliberating", layout_version: 1, deliberated_layout_version: 1, run: 1, reps: ["room_manager"],
    request_questions: [q("r1", "Is the rack next to the installation rack owned by the customer?"), q("r2", "Which wall box feeds DC?")],
    rounds: [{ round: 1, calcs: [], lead: { outcome: "waiting" },
      findings: [{ id: "f", agent: "room_manager", verdict: "question", question: q("d1", "Is the rack next to the installation rack  owned by the customer ?") }] }],
  };

  it("drops the clip's question when a department already asks the same thing", () => {
    const open = openQuestions(t as never, { state: "waiting" });
    expect(open.map((o) => o.q.id)).toEqual(["d1", "r2"]);
  });

  it("keeps the clip's question hidden once a department asked it in an earlier round, even reworded", () => {
    const later = { ...t, rounds: [
      { ...t.rounds[0], findings: [{ ...t.rounds[0].findings[0], question: { ...q("d1", "Is the adjacent rack the customer's rack?"), answer: "yes" } }] },
      { round: 2, calcs: [], lead: { outcome: "waiting" }, findings: [] },
    ], request_questions: [q("r1", "Is the adjacent rack the client's rack?"), q("r2", "Which wall box feeds DC?")] };
    expect(openQuestions(later as never, { state: "waiting" }).map((o) => o.q.id)).toEqual(["r2"]);
  });

  it("drops the clip's questions once the meeting is over", () => {
    expect(openQuestions({ ...t, rounds: [] } as never, { state: "done" })).toEqual([]);
  });
});

describe("the meeting's vote strip", () => {
  it("seats every department at the table in meeting order, with its verdict and model; still-working ones as reviewing", () => {
    const f = (id: string, agent: string, verdict: string, forced: string[] = [], model: string | null = null, fell_back = false) => ({ id, agent, verdict, statement: "s", model, fell_back, forced_rules: forced, rules: [], evidence: [], question: null });
    const round = { round: 2, calcs: [], lead: null, findings: [f("a", "power", "object", ["R11"], "muse-spark-open"), f("b", "cooling", "approve", [], "muse-spark-1.3", true), f("c", "room_manager", "question")] };
    const t = { status: "deliberating", layout_version: 1, deliberated_layout_version: 1, run: 1, reps: ["space", "power", "cooling", "room_manager"], request_questions: [], rounds: [round] };
    const html = renderToStaticMarkup(createElement(Roster, { t: t as never, r: round as never, running: true }));
    const seats = [...html.matchAll(/<li class="seat[^"]*">(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    expect(seats[0]).toMatch(/^SPC Space Meta Muse Spark Open · reviewing Reviewing/);
    expect(seats[1]).toMatch(/^PWR Power Meta Muse Spark Open Forced · R11/);
    expect(seats[2]).toMatch(/^CLG Cooling Meta Muse Spark 1\.3 fell back Approve/); // the fallback is said, not hidden
    expect(seats[3]).toMatch(/^RMG Room Manager .*Question/);
    expect(seats[4]).toMatch(/^LEAD Survey Lead Meta Muse Wonder 1\.0 · planned/);
  });
});

describe("a meeting turn, read at a glance", () => {
  const f = (agent: string, verdict: string, items: object[] = []) => ({ id: agent, agent, verdict, statement: "s", model: null, forced_rules: [], rules: [], evidence: [], question: null, items });
  const lead = (target: string) => ({ summary: "s", placement: { target, reason: "r" }, conflicts: [], model: "muse-wonder-1.0", fell_back: false, outcome: "done" });
  it("puts the Lead's decision in one line: where it goes and what still stands against it", () => {
    expect(decision({ round: 3, calcs: [], lead: lead("rack:RK3"), findings: [f("power", "object"), f("room_manager", "object"), f("space", "approve")] } as never))
      .toBe("Decision: rack RK3 · 2 objections remain");
    expect(decision({ round: 1, calcs: [], lead: lead("none"), findings: [f("cooling", "question")] } as never)).toBe("No placement yet · no objections · 1 question open");
  });

  it("shows a department's measured items as chips, and leaves unmeasured ones to the report", () => {
    const round = { round: 1, calcs: [], lead: null, findings: [f("execution", "approve", [{ kind: "measurement", text: "Ladder run to the exit", quantity: 3.99, unit: "m" }, { kind: "approved", text: "Fits RK3", quantity: null }])] };
    const t = { status: "done", layout_version: 1, deliberated_layout_version: 1, run: 1, reps: ["execution"], request_questions: [], rounds: [round] };
    const html = renderToStaticMarkup(createElement(RoundView, { r: round as never, t: t as never, frameHref: () => "#", running: null }));
    expect(html).toContain("3.99 m</b> Ladder run to the exit");
    expect(html).not.toContain("Fits RK3");
  });
});

describe("which round the meeting shows", () => {
  const lead = (outcome: string) => ({ summary: "s", placement: { target: "none", reason: "" }, conflicts: [], model: "m", fell_back: false, outcome });
  const t = (rounds: object[]) => ({ status: "deliberating", layout_version: 1, deliberated_layout_version: 1, run: 1, reps: ["space"], request_questions: [], rounds });
  it("switches to the next round as soon as it starts, before any department has spoken", () => {
    const tl = t([{ round: 1, findings: [], calcs: [], lead: lead("next") }]) as never;
    const { view, tabs } = roundsToShow(tl, phase(tl), null);
    expect(view?.round).toBe(2);
    expect(view?.findings).toEqual([]);
    expect(tabs.map((r) => r.round)).toEqual([1, 2]);
    expect(roundsToShow(tl, phase(tl), 1).view?.round).toBe(1); // a round the reader picked stays picked
  });

  it("shows the last round when nothing new is running", () => {
    const tl = t([{ round: 1, findings: [], calcs: [], lead: lead("waiting") }]) as never;
    expect(roundsToShow(tl, phase(tl), null)).toMatchObject({ view: { round: 1 }, tabs: [{ round: 1 }] });
  });
});

describe("a locked upload slot", () => {
  it("says Not uploaded with a dash, and offers no Add, when nothing was uploaded", () => {
    const k = KINDS.find((x) => x.kind === "photo")!;
    const html = renderToStaticMarkup(createElement(Slot, { surveyId: "s1", role: "devices_hall", k, files: [], missing: false, progress: null, disabled: false, locked: true, onAdd: () => {}, onRemove: () => {} }));
    expect(html).toContain("Not uploaded");
    expect(html).toContain('d="M7 12h10"');
    expect(html).not.toContain("<button");
    const open = renderToStaticMarkup(createElement(Slot, { surveyId: "s1", role: "devices_hall", k, files: [], missing: false, progress: null, disabled: false, locked: false, onAdd: () => {}, onRemove: () => {} }));
    expect(open).toContain(">Add<");
  });
});

describe("the report's ending", () => {
  const base = {
    header: { site: "S", project: "P", devices: "1 × M", date: "2026-10-27", day: "Tuesday", status: "approved", problem: "x" },
    devices_hall: { floor: null, ladder_m: 3.4 }, connect_to: null, power: {}, cooling: {},
    statements: [{ agent: "power", verdict: "object", statement: "s", rule_refs: ["R11"] }, { agent: "space", verdict: "approve", statement: "s", rule_refs: [] }],
    approved_items: [{ text: "Install in R3", agent: "space" }], specs: [], rules: [], cable_lengths: [],
    objections: [{ agent: "power", rules: ["R11"], override_reason: "Pre-install work order" }],
    lead: { summary: "Another round is required.", placement: { target: "rack:r3", reason: "" }, model: "muse-wonder-1.0", fell_back: false, next: "another_round" },
    meeting: { run: 1, round: 3 }, signoffs: [], tech_specs: null, plan: { size: null, items: [], lengths: {}, clearances: [] },
  };
  const html = renderToStaticMarkup(createElement(ReportSheet, { r: base as never }));

  it("says the survey was approved over objections, and that the meeting stopped at its limit", () => {
    expect(html).toContain("approved with 1 engineer override");
    expect(html).toContain("stopped at its 3-round limit");
  });

  it("names the department beside each approved item and marks what was not recorded or signed", () => {
    expect(html).toMatch(/<span class="tag">SPC<\/span> ?Install in R3/);
    expect(html).toContain("Not captured: Floor");
    expect(html).toContain("not signed yet");
    expect(html).toContain("No cable path was drawn");
  });
});

describe("the report says what was decided, plainly", () => {
  const r = {
    header: { site: "S", project: "P", devices: "1 × Juniper MX104", date: "2026-10-27", day: "Tuesday", status: "approved", problem: "x" },
    devices_hall: { floor: null, floor_type: "Raised floor", model: "Juniper MX104", patch_cord_m: null }, connect_to: null, power: {}, cooling: {},
    statements: ["power", "room_manager", "space", "execution"].map((agent) => ({ agent, verdict: agent === "power" || agent === "room_manager" ? "object" : "approve", statement: "s", rule_refs: [] })),
    approved_items: [{ text: "Placement of 1x MX104 in R3 free block 10-30U", agent: "space" }, { text: "Install 1x Juniper MX104 in R3 (free 10U-30U)", agent: "execution" }, { text: "Two LC/LC patch cords", agent: "execution" }],
    specs: [], rules: [], cable_lengths: [],
    objections: [{ agent: "power", rules: ["R11", "R3"], override_reason: "Work order" }, { agent: "room_manager", rules: ["R6"], override_reason: "Checked on site" }],
    lead: null, meeting: { run: 1, round: 3 }, signoffs: [{ agent: "space", rep_name: "A", decision: "approve", comment: null, decided_at: "2026-10-28" }],
    tech_specs: null, plan: { size: null, items: [], lengths: {}, clearances: [] },
  };
  const html = renderToStaticMarkup(createElement(ReportSheet, { r: r as never }));
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("opens with one decision line: approved for planning, what installation waits on, sign-off count", () => {
    expect(text).toContain("Approved by the engineer for planning");
    expect(text).toMatch(/Installation waits on Power \(R11, R3\) and Room Manager \(R6\)/);
    expect(text).toContain("1 of 4 departments signed off");
    expect(html.indexOf("decision")).toBeLessThan(html.indexOf("Site Survey Report") + 2000);
  });

  it("lists only captured fields, then one Not captured line", () => {
    expect(text).toMatch(/Not captured: Floor, Patch-cord length \(m\)/);
    expect(text).not.toMatch(/Floor not recorded/);
  });

  it("merges approvals of the same device in the same rack, naming both departments", () => {
    expect(text).toMatch(/SPC EXE Placement of 1x MX104 in R3/);
    expect(text).not.toContain("Install 1x Juniper MX104 in R3");
    expect(text).toContain("Two LC/LC patch cords");
  });
});

describe("the layout step's words", () => {
  const it_ = (kind: string, label: string) => ({ kind, label, x_tiles: 0, y_tiles: 0, props: {} });
  it("names an added item like the model's draft, after the highest number", () => {
    expect(nextLabel("rack", [it_("rack", "RK1"), it_("rack", "RK4"), it_("ac", "AC1")])).toBe("RK5");
    expect(nextLabel("ladder", [it_("ladder", "LD1"), it_("ladder", "LD2")])).toBe("LD3");
    expect(nextLabel("column", [it_("rack", "RK1")])).toBe("C1");
  });

  it("says what the panel reader got, ratings included, instead of only what it missed", () => {
    const b = (panel_file: string, rating_a: number | null) => ({ panel_file, rating_a });
    expect(panelLine([b("p1", 40), b("p1", null), b("p2", 16)])).toBe("Counted 3 breakers on 2 photos and read 2 ratings. Confirm each breaker on site.");
    expect(panelLine([b("p1", null)])).toBe("Counted 1 breaker on 1 photo; no rating was readable. Confirm each breaker on site.");
    expect(panelLine([])).toBe("No breakers read from the panel photos. Add each breaker on site.");
  });

  it("counts the frames SAM found racks and tiles in, not every box", () => {
    const f = (racks: number, tiles: number) => ({ masks: { racks: Array(racks).fill({}), tiles: Array(tiles).fill({}) } });
    expect(samLine([f(3, 0), f(2, 1), f(0, 0)] as never)).toBe("Racks in 2 of 3 frames (up to 3 in one) · floor tiles in 1");
  });
});

describe("the meeting's story: what code calculated, and each agent's verdicts across rounds", () => {
  it("says in one line what a failed calculation found, from its numbers", () => {
    expect(calcLine({ id: "a", rule: "R11", pass: false, result: { needed: 2, matching: 0 } })).toBe("R11 · needs 2 free breakers, found 0");
    expect(calcLine({ id: "b", rule: "R10", pass: false, result: { heat_btu: 7200, spare_btu: 6000, over_btu: 1200 } })).toBe("R10 · adds 7200 BTU/h, 1200 over the spare A/C");
    expect(calcLine({ id: "c", rule: "R8", pass: false, result: { needed_u: 5, block: { units: 3 }, rack: "R2" } })).toBe("R8 · needs 5U free in R2, largest gap 3U");
    expect(calcLine({ id: "d", rule: "R6", pass: false, result: { blocking: ["R4", "AC1"] } })).toBe("R6 · the door swing is blocked by R4, AC1");
    expect(calcLine({ id: "e", rule: "R3", pass: false, result: { shared: [1] } })).toBe("R3 · a power cable shares a route with data");
    expect(calcLine({ id: "g", rule: "R10", pass: false, result: { heat_btu: 92124, room_m2: 13, w_per_m2: 2083.3, limit_w_per_m2: 500 } })).toBe("R10 · adds 2083.3 W per m² of floor, over the 500 W/m² design figure");
    expect(calcLine({ id: "f", rule: "R10", pass: true, result: { heat_btu: 10 } })).toBeNull(); // only failures tell the story
  });
  it("tracks one agent's verdict in each round, blank where it did not speak", () => {
    const f = (agent: string, verdict: string) => ({ id: agent + verdict, agent, verdict, statement: "", model: null, forced_rules: [], rules: [], evidence: [], question: null });
    const rounds = [{ round: 1, findings: [f("power", "object"), f("space", "approve")], calcs: [], lead: null }, { round: 2, findings: [f("power", "approve")], calcs: [], lead: null }] as never;
    expect(verdictTrack(rounds, "power", 3)).toEqual(["object", "approve", null]);
    expect(verdictTrack(rounds, "space", 3)).toEqual(["approve", null, null]);
  });
});

describe("what feeds the meeting: each value the agents start from, and where it came from", () => {
  const device = { model: "Juniper MX104", quantity: 1, height_u: 3.5, power_w: 800, feed_type: "DC", feed_count: 2, breaker_rating_a: 40, connectors: "LC duplex" };
  const base = {
    device, request: { source: "the empty space in R2", route: "up from the top onto the ladder", cables: ["fibre", "DC power"] },
    target: { label: "R2", free: [{ from_u: 10, to_u: 30 }], samFrame: 7, edited: false }, spots: 2, room: { w: 10, d: 10, edited: false },
    spareAcBtu: null, ladder: { m: 2.7, assumed: true }, breakers: { seen: 8, free: 2, rated: 0, edited: false }, observations: ["ladder left by the door"],
  };
  const row = (rows: ReturnType<typeof feedRows>, key: string) => rows.find((r) => r.key === key)!;
  it("says plainly whether there is space for the device, from SAM's estimate on the frames", () => {
    const rows = feedRows(base);
    expect(row(rows, "space")).toMatchObject({ value: "Yes: R2 has U10–U30 free (21U), the Juniper MX104 needs 5.5U with 2U clearance", source: "sam", note: "the gap below its devices, frame 7" });
    expect(row(feedRows({ ...base, target: { ...base.target, free: [] } }), "space")).toMatchObject({ value: "No free units known in R2; 2 free floor spots for a new rack", source: "missing" });
    expect(row(feedRows({ ...base, target: { ...base.target, edited: true } }), "space").source).toBe("engineer"); // the engineer changed it
  });
  it("checks cooling from the room's size on the floor tiles, unless a spare A/C figure is given", () => {
    expect(row(feedRows(base), "cooling")).toMatchObject({ value: "Room 6.0 × 6.0 m (36 m²): the device adds 22.2 W per m²", source: "sam" });
    expect(row(feedRows({ ...base, spareAcBtu: 6000 }), "cooling")).toMatchObject({ value: "Spare A/C 6000 BTU/h", source: "engineer" });
  });
  it("names the datasheet, the narration and the panel photos as sources, and an assumed ladder height as assumed", () => {
    const rows = feedRows(base);
    expect(row(rows, "device")).toMatchObject({ value: "Juniper MX104: 3.5U · 800 W · 2 × DC feeds on 40 A breakers · LC duplex fibre", source: "datasheet" });
    expect(row(rows, "where").source).toBe("narration");
    expect(row(rows, "route")).toMatchObject({ value: "up from the top onto the ladder · fibre, DC power", source: "narration" });
    expect(row(rows, "power")).toMatchObject({ value: "8 seen, 2 free; ratings hidden by the blur, confirm on site", source: "panel" });
    expect(row(rows, "ladder")).toMatchObject({ value: "2.7 m", source: "assumed" });
  });
});
