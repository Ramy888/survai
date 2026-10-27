// One finding per agent per round: forced (calculated) results and the model's view merge with the precedence
// forced object > model object > question > approve. Rule refs and evidence are unioned; a question stays.
export type Evidence = { frame_id: string } | { calc_id: string };
export interface Question { text: string; answer_kind: "yes_no" | "number" | "text"; target_item_id: string | null; target_fact: string | null }
export interface Item { kind: "approved" | "spec" | "material" | "measurement"; text: string; quantity?: number | null; unit?: string | null }
export interface ModelFinding { verdict: "approve" | "object" | "question"; statement: string; items: Item[]; rule_refs: string[]; evidence: Evidence[]; question: Question | null }
export type Verdict = "approve" | "object" | "question" | "unavailable";

export function mergeFinding(i: { forced: { rule: string; calc_id: string }[]; forcedQuestion: Question | null; model: ModelFinding | null }) {
  const m = i.model;
  const question = i.forcedQuestion ?? m?.question ?? null; // a forced question fills a missing fact, so it wins
  const verdict: Verdict = i.forced.length || m?.verdict === "object" ? "object"
    : question || m?.verdict === "question" ? "question"
    : m ? "approve" : "unavailable";
  const evidence = [...(m?.evidence ?? [])];
  for (const f of i.forced) if (!evidence.some((e) => "calc_id" in e && e.calc_id === f.calc_id)) evidence.push({ calc_id: f.calc_id });
  return {
    verdict,
    statement: m?.statement ?? "",
    items: m?.items ?? [],
    rule_refs: [...new Set([...(m?.rule_refs ?? []), ...i.forced.map((f) => f.rule)])],
    evidence,
    question,
    forced_rules: i.forced.map((f) => f.rule),
  };
}
