// Upload prepared (anonymised) files per room, list and delete them, and start processing once every required
// file is in. Types are checked from the bytes, never from the name or header.
import { Hono } from "hono";
import { requirePasscode } from "../passcode";
import { transition } from "../state";
import type { AppEnv } from "../types";

const MAX_BYTES = 20 * 1024 * 1024;
type Kind = "key_frame" | "path_clip" | "panel_photo" | "photo";
type Role = "devices_hall" | "connect_to";
const LIMIT: Record<Kind, number> = { key_frame: 30, path_clip: 1, panel_photo: 3, photo: 5 };
const ALLOWED: Record<Role, Kind[]> = { devices_hall: ["key_frame", "path_clip", "panel_photo", "photo"], connect_to: ["key_frame", "photo"] };
const REQUIRED: Record<Role, Kind[]> = { devices_hall: ["key_frame", "path_clip", "panel_photo"], connect_to: ["key_frame"] };
const TYPES: Record<Kind, string[]> = { key_frame: ["image/jpeg", "image/png"], panel_photo: ["image/jpeg", "image/png"], photo: ["image/jpeg", "image/png"], path_clip: ["video/mp4"] };
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "video/mp4": "mp4" };

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video/mp4"; // "ftyp" box
  return null;
}

/** Required kinds still missing, per room of the survey. */
async function missingFiles(db: D1Database, surveyId: string) {
  const rows = await db.prepare(
    `SELECT r.role, f.kind FROM rooms r LEFT JOIN files f ON f.room_id = r.id WHERE r.survey_id = ?1`,
  ).bind(surveyId).all<{ role: Role; kind: Kind | null }>();
  const have = new Map<Role, Set<Kind | null>>();
  for (const r of rows.results) have.set(r.role, (have.get(r.role) ?? new Set()).add(r.kind));
  return Object.fromEntries([...have].map(([role, kinds]) => [role, REQUIRED[role].filter((k) => !kinds.has(k))])) as Record<Role, Kind[]>;
}

const uploadsClosed = { error: "Files can be changed only during the upload step" };

export const files = new Hono<AppEnv>();

files.post("/:id/rooms/:role/files", requirePasscode, async (c) => {
  const { id, role } = c.req.param();
  const kind = c.req.query("kind") as Kind;
  const survey = await c.env.DB.prepare("SELECT status FROM surveys WHERE id = ?1").bind(id).first<{ status: string }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);
  if (survey.status !== "uploading") return c.json({ ...uploadsClosed, state: survey.status }, 409);
  const room = await c.env.DB.prepare("SELECT id FROM rooms WHERE survey_id = ?1 AND role = ?2").bind(id, role).first<{ id: string }>();
  if (!room) return c.json({ error: "This survey has no such room" }, 404);
  if (!ALLOWED[role as Role].includes(kind)) return c.json({ error: `A ${role.replace("_", " ")} does not take ${kind ?? "that"} files` }, 400);
  if (Number(c.req.header("Content-Length") ?? 0) > MAX_BYTES) return c.json({ error: "Each file must be 20 MB or smaller" }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_BYTES) return c.json({ error: "Each file must be 20 MB or smaller" }, 413);
  const type = sniff(bytes);
  if (!type || !TYPES[kind].includes(type)) {
    return c.json({ error: kind === "path_clip" ? "The path clip must be an MP4 video" : "Photos and frames must be JPEG or PNG" }, 415);
  }

  const fileId = crypto.randomUUID();
  const key = `surveys/${id}/${role}/${fileId}.${EXT[type]}`;
  const name = (c.req.query("name") ?? "").slice(0, 120) || `${kind}.${EXT[type]}`;
  const previous = kind === "path_clip"
    ? await c.env.DB.prepare("SELECT id, r2_key FROM files WHERE room_id = ?1 AND kind = 'path_clip'").bind(room.id).all<{ id: string; r2_key: string }>()
    : { results: [] };
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  // The limit is part of the insert, so parallel uploads cannot pass it. A replaced clip does not count.
  const inserted = await c.env.DB.prepare(
    `INSERT INTO files (id, room_id, kind, r2_key, name, bytes, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
     WHERE (SELECT COUNT(*) FROM files WHERE room_id = ?2 AND kind = ?3) < ?8`,
  ).bind(fileId, room.id, kind, key, name, bytes.length, new Date().toISOString(), kind === "path_clip" ? 2 : LIMIT[kind]).run();
  if (!inserted.meta.changes) {
    await c.env.MEDIA.delete(key);
    return c.json({ error: `A room takes at most ${LIMIT[kind]} ${kind.replace("_", " ")} files` }, 409);
  }
  for (const old of previous.results) {
    await c.env.DB.prepare("DELETE FROM files WHERE id = ?1").bind(old.id).run();
    await c.env.MEDIA.delete(old.r2_key);
  }
  return c.json({ id: fileId, kind, name, bytes: bytes.length }, 201);
});

files.get("/:id/files", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB.prepare(
    `SELECT r.role, f.id, f.kind, f.name, f.bytes FROM rooms r LEFT JOIN files f ON f.room_id = r.id
     WHERE r.survey_id = ?1 ORDER BY f.created_at`,
  ).bind(id).all<{ role: Role; id: string | null; kind: Kind; name: string; bytes: number }>();
  if (!rows.results.length) return c.json({ error: "Survey not found" }, 404);
  const missing = await missingFiles(c.env.DB, id);
  const rooms: Record<string, { files: object[]; missing: Kind[] }> = {};
  for (const r of rows.results) {
    rooms[r.role] ??= { files: [], missing: missing[r.role] };
    if (r.id) rooms[r.role].files.push({ id: r.id, kind: r.kind, name: r.name, bytes: r.bytes });
  }
  return c.json({ rooms });
});

files.delete("/:id/files/:fileId", requirePasscode, async (c) => {
  const { id, fileId } = c.req.param();
  const row = await c.env.DB.prepare(
    "SELECT f.r2_key, s.status FROM files f JOIN rooms r ON r.id = f.room_id JOIN surveys s ON s.id = r.survey_id WHERE f.id = ?1 AND s.id = ?2",
  ).bind(fileId, id).first<{ r2_key: string; status: string }>();
  if (!row) return c.json({ error: "File not found" }, 404);
  if (row.status !== "uploading") return c.json({ ...uploadsClosed, state: row.status }, 409);
  await c.env.DB.prepare("DELETE FROM files WHERE id = ?1").bind(fileId).run();
  await c.env.MEDIA.delete(row.r2_key);
  return c.json({ deleted: fileId });
});

files.post("/:id/process", requirePasscode, async (c) => {
  const id = c.req.param("id");
  const survey = await c.env.DB.prepare("SELECT status FROM surveys WHERE id = ?1").bind(id).first<{ status: "uploading" }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);
  const next = transition(survey.status, "files_complete");
  const missing = await missingFiles(c.env.DB, id);
  if (Object.values(missing).some((m) => m.length)) return c.json({ error: "Some required files are missing", missing }, 409);
  const moved = await c.env.DB.prepare("UPDATE surveys SET status = ?1 WHERE id = ?2 AND status = 'uploading'").bind(next, id).run();
  if (!moved.meta.changes) return c.json({ error: "Processing has already started", state: next }, 409);
  await c.env.DB.prepare("UPDATE surveys SET processing_error = NULL WHERE id = ?1").bind(id).run();
  await c.var.startProcessing(c.env, id);
  return c.json({ status: next });
});
