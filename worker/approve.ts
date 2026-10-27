// The approve gate (spec step 7): the meeting is over, every latest objection or unavailable department has the
// engineer's override reason, no meeting question is open, and the last round ran on the current layout.
export interface GateInput {
  status: string;
  layout_version: number;
  /** The latest round: the layout version its findings were made on and how it ended (null while it runs). */
  latest: { layout_version: number; outcome: "next" | "waiting" | "done" | null } | null;
  findings: { id: string; agent: string; verdict: string }[];
  open_questions: number;
  overrides: Record<string, string>;
}

/** Returns what still blocks approval; empty means the survey can be approved. */
export function approveGate(i: GateInput): string[] {
  if (i.status === "approved") return ["The survey is already approved."];
  if (i.status !== "deliberating") return ["The survey is approved after the meeting."];
  if (!i.latest) return ["The meeting has not run yet."];
  const problems: string[] = [];
  if (i.open_questions > 0) problems.push(`Answer the ${i.open_questions === 1 ? "open question" : `${i.open_questions} open questions`} first.`);
  else if (i.latest.outcome !== "done") problems.push("The meeting is still running.");
  if (i.latest.layout_version !== i.layout_version) problems.push("The layout changed after the last round. Run the meeting again.");
  for (const f of i.findings) {
    if ((f.verdict === "object" || f.verdict === "unavailable") && !i.overrides[f.id]?.trim()) {
      problems.push(`Give a reason to override ${f.agent.replace("_", " ")} (${f.verdict === "object" ? "objects" : "unavailable"}).`);
    }
  }
  return problems;
}
