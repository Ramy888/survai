// Optional blur for frames picked in the browser: one frame goes to SAM 3.1 to find what to blur, and the boxes come
// back. Nothing is written: the browser blurs the frame and uploads only the blurred copy as a key frame.
import { Hono } from "hono";
import { z } from "zod";
import { requirePasscode } from "../passcode";
import { bytesToDataUrl } from "../processing";
import type { AppEnv } from "../types";

// Measured on 12 frames of the sample room (docs/eval/accuracy.md): "label" finds device label plates but missed all 9
// taped sheets; "paper" found all 9 and "sticker" the cable and device tags. "text" and "logo" found nothing.
const CONCEPTS = ["label", "paper", "sticker", "person"] as const;
const MIN_CONFIDENCE = 0.4;
const MAX_BYTES = 3 * 1024 * 1024; // a 1280 px JPEG is well under this

export const redact = new Hono<AppEnv>();

redact.post("/:id/redact", requirePasscode, async (c) => {
  const id = c.req.param("id");
  const survey = await c.env.DB.prepare("SELECT status FROM surveys WHERE id = ?1").bind(id).first<{ status: string }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);
  if (survey.status !== "uploading") return c.json({ error: "Footage can only be blurred while uploading", state: survey.status }, 409);
  if (Number(c.req.header("Content-Length") ?? 0) > MAX_BYTES) return c.json({ error: "A frame must be 3 MB or smaller" }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_BYTES) return c.json({ error: "A frame must be 3 MB or smaller" }, 413);
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return c.json({ error: "A frame must be a JPEG" }, 415);
  const image = bytesToDataUrl(bytes, "image/jpeg");
  const found = await Promise.all(CONCEPTS.map((concept) => c.var.models.segment(image, concept, { survey: id }).then((r) => ({ concept, ...r }))));
  const width = found.find((f) => f.width)?.width ?? 0;
  const height = found.find((f) => f.height)?.height ?? 0;
  return c.json({
    width, height,
    boxes: found.flatMap(({ concept, boxes }) => boxes.filter((b) => (b.c ?? 1) >= MIN_CONFIDENCE).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2, concept }))),
  });
});

const Footage = z.object({ source: z.enum(["video", "prepared"]), blurred: z.boolean() });

/** How a room's key frames were made, for the replay and report to say truthfully. */
redact.post("/:id/rooms/:role/footage", requirePasscode, async (c) => {
  const parsed = Footage.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "source must be video or prepared, and blurred true or false" }, 400);
  const room = await c.env.DB.prepare("SELECT r.id, r.facts_json, s.status FROM rooms r JOIN surveys s ON s.id = r.survey_id WHERE r.survey_id = ?1 AND r.role = ?2")
    .bind(c.req.param("id"), c.req.param("role")).first<{ id: string; facts_json: string | null; status: string }>();
  if (!room) return c.json({ error: "This survey has no such room" }, 404);
  if (room.status !== "uploading") return c.json({ error: "Footage can only change while uploading", state: room.status }, 409);
  const facts = { ...JSON.parse(room.facts_json ?? "{}"), footage: parsed.data };
  await c.env.DB.prepare("UPDATE rooms SET facts_json = ?1 WHERE id = ?2").bind(JSON.stringify(facts), room.id).run();
  return c.json({ footage: parsed.data });
});
