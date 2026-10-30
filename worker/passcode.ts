// Passcode for creating surveys and uploading: 5 wrong tries per IP per 10 minutes, compared in constant time.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types";

const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 5;

const digest = async (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));

export const requirePasscode: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const failures = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM passcode_failures WHERE ip = ?1 AND at > ?2")
    .bind(ip, since).first<{ n: number }>();
  if ((failures?.n ?? 0) >= MAX_FAILURES) return c.json({ error: "Too many wrong passcodes. Try again in 10 minutes." }, 429);

  const given = c.req.header("X-Passcode") ?? "";
  // Hashing both sides gives equal lengths, which timingSafeEqual requires.
  const matches = async (secret: string | undefined) => !!secret && given !== "" && crypto.subtle.timingSafeEqual(await digest(given), await digest(secret));
  const team = await matches(c.env.DEMO_PASSCODE);
  const judge = !team && await matches(c.env.JUDGE_PASSCODE);
  if (!team && !judge) {
    await c.env.DB.prepare("INSERT INTO passcode_failures (ip, at) VALUES (?1, ?2)").bind(ip, new Date().toISOString()).run();
    return c.json({ error: "Wrong passcode." }, 401);
  }
  c.set("judge", judge);
  await next();
};
