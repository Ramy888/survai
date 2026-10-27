// The engineer approves the survey: tech specs and an override reason for every latest objection, behind the gate.
import { Hono } from "hono";
import { z } from "zod";
import { approveGate } from "../approve";
import { requirePasscode } from "../passcode";
import { transition, type State } from "../state";
import type { AppEnv } from "../types";
import { newToken, tokenHash } from "./signoff";

export const approve = new Hono<AppEnv>();

const Body = z.object({
  tech_specs: z.string().trim().max(1000).default(""),
  overrides: z.record(z.string().max(64), z.string().trim().max(500)).default({}),
  issue_links: z.boolean().default(false),
});

/** The survey's last meeting round (with how it ended and the layout version it ran on) and its findings. */
async function latestRound(db: D1Database, id: string) {
  const latest = await db.prepare(
    `SELECT r.run, r.round, (SELECT outcome FROM lead_notes l WHERE l.survey_id = ?1 AND l.run = r.run AND l.round = r.round) AS outcome,
       (SELECT MAX(layout_version) FROM findings f WHERE f.survey_id = ?1 AND f.run = r.run AND f.round = r.round) AS layout_version
     FROM (SELECT run, round FROM findings WHERE survey_id = ?1 AND round > 0 UNION SELECT run, round FROM lead_notes WHERE survey_id = ?1) r
     ORDER BY r.run DESC, r.round DESC LIMIT 1`,
  ).bind(id).first<{ run: number; round: number; outcome: "next" | "waiting" | "done" | null; layout_version: number | null }>();
  const findings = latest
    ? (await db.prepare("SELECT id, agent, verdict FROM findings WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(id, latest.run, latest.round).all<{ id: string; agent: string; verdict: string }>()).results
    : [];
  return { latest, findings };
}

approve.post("/:id/approve", requirePasscode, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = Body.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Check the tech specs and override reasons", issues: body.error.issues }, 400);
  const s = await db.prepare("SELECT status, layout_version FROM surveys WHERE id = ?1").bind(id).first<{ status: State; layout_version: number }>();
  if (!s) return c.json({ error: "Survey not found" }, 404);

  const { latest, findings } = await latestRound(db, id);
  const open = latest
    ? await db.prepare("SELECT COUNT(*) AS n FROM questions q JOIN findings f ON f.id = q.finding_id WHERE f.survey_id = ?1 AND f.run = ?2 AND f.round = ?3 AND q.answer IS NULL")
      .bind(id, latest.run, latest.round).first<{ n: number }>()
    : null;
  const problems = approveGate({
    status: s.status, layout_version: s.layout_version, findings, open_questions: open?.n ?? 0, overrides: body.data.overrides,
    latest: latest && { layout_version: latest.layout_version ?? -1, outcome: latest.outcome },
  });
  if (problems.length) return c.json({ error: problems[0], problems }, 409);

  // One sign-off link per department of the last round; the raw tokens are returned once and never stored.
  const links = body.data.issue_links && c.env.SIGNOFF_ENABLED !== "0" ? findings.map((f) => ({ agent: f.agent, token: newToken() })) : [];
  const hashes = await Promise.all(links.map((l) => tokenHash(l.token)));
  const overridden = findings.filter((f) => f.verdict === "object" || f.verdict === "unavailable");
  // The status move is conditional on the version the gate checked, so a layout saved in between (or a second
  // approve) loses: the batch is one transaction and the reasons only land when the survey is approved.
  const moved = await db.batch([
    db.prepare("UPDATE surveys SET status = ?1, tech_specs_json = ?2 WHERE id = ?3 AND status = 'deliberating' AND layout_version = ?4")
      .bind(transition(s.status, "approved"), JSON.stringify({ text: body.data.tech_specs }), id, s.layout_version),
    ...overridden.map((f) => db.prepare("UPDATE findings SET override_reason = ?1 WHERE id = ?2 AND (SELECT status FROM surveys WHERE id = ?3) = 'approved'")
      .bind(body.data.overrides[f.id].trim(), f.id, id)),
    ...links.map((l, k) => db.prepare("INSERT INTO signoffs (survey_id, agent, token_hash) SELECT ?1, ?2, ?3 WHERE (SELECT status FROM surveys WHERE id = ?1) = 'approved'")
      .bind(id, l.agent, hashes[k])),
  ]);
  if (!moved[0].meta.changes) return c.json({ error: "The survey changed while approving. Reload and try again." }, 409);
  return c.json({ status: "approved", links });
});

// Fresh links for every department that has not decided yet; their old links stop working. Decided departments keep
// their record (and their old link still shows it). For a lost tab, a leaked link, or a survey approved without links.
approve.post("/:id/signoff-links", requirePasscode, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  if (c.env.SIGNOFF_ENABLED === "0") return c.json({ error: "Sign-off links are switched off" }, 404);
  const s = await db.prepare("SELECT status FROM surveys WHERE id = ?1").bind(id).first<{ status: string }>();
  if (!s) return c.json({ error: "Survey not found" }, 404);
  if (s.status !== "approved") return c.json({ error: "Links are issued once the survey is approved", state: s.status }, 409);
  const { findings } = await latestRound(db, id);
  const decided = new Set((await db.prepare("SELECT agent FROM signoffs WHERE survey_id = ?1 AND decision IS NOT NULL").bind(id).all<{ agent: string }>()).results.map((r) => r.agent));
  const fresh = findings.filter((f) => !decided.has(f.agent)).map((f) => ({ agent: f.agent, token: newToken() }));
  const hashes = await Promise.all(fresh.map((l) => tokenHash(l.token)));
  const res = fresh.length ? await db.batch(fresh.map((l, k) => db.prepare(
    `INSERT INTO signoffs (survey_id, agent, token_hash) VALUES (?1, ?2, ?3)
     ON CONFLICT (survey_id, agent) DO UPDATE SET token_hash = excluded.token_hash WHERE signoffs.decision IS NULL`,
  ).bind(id, l.agent, hashes[k]))) : [];
  // A department that decided in the meantime keeps its record, so its new link is not returned.
  const links = fresh.filter((_, k) => res[k].meta.changes);
  return c.json({ links, decided: findings.map((f) => f.agent).filter((a) => !links.some((l) => l.agent === a)).sort() });
});
