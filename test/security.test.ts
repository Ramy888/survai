// protects: the security headers on every kind of Worker response (JSON, errors, 404s, rate limits); fails_when: a
// response type loses Referrer-Policy, noindex or nosniff (tokens and slugs could leak or be indexed), or an error body
// shows internals; no_claim: static page headers (public/_headers, checked on the deployed URL) or rendering
// (test/render.test.ts).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../worker/index";

const app = createApp({ startRound: async () => { throw new Error("boom"); } });
const call = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.120", ...init.headers } }, env);

describe("security headers", () => {
  it("are on success, client errors, 404s, rate limits and server errors", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, created_at) VALUES (?1, 'S', 'P', 'M', 1, 'same_room', 'deliberating', 'now')").bind(id).run();
    const responses = {
      ok: await call("/api/health"),
      notFound: await call("/api/nothing-here"),
      badToken: await call("/api/signoff", { headers: { "X-Signoff-Token": "A".repeat(22) } }),
      wrongPasscode: await call(`/api/surveys/${id}/deliberate`, { method: "POST", headers: { "X-Passcode": "wrong" } }),
      serverError: await call(`/api/surveys/${id}/deliberate`, { method: "POST", headers: { "X-Passcode": env.DEMO_PASSCODE, "CF-Connecting-IP": "203.0.113.121" } }),
    };
    expect(responses.serverError.status).toBe(500);
    for (const [name, res] of Object.entries(responses)) {
      expect.soft(res.headers.get("Referrer-Policy"), name).toBe("no-referrer");
      expect.soft(res.headers.get("X-Robots-Tag"), name).toBe("noindex, nofollow");
      expect.soft(res.headers.get("X-Content-Type-Options"), name).toBe("nosniff");
    }
    expect(await responses.serverError.text()).not.toMatch(/boom|at .*\.ts/); // no internals in the error body
  });
});
