// Start a fresh meeting run (up to 3 rounds) on the current layout, e.g. after the engineer edits it.
import { Hono } from "hono";
import { requirePasscode } from "../passcode";
import type { AppEnv } from "../types";

export const deliberate = new Hono<AppEnv>();

deliberate.post("/:id/deliberate", requirePasscode, async (c) => {
  const id = c.req.param("id");
  const s = await c.env.DB.prepare("SELECT status FROM surveys WHERE id = ?1").bind(id).first<{ status: string }>();
  if (!s) return c.json({ error: "Survey not found" }, 404);
  if (s.status !== "deliberating") return c.json({ error: "The meeting runs once the layout is saved", state: s.status }, 409);
  // The next run number comes from what has run so far; a double click lands on the same run, whose round-1
  // instance already exists, so it starts once.
  const last = await c.env.DB.prepare(
    "SELECT MAX(run) AS run FROM (SELECT run FROM findings WHERE survey_id = ?1 AND round > 0 UNION ALL SELECT run FROM lead_notes WHERE survey_id = ?1)",
  ).bind(id).first<{ run: number | null }>();
  const run = (last?.run ?? 0) + 1;
  await c.var.startRound(c.env, id, run, 1);
  return c.json({ run });
});
