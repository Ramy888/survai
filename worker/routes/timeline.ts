// What the meeting screen polls: the latest run's rounds with each department's finding (rule text, evidence frame
// numbers, its question), the Survey Lead's note and the calculations, plus the request reader's round-0 questions.
import { Hono } from "hono";
import { RULES } from "../agents/config";
import { numberFrames } from "../meeting";
import type { AppEnv } from "../types";

export const timeline = new Hono<AppEnv>();

type Evidence = { frame_id?: string; calc_id?: string };
type Body = { statement: string; rule_refs?: string[]; forced_rules?: string[]; evidence?: Evidence[]; model?: string; fell_back?: boolean; items?: object[] };

timeline.get("/:id/timeline", async (c) => {
  const t = await buildTimeline(c.env.DB, c.req.param("id"));
  return t ? c.json(t) : c.json({ error: "Survey not found" }, 404);
});

export async function buildTimeline(db: D1Database, id: string) {
  const s = await db.prepare("SELECT status, layout_version, deliberated_layout_version FROM surveys WHERE id = ?1").bind(id)
    .first<{ status: string; layout_version: number; deliberated_layout_version: number | null }>();
  if (!s) return null;
  const last = await db.prepare("SELECT MAX(run) AS run FROM (SELECT run FROM findings WHERE survey_id = ?1 AND round > 0 UNION ALL SELECT run FROM lead_notes WHERE survey_id = ?1)")
    .bind(id).first<{ run: number | null }>();
  const run = last?.run ?? null;

  const [reps, frames, findings, questions, leads, calcs] = await Promise.all([
    db.prepare("SELECT agent FROM survey_reps WHERE survey_id = ?1 ORDER BY agent").bind(id).all<{ agent: string }>(),
    db.prepare("SELECT f.id, r.role FROM files f JOIN rooms r ON r.id = f.room_id WHERE r.survey_id = ?1 AND f.kind = 'key_frame' ORDER BY f.created_at").bind(id).all<{ id: string; role: string }>(),
    db.prepare("SELECT id, round, agent, verdict, body_json FROM findings WHERE survey_id = ?1 AND run = ?2 AND round > 0 ORDER BY round, agent").bind(id, run)
      .all<{ id: string; round: number; agent: string; verdict: string; body_json: string }>(),
    db.prepare("SELECT q.id, q.finding_id, q.text, q.answer_kind, q.answer, f.round FROM questions q JOIN findings f ON f.id = q.finding_id WHERE f.survey_id = ?1 AND (f.run = ?2 OR f.round = 0)")
      .bind(id, run).all<{ id: string; finding_id: string; text: string; answer_kind: string; answer: string | null; round: number }>(),
    db.prepare("SELECT round, body_json, model, fell_back, outcome FROM lead_notes WHERE survey_id = ?1 AND run = ?2").bind(id, run)
      .all<{ round: number; body_json: string; model: string; fell_back: number; outcome: string }>(),
    db.prepare("SELECT id, round, rule, result_json, pass FROM calcs WHERE survey_id = ?1 AND run = ?2").bind(id, run)
      .all<{ id: string; round: number; rule: string; result_json: string; pass: number }>(),
  ]);

  const frameNo = new Map(numberFrames(frames.results).map((f) => [f.fileId, f.n]));
  const question = (findingId: string) => {
    const q = questions.results.find((x) => x.finding_id === findingId);
    return q ? { id: q.id, text: q.text, answer_kind: q.answer_kind, answer: q.answer } : null;
  };
  const roundNos = [...new Set([...findings.results.map((f) => f.round), ...leads.results.map((l) => l.round)])].sort((a, b) => a - b);
  const rounds = roundNos.map((round) => {
    const lead = leads.results.find((l) => l.round === round);
    const note = lead && JSON.parse(lead.body_json);
    return {
      round,
      findings: findings.results.filter((f) => f.round === round).map((f) => {
        const b = JSON.parse(f.body_json) as Body;
        return {
          id: f.id, agent: f.agent, verdict: f.verdict, statement: b.statement, model: b.model ?? null, fell_back: b.fell_back === true, forced_rules: b.forced_rules ?? [],
          rules: (b.rule_refs ?? []).map((r) => ({ id: r, text: RULES[r]?.text ?? null })),
          evidence: (b.evidence ?? []).map((e) => (e.frame_id ? { frame: frameNo.get(e.frame_id) ?? null, file_id: e.frame_id } : { calc_id: e.calc_id })),
          question: question(f.id), items: b.items ?? [],
        };
      }),
      lead: lead ? { summary: note.summary, placement: note.placement, conflicts: note.conflicts ?? [], model: lead.model, fell_back: lead.fell_back === 1, outcome: lead.outcome } : null,
      calcs: calcs.results.filter((k) => k.round === round).map((k) => ({ id: k.id, rule: k.rule, pass: k.pass === -1 ? null : k.pass === 1, result: JSON.parse(k.result_json) })),
    };
  });
  return {
    status: s.status, layout_version: s.layout_version, deliberated_layout_version: s.deliberated_layout_version, run,
    reps: reps.results.map((r) => r.agent),
    request_questions: questions.results.filter((q) => q.round === 0).map((q) => ({ id: q.id, text: q.text, answer_kind: q.answer_kind, answer: q.answer })),
    rounds,
  };
}
