// Create a survey (passcode) and read it back.
import { Hono } from "hono";
import { z } from "zod";
import { requirePasscode } from "../passcode";
import { buildReport } from "../report";
import type { AppEnv } from "../types";

export const AGENTS = ["space", "power", "cooling", "execution", "room_manager", "transmission"] as const;
const DEFAULT_REPS = ["space", "power", "cooling", "execution", "room_manager"] as const;

const NewSurvey = z
  .object({
    site: z.string().trim().min(1).max(80),
    project: z.string().trim().min(1).max(120),
    device_model: z.string().trim().min(1).max(80),
    quantity: z.number().int().min(1).max(20),
    connects_to: z.enum(["same_room", "other_room"]),
    reps: z.array(z.enum(AGENTS)).min(1).optional(),
  })
  .refine((s) => s.connects_to === "other_room" || !s.reps?.includes("transmission"), {
    message: "Transmission joins only when the device connects to another room",
    path: ["reps"],
  });

export const surveys = new Hono<AppEnv>();
const JUDGE_SURVEYS_PER_DAY = 5; // each survey runs paid models; the judges' link is shared outside the team

surveys.post("/", requirePasscode, async (c) => {
  const parsed = NewSurvey.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  const s = parsed.data;
  if (c.var.judge) {
    // One atomic upsert: the 6th survey of the day finds the count at the cap and gets no row back.
    const taken = await c.env.DB.prepare(
      `INSERT INTO judge_surveys (day, count) VALUES (?1, 1) ON CONFLICT (day) DO UPDATE SET count = count + 1 WHERE count < ?2 RETURNING count`,
    ).bind(new Date().toISOString().slice(0, 10), JUDGE_SURVEYS_PER_DAY).first();
    if (!taken) return c.json({ error: `The judges' link allows ${JUDGE_SURVEYS_PER_DAY} new surveys a day. Try again tomorrow, or open the sample survey.` }, 429);
  }
  const reps = new Set<string>(s.reps ?? DEFAULT_REPS);
  if (s.connects_to === "other_room") reps.add("transmission");
  const id = crypto.randomUUID();
  const rooms = s.connects_to === "other_room" ? ["devices_hall", "connect_to"] : ["devices_hall"];
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    ).bind(id, s.site, s.project, s.device_model, s.quantity, s.connects_to, new Date().toISOString()),
    ...[...reps].map((agent) => c.env.DB.prepare("INSERT INTO survey_reps (survey_id, agent) VALUES (?1, ?2)").bind(id, agent)),
    ...rooms.map((role) =>
      c.env.DB.prepare("INSERT INTO rooms (id, survey_id, role, name) VALUES (?1, ?2, ?3, ?4)")
        .bind(crypto.randomUUID(), id, role, role === "devices_hall" ? "Devices hall" : "Connect-to room"),
    ),
  ]);
  return c.json({ id }, 201);
});

surveys.get("/:id", async (c) => {
  const id = c.req.param("id");
  const survey = await c.env.DB.prepare(
    "SELECT id, site, project, device_model, quantity, connects_to, status, layout_version, processing_error, created_at FROM surveys WHERE id = ?1",
  ).bind(id).first();
  if (!survey) return c.json({ error: "Survey not found" }, 404);
  const [reps, rooms, spec] = await Promise.all([
    c.env.DB.prepare("SELECT agent FROM survey_reps WHERE survey_id = ?1 ORDER BY agent").bind(id).all<{ agent: string }>(),
    c.env.DB.prepare("SELECT role FROM rooms WHERE survey_id = ?1 ORDER BY role").bind(id).all<{ role: string }>(),
    c.env.DB.prepare("SELECT * FROM device_specs WHERE survey_id = ?1").bind(id).first<Record<string, unknown>>(),
  ]);
  const device = spec && (({ survey_id: _, sources_json, confirmed, ...rest }) =>
    ({ ...rest, sources: JSON.parse(String(sources_json ?? "[]")), confirmed: confirmed === 1 }))(spec);
  return c.json({ ...survey, reps: reps.results.map((r) => r.agent), rooms: rooms.results.map((r) => r.role), device: device ?? null });
});

surveys.get("/:id/report", async (c) => {
  const report = await buildReport(c.env.DB, c.req.param("id"));
  return report ? c.json(report) : c.json({ error: "Survey not found" }, 404);
});
