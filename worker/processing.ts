// ProcessSurvey: SAM on every key frame, the room inventory draft, panel breakers and the request reader, then the
// draft layout. Only SAM and the budget are fatal (survey back to uploading); a failed model reading is noted and
// the engineer fills it in on the layout step.
import { Inventory, inventoryPrompt } from "./agents/inventory";
import { BadModelAnswer, askJson } from "./agents/json";
import { PANEL_PROMPT, PanelReading } from "./agents/panel";
import { READER_PROMPT, Request } from "./agents/reader";
import { BudgetExceeded, ModelError, SamUnavailable, type createModels } from "./clients/models";
import { transition } from "./state";
import { type FrameBoxes, summarizeSam } from "./vision/sam-summary";

export interface StepRunner {
  do<T>(name: string, config: { retries: { limit: number; delay: `${number} seconds`; backoff?: "constant" | "linear" | "exponential" } }, fn: () => Promise<T>): Promise<T>;
}
interface Deps { env: Env; models: ReturnType<typeof createModels>; step: StepRunner }
interface FileRow { id: string; role: "devices_hall" | "connect_to"; room_id: string; kind: string; r2_key: string }

// The model client already retries busy APIs; a step retry only covers a lost Worker.
const STEP = { retries: { limit: 1, delay: "5 seconds" as const } };
const SAM_BATCH = 6;
const INVENTORY_FRAMES = 8; // Baseten: "Too many images: 12 (max 8)"
const DEFAULT_SIZE: Record<string, [number, number]> = { rack: [1, 1.7], ac: [1, 1], door: [1.5, 0.2], panel: [1, 0.3], column: [1, 1], ladder: [1, 1] };

