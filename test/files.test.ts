// protects: uploading prepared files (type from the bytes, 20 MB limit, per-kind limits, replace and delete) and the
// explicit start of processing once every required file is in; fails_when: a wrong type or size is stored, a limit
// is exceeded, files land in R2 without a row (or the reverse), or processing starts twice or incomplete;
// no_claim: the processing itself (T7).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../worker/index";

const started: string[] = [];
const app = createApp({ startProcessing: async (_env, id) => void started.push(id) });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const TEXT = new TextEncoder().encode("not an image at all");

const req = (path: string, init: RequestInit = {}, passcode = env.DEMO_PASSCODE) =>
  app.request(path, { ...init, headers: { "X-Passcode": passcode, "CF-Connecting-IP": "203.0.113.30", ...init.headers } }, env);
const upload = (id: string, role: string, kind: string, bytes: Uint8Array, name = "f.jpg", passcode?: string) =>
  req(`/api/surveys/${id}/rooms/${role}/files?kind=${kind}&name=${encodeURIComponent(name)}`, { method: "POST", body: bytes }, passcode);

async function surveyIn(status: "draft" | "uploading", connects_to = "same_room") {
  const res = await req("/api/surveys", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site: "S", project: "P", device_model: "M", quantity: 1, connects_to }) });
  const { id } = await res.json<{ id: string }>();
  if (status === "uploading") await env.DB.prepare("UPDATE surveys SET status = 'uploading' WHERE id = ?1").bind(id).run();
  return id;
}
const count = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;

