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
import { openQuestions, RoundView } from "../src/steps/MeetingStep";
import { KINDS, Slot } from "../src/steps/UploadStep";

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
    for (const v of ["Demo room", "Core upgrade", "Juniper MX104", "Space", "Power", "3.5", "800", "DC", "40", "240", "14.5", "side to side", "MX104 datasheet"]) expect(html).toContain(v);
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

  it("drops the clip's questions once the meeting is over", () => {
    expect(openQuestions({ ...t, rounds: [] } as never, { state: "done" })).toEqual([]);
  });
});

describe("the meeting's vote strip", () => {
  it("shows every department's verdict above the chat, still-working ones as pending", () => {
    const f = (id: string, agent: string, verdict: string, forced: string[] = []) => ({ id, agent, verdict, statement: "s", model: null, forced_rules: forced, rules: [], evidence: [], question: null });
    const round = { round: 2, calcs: [], lead: null, findings: [f("a", "power", "object", ["R11"]), f("b", "cooling", "approve"), f("c", "room_manager", "question")] };
    const t = { status: "deliberating", layout_version: 1, deliberated_layout_version: 1, run: 1, reps: ["space", "power", "cooling", "room_manager"], request_questions: [], rounds: [round] };
    const html = renderToStaticMarkup(createElement(RoundView, { r: round as never, t: t as never, frameHref: () => "#", running: { round: 2, leadThinking: false } }));
    const strip = html.match(/<ul class="tally"[^>]*>(.*?)<\/ul>/)?.[1] ?? "";
    expect([...strip.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()))
      .toEqual(["PWR Forced · R11", "CLG Approve", "RMG Question", "SPC Reviewing"]);
    expect(html.indexOf('class="tally"')).toBeLessThan(html.indexOf('class="chat"'));
  });
});

describe("a locked upload slot", () => {
  it("says Not uploaded with a dash, and offers no Add, when nothing was uploaded", () => {
    const k = KINDS.find((x) => x.kind === "photo")!;
    const html = renderToStaticMarkup(createElement(Slot, { role: "devices_hall", k, files: [], missing: false, progress: null, disabled: false, locked: true, onAdd: () => {}, onRemove: () => {} }));
    expect(html).toContain("Not uploaded");
    expect(html).toContain('d="M7 12h10"');
    expect(html).not.toContain("<button");
    const open = renderToStaticMarkup(createElement(Slot, { role: "devices_hall", k, files: [], missing: false, progress: null, disabled: false, locked: false, onAdd: () => {}, onRemove: () => {} }));
    expect(open).toContain(">Add<");
  });
});
