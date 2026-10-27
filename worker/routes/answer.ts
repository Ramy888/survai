// The engineer answers a meeting question. The answer is written where the next round reads it (a room fact, or a
// rack's off-limits flag for the Room Manager's R7 question); the last open answer of a waiting round starts the next.
import { Hono } from "hono";
import { z } from "zod";
import { MAX_ROUNDS } from "../meeting";
import { requirePasscode } from "../passcode";
import type { AppEnv } from "../types";
import { Facts } from "./layout";

export const answer = new Hono<AppEnv>();

const Body = z.object({ answer: z.string().trim().min(1).max(500) });
const byKind = {
  yes_no: z.enum(["yes", "no"]),
  number: z.coerce.number().finite().min(0),
  text: z.string(),
};

// The room facts the layout step also edits that hold a number; anything else is kept as the answer text only.
const NUMBER_FACTS = new Map(Object.entries(Facts.shape).filter(([, f]) => f.safeParse(1).success));

answer.post("/:id/answer", requirePasscode, async (c) => {
  const db = c.env.DB;
  const qid = c.req.param("id");
  const row = await db.prepare(
    `SELECT q.answer_kind, q.target_item_id, q.target_fact, f.survey_id, f.run, f.round, f.agent, s.status FROM questions q
     JOIN findings f ON f.id = q.finding_id JOIN surveys s ON s.id = f.survey_id WHERE q.id = ?1`,
  ).bind(qid).first<{ answer_kind: keyof typeof byKind; target_item_id: string | null; target_fact: string | null; survey_id: string; run: number; round: number; agent: string; status: string }>();
  if (!row) return c.json({ error: "Question not found" }, 404);
  if (row.status !== "deliberating") return c.json({ error: "Questions are answered during the meeting", state: row.status }, 409);

  const body = Body.safeParse(await c.req.json().catch(() => null));
  const value = body.success ? byKind[row.answer_kind].safeParse(body.data.answer.toLowerCase()) : null;
  if (!body.success || !value?.success) return c.json({ error: row.answer_kind === "yes_no" ? "Answer yes or no" : row.answer_kind === "number" ? "Answer with a number, 0 or more" : "Type an answer" }, 400);
  const schema = row.answer_kind === "number" && row.target_fact ? NUMBER_FACTS.get(row.target_fact) : undefined;
  const fact = schema ? schema.safeParse(value.data) : null;
  if (fact && !fact.success) return c.json({ error: `That value is out of range for ${row.target_fact}` }, 400);

  if (row.round > 0) {
    const latest = await db.prepare(
      `SELECT run, round FROM (SELECT run, round FROM findings WHERE survey_id = ?1 AND round > 0 UNION SELECT run, round FROM lead_notes WHERE survey_id = ?1)
       ORDER BY run DESC, round DESC LIMIT 1`,
    ).bind(row.survey_id).first<{ run: number; round: number }>();
    if (latest && (latest.run !== row.run || latest.round !== row.round)) return c.json({ error: "This question is from an earlier round" }, 409);
  }

  // The conditional write is what makes a second answer (or the same answer sent twice) a 409.
  const claimed = await db.prepare("UPDATE questions SET answer = ?1, answered_at = ?2 WHERE id = ?3 AND answer IS NULL")
    .bind(body.data.answer, new Date().toISOString(), qid).run();
  if (!claimed.meta.changes) return c.json({ error: "This question is already answered" }, 409);

  if (fact?.success) {
    await db.prepare("UPDATE rooms SET facts_json = json_set(COALESCE(facts_json, '{}'), '$.' || ?1, ?2) WHERE survey_id = ?3 AND role = 'devices_hall'")
      .bind(row.target_fact, fact.data, row.survey_id).run();
  } else if (row.answer_kind === "yes_no" && row.agent === "room_manager" && row.target_item_id) {
    await db.prepare(
      "UPDATE layout_items SET props_json = json_set(COALESCE(props_json, '{}'), '$.off_limits', json(?1)) WHERE id = ?2 AND kind = 'rack' AND room_id IN (SELECT id FROM rooms WHERE survey_id = ?3)",
    ).bind(value.data === "yes" ? "true" : "false", row.target_item_id, row.survey_id).run();
  }

  if (row.round === 0) return c.json({ answered: qid, next_round: null });
  // Only the request that flips a waiting round (its last open question just answered) moves the meeting on.
  const moved = await db.prepare(
    `UPDATE lead_notes SET outcome = CASE WHEN round >= ?4 THEN 'done' ELSE 'next' END
     WHERE survey_id = ?1 AND run = ?2 AND round = ?3 AND outcome = 'waiting' AND NOT EXISTS (
       SELECT 1 FROM questions q JOIN findings f ON f.id = q.finding_id WHERE f.survey_id = ?1 AND f.run = ?2 AND f.round = ?3 AND q.answer IS NULL)
     RETURNING outcome`,
  ).bind(row.survey_id, row.run, row.round, MAX_ROUNDS).first<{ outcome: string }>();
  const next = moved?.outcome === "next" ? row.round + 1 : null;
  if (next) await c.var.startRound(c.env, row.survey_id, row.run, next);
  return c.json({ answered: qid, next_round: next });
});
