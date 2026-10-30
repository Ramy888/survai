// protects: the survey only moves along the spec's state table; fails_when: a transition is added, removed or
// retargeted; no_claim: which route fires which event (covered by the route tests).
import { describe, expect, it } from "vitest";
import { EVENTS, STATES, StateConflict, canSaveLayout, transition } from "../worker/state";

const ALLOWED: Record<string, string> = {
  "draft:device_confirmed": "uploading",
  "uploading:files_complete": "processing",
  "processing:processing_done": "layout_review",
  "processing:processing_failed": "uploading",
  "layout_review:layouts_saved": "deliberating",
  "deliberating:approved": "approved",
  "approved:reopened": "deliberating", // a department objected from its desk: the engineer reopens the meeting
};

describe("survey state machine", () => {
  for (const state of STATES) {
    for (const event of EVENTS) {
      const to = ALLOWED[`${state}:${event}`];
      it(`${state} + ${event} -> ${to ?? "409"}`, () => {
        if (to) expect(transition(state, event)).toBe(to);
        else expect(() => transition(state, event)).toThrow(StateConflict);
      });
    }
  }

  it("lets an approved survey go back to the meeting", () => {
    expect(transition("approved", "reopened" as never)).toBe("deliberating");
  });

  it("allows layout saves only while reviewing or deliberating", () => {
    expect(STATES.filter(canSaveLayout)).toEqual(["layout_review", "deliberating"]);
  });
});