beforeEach(async () => {
  for (const t of ["surveys", "survey_reps", "rooms", "files", "passcode_failures"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("POST /api/surveys/:id/rooms/:role/files", () => {
  it("stores a key frame in R2 with a row that points at it", async () => {
    const id = await surveyIn("uploading");
    const res = await upload(id, "devices_hall", "key_frame", JPEG, "frame-01.jpg");
    expect(res.status).toBe(201);
    const file = await res.json<{ id: string }>();
    const row = await env.DB.prepare("SELECT r2_key, kind, name, bytes FROM files WHERE id = ?1").bind(file.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ kind: "key_frame", name: "frame-01.jpg", bytes: JPEG.length });
    expect(await env.MEDIA.head(String(row!.r2_key))).not.toBeNull();
  });

  it("checks the type from the bytes and the 20 MB limit", async () => {
    const id = await surveyIn("uploading");
    expect((await upload(id, "devices_hall", "key_frame", TEXT, "x.jpg")).status).toBe(415);
    expect((await upload(id, "devices_hall", "path_clip", JPEG, "clip.mp4")).status).toBe(415);
    expect((await upload(id, "devices_hall", "panel_photo", MP4, "p.jpg")).status).toBe(415);
    expect((await upload(id, "devices_hall", "photo", PNG, "p.png")).status).toBe(201);
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(JPEG);
    const res = await upload(id, "devices_hall", "key_frame", big);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("20 MB") });
    expect(await count("SELECT COUNT(*) AS n FROM files")).toBe(1);
  });

  it("enforces per-kind limits and room rules", async () => {
    const id = await surveyIn("uploading");
    for (let i = 0; i < 30; i++) expect((await upload(id, "devices_hall", "key_frame", JPEG)).status).toBe(201);
    expect((await upload(id, "devices_hall", "key_frame", JPEG)).status).toBe(409);
    expect((await upload(id, "connect_to", "key_frame", JPEG)).status).toBe(404); // same-room survey has no connect-to room
    expect((await upload(id, "devices_hall", "selfie", JPEG)).status).toBe(400);
  });

  it("replaces the path clip instead of keeping two", async () => {
    const id = await surveyIn("uploading");
    const first = await (await upload(id, "devices_hall", "path_clip", MP4, "a.mp4")).json<{ id: string }>();
    const oldKey = (await env.DB.prepare("SELECT r2_key FROM files WHERE id = ?1").bind(first.id).first<{ r2_key: string }>())!.r2_key;
    expect((await upload(id, "devices_hall", "path_clip", MP4, "b.mp4")).status).toBe(201);
    expect(await count("SELECT COUNT(*) AS n FROM files WHERE kind = 'path_clip'")).toBe(1);
    expect(await env.MEDIA.head(oldKey)).toBeNull();
  });

  it("refuses uploads outside the uploading step and without the passcode", async () => {
    const draft = await surveyIn("draft");
    expect((await upload(draft, "devices_hall", "key_frame", JPEG)).status).toBe(409);
    const id = await surveyIn("uploading");
    expect((await upload(id, "devices_hall", "key_frame", JPEG, "f.jpg", "wrong")).status).toBe(401);
  });

  it("serves byte ranges, so a video player can show the clip before it has all of it", async () => {
    const id = await surveyIn("uploading");
    const { id: fid } = await (await upload(id, "devices_hall", "path_clip", MP4, "a.mp4")).json<{ id: string }>();
    const part = await req(`/api/surveys/${id}/files/${fid}`, { headers: { Range: "bytes=4-7" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe(`bytes 4-7/${MP4.length}`);
    expect(part.headers.get("Accept-Ranges")).toBe("bytes");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(MP4.slice(4, 8));
    const whole = await req(`/api/surveys/${id}/files/${fid}`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Accept-Ranges")).toBe("bytes");
    expect((await whole.arrayBuffer()).byteLength).toBe(MP4.length);
  });

  it("lets a connect-to room take frames but not a path clip", async () => {
    const id = await surveyIn("uploading", "other_room");
    expect((await upload(id, "connect_to", "key_frame", JPEG)).status).toBe(201);
    expect((await upload(id, "connect_to", "path_clip", MP4)).status).toBe(400);
  });
});

describe("files list and delete", () => {
  it("lists files per room and deletes one (row and object)", async () => {
    const id = await surveyIn("uploading");
    const f = await (await upload(id, "devices_hall", "key_frame", JPEG, "frame-01.jpg")).json<{ id: string }>();
    const list = await (await req(`/api/surveys/${id}/files`)).json<{ rooms: Record<string, { files: unknown[]; missing: string[] }> }>();
    expect(list.rooms.devices_hall.files).toHaveLength(1);
    expect(list.rooms.devices_hall.missing).toEqual(["panel_photo"]); // the narration comes from the walk-through when it fits
    const key = (await env.DB.prepare("SELECT r2_key FROM files WHERE id = ?1").bind(f.id).first<{ r2_key: string }>())!.r2_key;
    expect((await req(`/api/surveys/${id}/files/${f.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM files")).toBe(0);
    expect(await env.MEDIA.head(key)).toBeNull();
  });

  it("lists what SAM found on each key frame, so the layout step can draw it", async () => {
    const id = await surveyIn("uploading");
    const f = await (await upload(id, "devices_hall", "key_frame", JPEG, "frame-01.jpg")).json<{ id: string }>();
    await upload(id, "devices_hall", "key_frame", JPEG, "frame-02.jpg");
    const masks = { tiles: [{ x1: 1, y1: 2, x2: 30, y2: 40, c: 0.9 }], racks: [] };
    await env.DB.prepare("UPDATE files SET masks_json = ?1 WHERE id = ?2").bind(JSON.stringify(masks), f.id).run();
    const list = await (await req(`/api/surveys/${id}/files`)).json<{ rooms: Record<string, { files: { id: string; masks?: unknown }[] }> }>();
    const [a, b] = list.rooms.devices_hall.files;
    expect(a).toMatchObject({ id: f.id, masks });
    expect(b.masks).toBeUndefined(); // not processed yet
  });
});

describe("POST /api/surveys/:id/process", () => {
  it("refuses to start with required files missing, naming them", async () => {
    const id = await surveyIn("uploading", "other_room");
    await upload(id, "devices_hall", "key_frame", JPEG);
    const res = await req(`/api/surveys/${id}/process`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ missing: { devices_hall: ["panel_photo"], connect_to: ["key_frame"] } });
  });

  it("starts exactly once when everything is in", async () => {
    const id = await surveyIn("uploading");
    await upload(id, "devices_hall", "key_frame", JPEG);
    await upload(id, "devices_hall", "path_clip", MP4);
    await upload(id, "devices_hall", "panel_photo", JPEG);
    const [a, b] = await Promise.all([req(`/api/surveys/${id}/process`, { method: "POST" }), req(`/api/surveys/${id}/process`, { method: "POST" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(started.filter((s) => s === id)).toHaveLength(1);
    expect((await env.DB.prepare("SELECT status FROM surveys WHERE id = ?1").bind(id).first<{ status: string }>())!.status).toBe("processing");
  });
});
