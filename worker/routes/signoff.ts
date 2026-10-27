// A department representative's one-shot sign-off. The token travels in the X-Signoff-Token header (the page keeps it
// in the URL fragment), so it never appears in a request URL, a log line or a Referer. Only its SHA-256 is stored.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { RULES } from "../agents/config";
import type { AppEnv } from "../types";

export const signoff = new Hono<AppEnv>();

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const tokenHash = async (token: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
/** 128 random bits, base64url. */
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Link = { survey_id: string; agent: string; rep_name: string | null; decision: string | null; comment: string | null; decided_at: string | null };
async function resolve(c: Context<AppEnv>) {
  const token = c.req.header("X-Signoff-Token") ?? "";
  if (c.env.SIGNOFF_ENABLED === "0" || !/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  return c.env.DB.prepare("SELECT survey_id, agent, rep_name, decision, comment, decided_at FROM signoffs WHERE token_hash = ?1").bind(await tokenHash(token)).first<Link>();
}

/** The department's finding in the survey's last round, and its evidence frames numbered for this page (1, 2, ...). */
async function finding(db: D1Database, link: Link) {
  const f = await db.prepare(
    "SELECT verdict, body_json, override_reason FROM findings WHERE survey_id = ?1 AND agent = ?2 AND round > 0 ORDER BY run DESC, round DESC LIMIT 1",
  ).bind(link.survey_id, link.agent).first<{ verdict: string; body_json: string; override_reason: string | null }>();
  if (!f) return null;
  const body = JSON.parse(f.body_json) as { statement: string; rule_refs?: string[]; forced_rules?: string[]; items?: object[]; evidence?: { frame_id?: string }[] };
  const frames = [...new Set((body.evidence ?? []).flatMap((e) => (e.frame_id ? [e.frame_id] : [])))];
  return { f, body, frames };
}

signoff.get("/", async (c) => {
  const link = await resolve(c);
  const s = link && await c.env.DB.prepare("SELECT site, project, device_model, quantity, status FROM surveys WHERE id = ?1").bind(link.survey_id)
    .first<{ site: string; project: string; device_model: string; quantity: number; status: string }>();
  const found = link && s && await finding(c.env.DB, link);
  if (!link || !s || !found) return c.json({ error: "This link is not valid" }, 404);
  const { f, body, frames } = found;
  return c.json({
    agent: link.agent, site: s.site, project: s.project, device: `${s.quantity} × ${s.device_model}`, status: s.status,
    verdict: f.verdict, statement: body.statement, override_reason: f.override_reason, forced_rules: body.forced_rules ?? [],
    rules: (body.rule_refs ?? []).map((r) => ({ id: r, text: RULES[r]?.text ?? null })), items: body.items ?? [], frames: frames.length,
    decision: link.decision ? { rep_name: link.rep_name, decision: link.decision, comment: link.comment, decided_at: link.decided_at } : null,
  });
});

signoff.get("/frames/:n", async (c) => {
  const link = await resolve(c);
  const found = link && await finding(c.env.DB, link);
  const fileId = found?.frames[Number(c.req.param("n")) - 1];
  const row = fileId && await c.env.DB.prepare("SELECT f.r2_key FROM files f JOIN rooms r ON r.id = f.room_id WHERE f.id = ?1 AND r.survey_id = ?2")
    .bind(fileId, link!.survey_id).first<{ r2_key: string }>();
  const obj = row && await c.env.MEDIA.get(row.r2_key);
  if (!obj) return c.json({ error: "Frame not found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
});

const Decision = z.object({
  rep_name: z.string().trim().min(1).max(80),
  decision: z.enum(["approve", "object"]),
  comment: z.string().trim().max(500).default(""),
}).refine((d) => d.decision === "approve" || d.comment.length > 0, { message: "Say why you object", path: ["comment"] });

signoff.post("/", async (c) => {
  const link = await resolve(c);
  if (!link) return c.json({ error: "This link is not valid" }, 404);
  const d = Decision.safeParse(await c.req.json().catch(() => null));
  if (!d.success) return c.json({ error: d.error.issues[0]?.message ?? "Check the form", issues: d.error.issues }, 400);
  // One decision per link: the conditional write turns a second one (or a double tap) into a 409.
  const r = await c.env.DB.prepare("UPDATE signoffs SET rep_name = ?1, decision = ?2, comment = ?3, decided_at = ?4 WHERE token_hash = ?5 AND decision IS NULL")
    .bind(d.data.rep_name, d.data.decision, d.data.comment || null, new Date().toISOString(), await tokenHash(c.req.header("X-Signoff-Token")!)).run();
  if (!r.meta.changes) return c.json({ error: "This department has already decided" }, 409);
  return c.json({ decision: d.data.decision });
});
