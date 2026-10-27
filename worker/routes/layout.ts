// The engineer's layout step: read the draft, save corrections with a version check. Saving every room moves the
// survey into the meeting and starts round 1. Lead items are never touched by an engineer's save.
import { Hono } from "hono";
import { z } from "zod";
import { requirePasscode } from "../passcode";
import { type State, canSaveLayout, transition } from "../state";
import type { AppEnv } from "../types";

const Block = z.object({ from_u: z.number().int().min(1), to_u: z.number().int().min(1) }).refine((b) => b.from_u <= b.to_u, "from_u must not exceed to_u");
const Point = z.tuple([z.number(), z.number()]);
const base = {
  id: z.string().max(64).optional(),
  label: z.string().trim().max(20).nullish(),
  x_tiles: z.number().min(0).max(200),
  y_tiles: z.number().min(0).max(200),
  w_tiles: z.number().positive().max(200).nullish(),
  d_tiles: z.number().positive().max(200).nullish(),
  facing: z.enum(["north", "south", "east", "west"]).nullish(),
};
const Item = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("rack"), props: z.object({
    height_u: z.number().int().min(1).max(60).default(42), free_blocks: z.array(Block).max(20).default([]),
    is_target: z.boolean().default(false), off_limits: z.boolean().default(false), top_height_m: z.number().positive().max(4).default(2.0),
  }).passthrough() }).refine((r) => r.props.free_blocks.every((b) => b.to_u <= r.props.height_u), { message: "free U must be inside the rack's height", path: ["props", "free_blocks"] }),
  z.object({ ...base, kind: z.literal("door"), props: z.object({ swing_m: z.number().positive().max(3).default(0.9), side: z.enum(["north", "south", "east", "west"]).nullish() }).passthrough() }),
  z.object({ ...base, kind: z.literal("cable_path"), props: z.object({ cable_type: z.enum(["power", "data", "fibre"]), route: z.enum(["overhead", "underfloor"]), points: z.array(Point).min(2).max(20), leaves_room: z.boolean().default(false) }) }),
  ...(["ac", "panel", "column", "ladder", "reserved"] as const).map((k) => z.object({ ...base, kind: z.literal(k), props: z.record(z.string(), z.unknown()).default({}) })),
]);
export const Facts = z.object({
  size_tiles: z.object({ w: z.number().int().min(2).max(200), d: z.number().int().min(2).max(200) }).nullish(),
  spare_ac_btu: z.number().min(0).max(1_000_000).nullish(),
  ac_count: z.number().int().min(0).max(50).nullish(),
  ac_condition: z.string().trim().max(120).nullish(),
  ladder_height_m: z.number().positive().max(10).nullish(),
  inter_room_m: z.number().min(0).max(2000).nullish(),
  floor: z.string().trim().max(40).nullish(),
  breakers_confirmed: z.array(z.object({ position: z.number().int().nullable(), dc: z.boolean(), rating_a: z.number().positive().max(1000).nullable(), free: z.boolean() })).max(80).nullish(),
}).strict();
const Save = z.object({ layout_version: z.number().int().min(0), items: z.array(Item).max(120), facts: Facts.default({}) })
  .refine((s) => s.items.filter((i) => i.kind === "rack" && i.props.is_target).length <= 1, { message: "only one rack can be the target", path: ["items"] });

export const layout = new Hono<AppEnv>();

layout.get("/:id/rooms/:role/layout", async (c) => {
  const { id, role } = c.req.param();
  const row = await c.env.DB.prepare(
    "SELECT r.id, r.name, r.facts_json, s.layout_version, s.status, s.request_json FROM rooms r JOIN surveys s ON s.id = r.survey_id WHERE r.survey_id = ?1 AND r.role = ?2",
  ).bind(id, role).first<{ id: string; name: string; facts_json: string | null; layout_version: number; status: string; request_json: string | null }>();
  if (!row) return c.json({ error: "Room not found" }, 404);
  const items = await c.env.DB.prepare("SELECT id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, facing, props_json, source FROM layout_items WHERE room_id = ?1 ORDER BY kind, label")
    .bind(row.id).all<Record<string, unknown> & { props_json: string | null }>();
  return c.json({
    role, name: row.name, status: row.status, layout_version: row.layout_version,
    facts: row.facts_json ? JSON.parse(row.facts_json) : {},
    request: row.request_json ? JSON.parse(row.request_json) : null,
    items: items.results.map(({ props_json, ...i }) => ({ ...i, props: props_json ? JSON.parse(props_json) : {} })),
  });
});

