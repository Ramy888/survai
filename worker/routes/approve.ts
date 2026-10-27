// The engineer approves the survey: tech specs and an override reason for every latest objection, behind the gate.
import { Hono } from "hono";
import { z } from "zod";
import { approveGate } from "../approve";
import { requirePasscode } from "../passcode";
import { transition, type State } from "../state";
import type { AppEnv } from "../types";

export const approve = new Hono<AppEnv>();

const Body = z.object({
  tech_specs: z.string().trim().max(1000).default(""),
  overrides: z.record(z.string().max(64), z.string().trim().max(500)).default({}),
});

approve.post("/:id/approve", requirePasscode, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = Body.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Check the tech specs and override reasons", issues: body.error.issues }, 400);
  const s = await db.prepare("SELECT status, layout_version FROM surveys WHERE id = ?1").bind(id).first<{ status: State; layout_version: number }>();
  if (!s) return c.json({ error: "Survey not found" }, 404);

  const latest = await db.prepare(
    `SELECT r.run, r.round, (SELECT outcome FROM lead_notes l WHERE l.survey_id = ?1 AND l.run = r.run AND l.round = r.round) AS outcome,
       (SELECT MAX(layout_version) FROM findings f WHERE f.survey_id = ?1 AND f.run = r.run AND f.round = r.round) AS layout_version
     FROM (SELECT run, round FROM findings WHERE survey_id = ?1 AND round > 0 UNION SELECT run, round FROM lead_notes WHERE survey_id = ?1) r
     ORDER BY r.run DESC, r.round DESC LIMIT 1`,
  ).bind(id).first<{ run: number; round: number; outcome: "next" | "waiting" | "done" | null; layout_version: number | null }>();
  const findings = latest
    ? (await db.prepare("SELECT id, agent, verdict FROM findings WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(id, latest.run, latest.round).all<{ id: string; agent: string; verdict: string }>()).results
    : [];
  const open = latest
    ? await db.prepare("SELECT COUNT(*) AS n FROM questions q JOIN findings f ON f.id = q.finding_id WHERE f.survey_id = ?1 AND f.run = ?2 AND f.round = ?3 AND q.answer IS NULL")
      .bind(id, latest.run, latest.round).first<{ n: number }>()
    : null;
  const problems = approveGate({
    status: s.status, layout_version: s.layout_version, findings, open_questions: open?.n ?? 0, overrides: body.data.overrides,
    latest: latest && { layout_version: latest.layout_version ?? -1, outcome: latest.outcome },
  });
  if (problems.length) return c.json({ error: problems[0], problems }, 409);

  const overridden = findings.filter((f) => f.verdict === "object" || f.verdict === "unavailable");
  // The status move is conditional on the version the gate checked, so a layout saved in between (or a second
  // approve) loses: the batch is one transaction and the reasons only land when the survey is approved.
  const moved = await db.batch([
    db.prepare("UPDATE surveys SET status = ?1, tech_specs_json = ?2 WHERE id = ?3 AND status = 'deliberating' AND layout_version = ?4")
      .bind(transition(s.status, "approved"), JSON.stringify({ text: body.data.tech_specs }), id, s.layout_version),
    ...overridden.map((f) => db.prepare("UPDATE findings SET override_reason = ?1 WHERE id = ?2 AND (SELECT status FROM surveys WHERE id = ?3) = 'approved'")
      .bind(body.data.overrides[f.id].trim(), f.id, id)),
  ]);
  if (!moved[0].meta.changes) return c.json({ error: "The survey changed while approving. Reload and try again." }, 409);
  return c.json({ status: "approved" });
});
