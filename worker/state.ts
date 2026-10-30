// The survey state table from the spec. Every other move is a 409.
export const STATES = ["draft", "uploading", "processing", "layout_review", "deliberating", "approved"] as const;
export const EVENTS = ["device_confirmed", "files_complete", "processing_done", "processing_failed", "layouts_saved", "approved", "reopened"] as const;
export type State = (typeof STATES)[number];
export type Event = (typeof EVENTS)[number];

const TABLE: Partial<Record<`${State}:${Event}`, State>> = {
  "draft:device_confirmed": "uploading",
  "uploading:files_complete": "processing",
  "processing:processing_done": "layout_review",
  "processing:processing_failed": "uploading",
  "layout_review:layouts_saved": "deliberating",
  "deliberating:approved": "approved",
  "approved:reopened": "deliberating", // a department objected from its desk: the engineer reopens the meeting
};

export class StateConflict extends Error {
  constructor(readonly state: State, readonly event: Event) {
    super(`cannot ${event.replace("_", " ")} while the survey is ${state.replace("_", " ")}`);
  }
}

export function transition(state: State, event: Event): State {
  const to = TABLE[`${state}:${event}`];
  if (!to) throw new StateConflict(state, event);
  return to;
}

export const canSaveLayout = (state: State) => state === "layout_review" || state === "deliberating";
