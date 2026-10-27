// protects: creating a survey behind the passcode (limit, constant-time check) with its reps and rooms; fails_when:
// a wrong passcode gets through, the 6th try is not refused, reps/rooms are wrong, or bad input is stored;
// no_claim: the UI (checked in the browser at 360/390 px).
import { exports } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const good = { site: "Site A", project: "Card expansion", device_model: "Juniper MX104", quantity: 1, connects_to: "other_room" };
const post = (body: unknown, passcode = env.DEMO_PASSCODE, ip = "203.0.113.7") =>
  exports.default.fetch("http://survai.test/api/surveys", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Passcode": passcode, "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  for (const t of ["surveys", "survey_reps", "rooms", "passcode_failures"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("POST /api/surveys", () => {
  it("creates a two-room survey with Transmission among the default reps", async () => {
    const res = await post(good);
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const got = await (await exports.default.fetch(`http://survai.test/api/surveys/${id}`)).json<Record<string, unknown>>();
    expect(got).toMatchObject({ id, status: "draft", connects_to: "other_room", device_model: "Juniper MX104" });
    expect(got.reps).toEqual(["cooling", "execution", "power", "room_manager", "space", "transmission"]);
    expect(got.rooms).toEqual(["connect_to", "devices_hall"]);
  });

  it("keeps the engineer's reps and one room for a same-room survey", async () => {
    const res = await post({ ...good, connects_to: "same_room", reps: ["space", "power", "room_manager"] });
    const { id } = await res.json<{ id: string }>();
    const got = await (await exports.default.fetch(`http://survai.test/api/surveys/${id}`)).json<Record<string, unknown>>();
    expect(got.reps).toEqual(["power", "room_manager", "space"]);
    expect(got.rooms).toEqual(["devices_hall"]);
  });

  it("rejects Transmission on a same-room survey and bad quantities", async () => {
    expect((await post({ ...good, connects_to: "same_room", reps: ["space", "transmission"] })).status).toBe(400);
    expect((await post({ ...good, quantity: 0 })).status).toBe(400);
    expect((await post({ ...good, quantity: 21 })).status).toBe(400);
    expect((await post({ ...good, site: "" })).status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM surveys").first<{ n: number }>())?.n).toBe(0);
  });

  it("refuses a missing or wrong passcode, and the 6th wrong try in 10 minutes with 429", async () => {
    expect((await post(good, "")).status).toBe(401);
    for (let i = 0; i < 4; i++) expect((await post(good, "wrong")).status).toBe(401);
    expect((await post(good, env.DEMO_PASSCODE)).status).toBe(429); // locked even with the right code
    expect((await post(good, env.DEMO_PASSCODE, "198.51.100.9")).status).toBe(201); // other IPs unaffected
  });
});

describe("GET /api/surveys/:id", () => {
  it("returns 404 for an unknown survey", async () => {
    expect((await exports.default.fetch("http://survai.test/api/surveys/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