layout.put("/:id/rooms/:role/layout", requirePasscode, async (c) => {
  const { id, role } = c.req.param();
  const parsed = Save.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  const body = parsed.data;
  const row = await c.env.DB.prepare(
    "SELECT r.id, r.facts_json, s.layout_version, s.status FROM rooms r JOIN surveys s ON s.id = r.survey_id WHERE r.survey_id = ?1 AND r.role = ?2",
  ).bind(id, role).first<{ id: string; facts_json: string | null; layout_version: number; status: State }>();
  if (!row) return c.json({ error: "Room not found" }, 404);
  if (!canSaveLayout(row.status)) return c.json({ error: "The layout can be changed only during layout review and the meeting", state: row.status }, 409);
  const leadIds = new Set((await c.env.DB.prepare("SELECT id FROM layout_items WHERE room_id = ?1 AND source = 'lead'").bind(row.id).all<{ id: string }>()).results.map((r) => r.id));
  if (body.items.some((i) => i.id && leadIds.has(i.id))) return c.json({ error: "Survey Lead items are changed by the Lead, not saved with the layout" }, 400);
  if (body.layout_version !== row.layout_version) {
    return c.json({ error: "The layout changed in another tab. Reload to see the latest version.", layout_version: row.layout_version }, 409);
  }

  const facts = { ...(row.facts_json ? JSON.parse(row.facts_json) : {}), ...body.facts };
  const next = row.layout_version + 1;
  const db = c.env.DB;
  const [bumped] = await db.batch([
    // The version guard makes a concurrent save lose cleanly; the rest of the batch then changes nothing that counts.
    db.prepare("UPDATE surveys SET layout_version = ?1 WHERE id = ?2 AND layout_version = ?3").bind(next, id, row.layout_version),
    db.prepare("DELETE FROM layout_items WHERE room_id = ?1 AND source != 'lead' AND (SELECT layout_version FROM surveys WHERE id = ?2) = ?3").bind(row.id, id, next),
    ...body.items.map((i) => db.prepare(
      `INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, facing, props_json, source)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'engineer' WHERE (SELECT layout_version FROM surveys WHERE id = ?11) = ?12`,
    ).bind(i.id && !leadIds.has(i.id) ? i.id : crypto.randomUUID(), row.id, i.kind, i.label ?? null, i.x_tiles, i.y_tiles, i.w_tiles ?? null, i.d_tiles ?? null, i.facing ?? null, JSON.stringify(i.props), id, next)),
    db.prepare("UPDATE rooms SET facts_json = ?1, layout_saved = 1 WHERE id = ?2 AND (SELECT layout_version FROM surveys WHERE id = ?3) = ?4").bind(JSON.stringify(facts), row.id, id, next),
  ]);
  if (!bumped.meta.changes) return c.json({ error: "The layout changed in another tab. Reload to see the latest version." }, 409);

  let status: State = row.status;
  let started = false;
  if (row.status === "layout_review") {
    const unsaved = await db.prepare("SELECT COUNT(*) AS n FROM rooms WHERE survey_id = ?1 AND layout_saved = 0").bind(id).first<{ n: number }>();
    if (!unsaved?.n) {
      const to = transition(row.status, "layouts_saved");
      const moved = await db.prepare("UPDATE surveys SET status = ?1 WHERE id = ?2 AND status = 'layout_review'").bind(to, id).run();
      if (moved.meta.changes) {
        await c.var.startRound(c.env, id, 1, 1);
        started = true;
      }
      status = to;
    }
  }
  return c.json({ layout_version: next, status, meeting_started: started });
});
