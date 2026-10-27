// protects: model or footage text containing markup renders as text in the report sheet and a meeting round (the
// guard in scripts/guards.mjs bans raw-HTML APIs; this proves the real components escape); fails_when: a component
// renders a statement, reason, question or name as HTML; no_claim: the browser's own handling.
// Type-checked with the app (browser) config, not the Worker one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { describe, expect, it } from "vitest";
import { ReportSheet, type Report } from "../src/report/ReportPage";
import { RoundView } from "../src/steps/MeetingStep";

describe("markup in model or footage text", () => {
  const evil = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;

  it("renders as text in the report sheet", () => {
    const r = {
      header: { site: evil, project: "P", devices: "1 × M", date: "2026-10-28", day: "Wednesday", status: "approved", problem: evil },
      devices_hall: { notes: evil }, connect_to: null, power: {}, cooling: {},
      statements: [{ agent: "power", verdict: "object", statement: evil, rule_refs: ["R3"] }],
      approved_items: [evil], specs: [{ kind: "spec", text: evil, quantity: 1, unit: "m", agent: "power" }], rules: [], cable_lengths: [],
      objections: [{ agent: "power", rules: ["R3"], override_reason: evil }], lead: { summary: evil, placement: { target: "none", reason: evil }, model: "m", fell_back: false },
      signoffs: [{ agent: "power", rep_name: evil, decision: "object", comment: evil, decided_at: "2026-10-28" }], tech_specs: { text: evil },
      plan: { size: null, items: [], lengths: {}, clearances: [] },
    } as unknown as Report;
    const html = renderToStaticMarkup(createElement(ReportSheet, { r }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders as text in a meeting round", () => {
    const finding = { id: "f", agent: "power", verdict: "object", statement: evil, model: null, forced_rules: [], rules: [{ id: "R3", text: evil }], evidence: [{ frame: 1 }], question: { id: "q", text: evil, answer_kind: "text", answer: null } };
    const round = { round: 1, findings: [finding], calcs: [], lead: { summary: evil, placement: { target: "none", reason: evil }, conflicts: [{ agents: ["power"], resolution: evil }], model: "m", fell_back: false, outcome: "done" } };
    const t = { status: "deliberating", layout_version: 1, deliberated_layout_version: 1, run: 1, reps: ["power"], request_questions: [], rounds: [round] };
    const html = renderToStaticMarkup(createElement(RoundView, { r: round as never, t: t as never, frameHref: () => "#", running: null }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
  });
});
