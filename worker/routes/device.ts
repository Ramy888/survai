// Datasheet lookup (cached per model) and device confirmation, which moves a draft survey to uploading.
import { Hono } from "hono";
import { z } from "zod";
import { LookupFailed, lookupDatasheet, modelKey } from "../agents/datasheet";
import { ModelError } from "../clients/models";
import { requirePasscode } from "../passcode";
import { type State, transition } from "../state";
import type { AppEnv } from "../types";

const Confirm = z.object({
  height_u: z.number().positive().max(48),
  depth_mm: z.number().int().positive().max(2000).nullish(),
  power_w: z.number().int().positive().max(20_000),
  feed_type: z.enum(["AC", "DC"]),
  feed_count: z.number().int().min(1).max(8),
  breaker_rating_a: z.number().positive().max(400).nullish(),
  airflow: z.string().trim().max(60).nullish(),
  weight_kg: z.number().positive().max(500).nullish(),
  sources: z.array(z.object({ url: z.string().url(), title: z.string().nullish() })).max(10).optional(),
});

export const device = new Hono<AppEnv>();

device.post("/:id/device/lookup", requirePasscode, async (c) => {
  const id = c.req.param("id");
  const survey = await c.env.DB.prepare("SELECT device_model FROM surveys WHERE id = ?1").bind(id).first<{ device_model: string }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);
  const key = modelKey(survey.device_model);
  const hit = await c.env.DB.prepare("SELECT spec_json FROM device_cache WHERE model_key = ?1").bind(key).first<{ spec_json: string }>();
  if (hit) return c.json({ cached: true, spec: JSON.parse(hit.spec_json) });
  try {
    const spec = await lookupDatasheet(c.var.models, survey.device_model, id);
    await c.env.DB.prepare("INSERT OR REPLACE INTO device_cache (model_key, spec_json, created_at) VALUES (?1, ?2, ?3)")
      .bind(key, JSON.stringify(spec), new Date().toISOString()).run();
    return c.json({ cached: false, spec });
  } catch (err) {
    if (!(err instanceof LookupFailed || err instanceof ModelError)) throw err;
    console.log(JSON.stringify({ evt: "datasheet_failed", survey: id, reason: err.message }));
    return c.json({ error: "The datasheet lookup did not find cited values. Enter them from the datasheet.", manual: true }, 502);
  }
});

device.put("/:id/device", requirePasscode, async (c) => {
  const id = c.req.param("id");
  const parsed = Confirm.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  const row = await c.env.DB.prepare("SELECT status FROM surveys WHERE id = ?1").bind(id).first<{ status: State }>();
  if (!row) return c.json({ error: "Survey not found" }, 404);
  const next = transition(row.status, "device_confirmed");
  const d = parsed.data;
  const [moved] = await c.env.DB.batch([
    // The status guard makes a double submit lose cleanly instead of writing twice.
    c.env.DB.prepare("UPDATE surveys SET status = ?1 WHERE id = ?2 AND status = ?3").bind(next, id, row.status),
    c.env.DB.prepare(
      `INSERT OR REPLACE INTO device_specs (survey_id, height_u, depth_mm, power_w, feed_type, feed_count,
         breaker_rating_a, airflow, weight_kg, sources_json, confirmed) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1)`,
    ).bind(id, d.height_u, d.depth_mm ?? null, d.power_w, d.feed_type, d.feed_count, d.breaker_rating_a ?? null,
      d.airflow ?? null, d.weight_kg ?? null, JSON.stringify(d.sources ?? [])),
  ]);
  if (!moved.meta.changes) return c.json({ error: "The device was already confirmed", state: row.status }, 409);
  return c.json({ status: next });
});
