// The public, read-only replay of the sample survey: its meeting and its report, addressed by slug, with no survey or
// file id in anything it returns. "Run the meeting again" starts a live run on the same fixed frames, within limits.
import { Hono } from "hono";
import { numberFrames } from "../meeting";
import { buildReport } from "../report";
import type { AppEnv } from "../types";
import { nextRun } from "./deliberate";
import { buildTimeline } from "./timeline";

export const replay = new Hono<AppEnv>();

const WINDOW_MIN = 10; // one rerun per IP per window; a round silent this long counts as crashed
const MEETING_CALLS = 25; // up to 3 rounds × (6 departments + the Lead), with room for retries
// Public reruns share the daily model cap with real surveys, so they get their own allowance and never touch a reserve
// kept for real work (CSO-1: rotating IPs could otherwise spend the whole day's budget).
const RERUNS_PER_DAY = 10;
const RESERVE_CALLS = 300;

const sample = (db: D1Database, slug: string) =>
  db.prepare("SELECT id FROM surveys WHERE replay_slug = ?1 AND is_sample = 1").bind(slug).first<{ id: string }>().then((r) => r?.id ?? null);
const keyFrames = (db: D1Database, id: string) =>
  db.prepare("SELECT f.id, r.role, f.r2_key FROM files f JOIN rooms r ON r.id = f.room_id WHERE r.survey_id = ?1 AND f.kind = 'key_frame' ORDER BY f.created_at")
    .bind(id).all<{ id: string; role: string; r2_key: string }>().then((r) => r.results);

/** A round is running when the latest one has no Lead note yet, or led to another round, and is not stuck. */
async function running(db: D1Database, id: string) {
  const r = await db.prepare(
    `SELECT l.outcome, MAX(x.at) AS at FROM (
       SELECT run, round, created_at AS at FROM findings WHERE survey_id = ?1 AND round > 0
       UNION ALL SELECT run, round, created_at FROM lead_notes WHERE survey_id = ?1) x
     LEFT JOIN lead_notes l ON l.survey_id = ?1 AND l.run = x.run AND l.round = x.round
     GROUP BY x.run, x.round ORDER BY x.run DESC, x.round DESC LIMIT 1`,
  ).bind(id).first<{ outcome: string | null; at: string }>();
  const fresh = (at: string | null | undefined) => at != null && Date.parse(at) > Date.now() - WINDOW_MIN * 60_000;
  // A rerun just requested has written nothing for its first ~20 s, while its agents think; it is running too.
  const asked = await db.prepare("SELECT MAX(at) AS at FROM rerun_requests").first<{ at: string | null }>();
  if (fresh(asked?.at) && (!r || Date.parse(asked!.at!) > Date.parse(r.at))) return true;
  if (!r || r.outcome === "done" || r.outcome === "waiting") return false;
  return fresh(r.at);
}

replay.get("/:slug", async (c) => {
  const db = c.env.DB;
  const id = await sample(db, c.req.param("slug"));
  const [timeline, report] = id ? await Promise.all([buildTimeline(db, id), buildReport(db, id)]) : [null, null];
  if (!id || !timeline || !report) return c.json({ error: "Replay not found" }, 404);
  const frameNo = new Map(numberFrames(await keyFrames(db, id)).map((f) => [f.fileId, f.n]));
  // Evidence is addressed by frame number only; file ids never leave the server.
  const strip = (ev: { frame_id?: string; file_id?: string; frame?: number | null; calc_id?: string }[] = []) =>
    ev.map((e) => (e.calc_id ? { calc_id: e.calc_id } : { frame: e.frame ?? frameNo.get((e.file_id ?? e.frame_id)!) ?? null }));
  return c.json({
    timeline: { ...timeline, rounds: timeline.rounds.map((r) => ({ ...r, findings: r.findings.map((f) => ({ ...f, evidence: strip(f.evidence as never) })) })) },
    report: { ...report, statements: report.statements.map((s) => ({ ...s, evidence: strip(s.evidence as never) })) },
    rerun: { enabled: c.env.RERUN_ENABLED !== "0", running: await running(db, id) },
  });
});

replay.get("/:slug/frames/:n", async (c) => {
  const id = await sample(c.env.DB, c.req.param("slug"));
  const frames = id ? await keyFrames(c.env.DB, id) : [];
  const n = Number(c.req.param("n"));
  const hit = numberFrames(frames).find((f) => f.n === n);
  const obj = hit && await c.env.MEDIA.get(frames.find((f) => f.id === hit.fileId)!.r2_key);
  if (!obj) return c.json({ error: "Frame not found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
});

replay.post("/:slug/rerun", async (c) => {
  const db = c.env.DB;
  if (c.env.RERUN_ENABLED === "0") return c.json({ error: "Reruns are switched off" }, 404);
  const id = await sample(db, c.req.param("slug"));
  if (!id) return c.json({ error: "Replay not found" }, 404);
  if (await running(db, id)) return c.json({ error: "The meeting is already running. Watch it here." }, 409);
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM rerun_requests WHERE ip = ?1 AND at > ?2").bind(ip, since).first<{ n: number }>();
  if (recent?.n) return c.json({ error: `One rerun per visitor every ${WINDOW_MIN} minutes. Try again later.` }, 429);
  const day = new Date().toISOString().slice(0, 10);
  const today = await db.prepare("SELECT COUNT(*) AS n FROM rerun_requests WHERE at >= ?1").bind(day).first<{ n: number }>();
  if ((today?.n ?? 0) >= RERUNS_PER_DAY) return c.json({ error: "The meeting has been rerun enough for today. The replay above is the full recorded meeting; try again tomorrow." }, 429);
  // Refuse up front rather than let a run stall half way when the day's model calls run out.
  const used = await db.prepare("SELECT count FROM usage_counters WHERE day = ?1 AND kind = 'model'").bind(day).first<{ count: number }>();
  if (Number(c.env.MODEL_DAILY_CAP) - (used?.count ?? 0) < MEETING_CALLS + RESERVE_CALLS) return c.json({ error: "Today's model budget is used up. The replay above is still the full recorded meeting; try a rerun tomorrow." }, 429);
  await db.prepare("INSERT INTO rerun_requests (ip, at) VALUES (?1, ?2)").bind(ip, new Date().toISOString()).run();
  const run = await nextRun(db, id);
  await c.var.startRound(c.env, id, run, 1);
  return c.json({ run }, 202);
});