export async function toDataUrl(bucket: R2Bucket, key: string): Promise<string> {
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`missing upload ${key}`);
  const bytes = new Uint8Array(await obj.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${obj.httpMetadata?.contentType ?? "application/octet-stream"};base64,${btoa(bin)}`;
}

const evenly = <T>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]));

/** A model reading that may fail without failing the survey. */
async function optional<T>(what: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof BudgetExceeded) throw err;
    if (err instanceof ModelError || err instanceof BadModelAnswer) return { ok: false, error: err.message.startsWith(what) ? err.message : `${what}: ${err.message}` };
    throw err;
  }
}

export async function runProcessing({ env, models, step }: Deps, surveyId: string) {
  const ctx = { survey: surveyId };
  try {
    const files = await step.do("load files", STEP, async () =>
      (await env.DB.prepare(
        `SELECT f.id, r.role, r.id AS room_id, f.kind, f.r2_key FROM files f JOIN rooms r ON r.id = f.room_id
         WHERE r.survey_id = ?1 ORDER BY f.created_at`,
      ).bind(surveyId).all<FileRow>()).results);

    const rooms = [...new Set(files.map((f) => f.role))];
    const roomResults: Record<string, { roomId: string; frames: FrameBoxes[]; inventory: Awaited<ReturnType<typeof optional<Inventory>>> }> = {};
    for (const role of rooms) {
      const frameFiles = files.filter((f) => f.role === role && f.kind === "key_frame");
      const frames: FrameBoxes[] = [];
      for (let b = 0; b < frameFiles.length; b += SAM_BATCH) {
        const batch = frameFiles.slice(b, b + SAM_BATCH);
        frames.push(...(await step.do(`sam ${role} ${b / SAM_BATCH + 1}`, STEP, () =>
          Promise.all(batch.map(async (f, i) => {
            const image = await toDataUrl(env.MEDIA, f.r2_key);
            const [tiles, racks] = await Promise.all([models.segment(image, "floor tile", ctx), models.segment(image, "server rack", ctx)]);
            const boxes = { tiles: tiles.boxes, racks: racks.boxes };
            await env.DB.prepare("UPDATE files SET masks_json = ?1 WHERE id = ?2").bind(JSON.stringify(boxes), f.id).run();
            return { fileId: f.id, n: b + i + 1, width: tiles.width || racks.width, height: tiles.height || racks.height, ...boxes };
          })))));
      }
      const summary = summarizeSam(frames);
      const picked = evenly(frameFiles.map((f, i) => ({ f, n: i + 1 })), INVENTORY_FRAMES);
      const inventory = await step.do(`inventory ${role}`, STEP, () => optional("room inventory", async () => {
        const images = await Promise.all(picked.map(({ f }) => toDataUrl(env.MEDIA, f.r2_key)));
        // Spark Open reasons at length; 12,000 tokens cut the JSON off mid-answer in the live run.
        return askJson(models, "inventory", { text: inventoryPrompt(summary, picked.map((p) => p.n)), images, maxTokens: 24_000 }, Inventory, "room inventory", { ...ctx, agent: "inventory" });
      }));
      roomResults[role] = { roomId: files.find((f) => f.role === role)!.room_id, frames, inventory };
    }

    const panels = await step.do("panel photos", STEP, () => Promise.all(files.filter((f) => f.kind === "panel_photo").map((f) =>
      optional("panel photo", async () => {
        const reading = await askJson(models, "panel", { text: PANEL_PROMPT, images: [await toDataUrl(env.MEDIA, f.r2_key)] }, PanelReading, "panel photo", { ...ctx, agent: "power" });
        return { fileId: f.id, reading };
      }))));

    const clip = files.find((f) => f.kind === "path_clip");
    const request = clip
      ? await step.do("request reader", STEP, () => optional("narrated path clip", async () => {
          return askJson(models, "reader", { text: READER_PROMPT, videos: [await toDataUrl(env.MEDIA, clip.r2_key)] }, Request, "narrated path clip", { ...ctx, agent: "request" });
        }))
      : { ok: false as const, error: "no path clip" };

    await step.do("write draft", STEP, () => writeDraft(env, surveyId, roomResults, panels, request));
  } catch (err) {
    const message = err instanceof BudgetExceeded ? "Processing budget reached. Try again tomorrow."
      : err instanceof SamUnavailable ? "Image analysis is unavailable right now. Try processing again in a few minutes."
      : "Processing failed. Try again; if it fails again, replace the files.";
    console.error(JSON.stringify({ evt: "processing_failed", survey: surveyId, error: (err as Error).message }));
    await step.do("mark failed", STEP, async () => {
      const next = transition("processing", "processing_failed");
      await env.DB.prepare("UPDATE surveys SET status = ?1, processing_error = ?2 WHERE id = ?3 AND status = 'processing'")
        .bind(next, message, surveyId).run();
    });
  }
}

async function writeDraft(
  env: Env,
  surveyId: string,
  rooms: Record<string, { roomId: string; frames: FrameBoxes[]; inventory: { ok: true; value: Inventory } | { ok: false; error: string } }>,
  panels: ({ ok: true; value: { fileId: string; reading: PanelReading } } | { ok: false; error: string })[],
  request: { ok: true; value: Request } | { ok: false; error: string },
) {
  const db = env.DB;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const notes: string[] = [];
  for (const [role, r] of Object.entries(rooms)) {
    const inv = r.inventory.ok ? r.inventory.value : null;
    const roomNotes = r.inventory.ok ? [] : [r.inventory.error];
    statements.push(db.prepare("DELETE FROM layout_items WHERE room_id = ?1 AND source = 'ai'").bind(r.roomId));
    for (const it of inv?.items ?? []) {
      const [w, d] = DEFAULT_SIZE[it.kind];
      const props = it.kind === "rack"
        ? { height_u: 42, free_blocks: [], is_target: false, off_limits: false, top_height_m: 2.0, contents: it.contents ?? "unknown", frames: it.frames, notes: it.notes ?? null }
        : it.kind === "door" ? { swing_m: 0.9, side: it.facing ?? null, frames: it.frames } : { frames: it.frames, notes: it.notes ?? null };
      statements.push(db.prepare(
        `INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, facing, props_json, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'ai')`,
      ).bind(crypto.randomUUID(), r.roomId, it.kind, it.label, it.x_tiles, it.y_tiles, it.w_tiles ?? w, it.d_tiles ?? d, it.facing ?? null, JSON.stringify(props)));
    }
    const breakers = role === "devices_hall"
      ? panels.flatMap((p) => (p.ok ? p.value.reading.boxes.flatMap((b) => b.breakers.map((br) => ({ panel_file: p.value.fileId, ...br }))) : []))
      : [];
    if (role === "devices_hall") roomNotes.push(...panels.filter((p) => !p.ok).map((p) => (p as { error: string }).error));
    notes.push(...roomNotes);
    const facts = {
      size_tiles: inv ? { w: inv.room.w_tiles, d: inv.room.d_tiles, confidence: inv.room.confidence } : null,
      sam: summarizeSam(r.frames),
      breakers_draft: breakers,
      breakers_confirmed: null,
      ac_count: inv?.items.filter((i) => i.kind === "ac").length ?? null,
      spare_ac_btu: null,
      ladder_height_m: null,
      inter_room_m: null,
      observations: inv?.observations ?? [],
      inventory_notes: inv?.notes ?? "",
      processing_notes: roomNotes, // readings that failed; the engineer fills these in on the layout step
    };
    statements.push(db.prepare("UPDATE rooms SET facts_json = ?1 WHERE id = ?2").bind(JSON.stringify(facts), r.roomId));
  }
  if (!request.ok) notes.push(request.error);
  statements.push(db.prepare("UPDATE surveys SET request_json = ?1, processing_error = NULL WHERE id = ?2")
    .bind(JSON.stringify(request.ok ? request.value : { error: request.error, notes }), surveyId));

  // Reader questions are round-0 findings of the pseudo-agent "request".
  statements.push(db.prepare("DELETE FROM questions WHERE finding_id IN (SELECT id FROM findings WHERE survey_id = ?1 AND round = 0)").bind(surveyId));
  statements.push(db.prepare("DELETE FROM findings WHERE survey_id = ?1 AND round = 0").bind(surveyId));
  if (request.ok && request.value.questions.length) {
    const findingId = crypto.randomUUID();
    statements.push(db.prepare(
      `INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at)
       VALUES (?1, ?2, 0, 0, 'request', 'question', ?3, 0, ?4)`,
    ).bind(findingId, surveyId, JSON.stringify({ statement: request.value.translation_en, notes }), now));
    for (const q of request.value.questions) {
      statements.push(db.prepare("INSERT INTO questions (id, finding_id, text, answer_kind) VALUES (?1, ?2, ?3, ?4)")
        .bind(crypto.randomUUID(), findingId, q.text, q.answer_kind));
    }
  }
  const next = transition("processing", "processing_done");
  statements.push(db.prepare("UPDATE surveys SET status = ?1 WHERE id = ?2 AND status = 'processing'").bind(next, surveyId));
  await db.batch(statements);
}
