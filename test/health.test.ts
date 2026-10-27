// protects: the deployed Worker answers and reaches D1; fails_when: routing or the DB binding breaks;
// no_claim: anything about survey logic.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("returns ok after querying D1", async () => {
    const res = await exports.default.fetch("http://survai.test/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
