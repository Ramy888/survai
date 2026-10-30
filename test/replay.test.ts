// protects: the public replay of the sample survey (AC 12): read-only, no survey id or file id anywhere, evidence
// frames by number only, the approved run in the report after a rerun; and the live rerun's limits (flag, one per
// IP per window, not while a round runs, daily-budget headroom); fails_when: the replay leaks an id, serves a
// non-sample survey or a non-key-frame file, a rerun skips a limit, or a crashed rerun blocks the page forever;
// no_claim: live model output on a rerun (checked by hand).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../worker/index";

const started: string[] = [];
const app = createApp({ startRound: async (_e, id, run, round) => void started.push(`${id}:${run}:${round}`) });
const call = (path: string, init: RequestInit = {}, ip = "203.0.113.90", e: Env = env) =>
  app.request(path, { ...init, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...init.headers } }, e);
const rerun = (ip?: string, e?: Env) => call("/api/replay/sample/rerun", { method: "POST" }, ip, e);
const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

async function seed({ sample = 1, slug = "sample" } = {}) {
  const id = crypto.randomUUID();
  const hall = crypto.randomUUID();
  const fid = (n: number) => `${id}_file${n}`;
  const body = (agent: string, run: number) => JSON.stringify({ statement: `${agent}-run${run}`, rule_refs: ["R1"], evidence: [{ frame_id: fid(2) }] });
  await env.DB.batch([
    q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, layout_version, approved_run, is_sample, replay_slug, tech_specs_json, created_at) VALUES (?1, 'Demo room', 'Router install', 'Juniper MX104', 1, 'same_room', 'approved', 1, 1, ?2, ?3, '{\"text\":\"SM fibre\"}', 'now')", id, sample, slug),
    q("INSERT INTO survey_reps (survey_id, agent) VALUES (?1, 'power'), (?1, 'space')", id),
    q("INSERT INTO device_specs (survey_id, height_u, power_w, feed_type, feed_count, confirmed) VALUES (?1, 3.5, 800, 'DC', 2, 1)", id),
    q("INSERT INTO rooms (id, survey_id, role, name, facts_json, layout_saved) VALUES (?1, ?2, 'devices_hall', 'Devices hall', '{}', 1)", hall, id),
    q("INSERT INTO files (id, room_id, kind, r2_key, created_at) VALUES (?1, ?2, 'key_frame', ?3, '2026-10-27T00:00:01Z'), (?4, ?2, 'key_frame', ?5, '2026-10-27T00:00:02Z'), (?6, ?2, 'panel_photo', ?7, '2026-10-27T00:00:03Z')",
      fid(1), hall, `rp/${id}/1`, fid(2), `rp/${id}/2`, fid(3), `rp/${id}/3`),
    ...["power", "space"].map((a) => q("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, 1, 1, ?3, 'approve', ?4, 1, ?5)", crypto.randomUUID(), id, a, body(a, 1), ago(60))),
    q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, outcome, created_at) VALUES (?1, 1, 1, ?2, 'muse-wonder-1.0', 'done', ?3)", id,
      JSON.stringify({ summary: "All approve.", placement: { target: "rack:R5", reason: "fits" }, conflicts: [] }), ago(60)),
  ]);
  for (const n of [1, 2, 3]) await env.MEDIA.put(`rp/${id}/${n}`, new Uint8Array([0xff, 0xd8, 0xff, n]), { httpMetadata: { contentType: "image/jpeg" } });
  return { id, hall, fid, body };
}

beforeEach(async () => {
  started.length = 0;
  for (const t of ["surveys", "survey_reps", "device_specs", "rooms", "files", "findings", "questions", "lead_notes", "calcs", "rerun_requests", "usage_counters"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("GET /api/replay/:slug", () => {
  it("returns the meeting and the report with no survey id or file id anywhere (AC 12)", async () => {
    const { id, fid } = await seed();
    const res = await call("/api/replay/sample");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow"); // unlisted: the link goes to the judges only
    const text = await res.text();
    expect(text).not.toContain(id);
    expect(text).not.toContain(fid(2));
    const body = JSON.parse(text);
    expect(body.timeline.rounds[0].findings[0]).toMatchObject({ agent: "power", evidence: [{ frame: 2 }] });
    expect(body.report.header).toMatchObject({ site: "Demo room" });
    expect(body.report.tech_specs).toEqual({ text: "SM fibre" });
    expect(body.rerun).toMatchObject({ enabled: true, running: false });
  });

  it("explains how the survey was made: footage, what the models drafted, what the engineer confirmed", async () => {
    const { id, hall } = await seed();
    const facts = {
      sam: { frames: 2, per_frame: [{ n: 1, tiles: 4, racks: 2 }, { n: 2, tiles: 0, racks: 1 }] },
      breakers_draft: [{ position: 1 }, { position: 2 }, { position: 3 }],
      breakers_confirmed: [{ position: 1, dc: true, rating_a: 16, free: false }, { position: 3, dc: true, rating_a: 16, free: true }],
      spare_ac_btu: 6000, ladder_height_m: 2.6, observations: [{ rule: "R1", text: "Stepladder", frames: [1] }],
    };
    await env.DB.batch([
      q("UPDATE rooms SET facts_json = ?1 WHERE id = ?2", JSON.stringify(facts), hall),
      q("UPDATE surveys SET request_json = ?1 WHERE id = ?2", JSON.stringify({ destination: "rack 40" }), id), // read, then the video was deleted
      q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, props_json, source) VALUES (?1, ?4, 'rack', 'R1', 0, 0, '{}', 'ai'), (?2, ?4, 'door', 'D1', 1, 0, '{}', 'ai'), (?3, ?4, 'rack', 'R3', 2, 0, ?5, 'engineer')",
        crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), hall, JSON.stringify({ is_target: true, free_blocks: [{ from_u: 10, to_u: 30 }] })),
    ]);
    const body = await (await call("/api/replay/sample")).json<Record<string, any>>();
    // what the agents started from, each value with its source
    expect(body.made.inputs).toMatchObject({
      target: { label: "R3", free: [{ from_u: 10, to_u: 30 }], edited: true }, spareAcBtu: 6000, ladder: { m: 2.6, assumed: false },
      breakers: { seen: 2, free: 1, rated: 2, edited: true }, observations: ["Stepladder"],
    });
    expect(body.made).toMatchObject({
      footage: { frames: 2, narration: true, photos: 1, source: "prepared", blurred: true },
      sam: { frames: 2, rack_frames: 2, tile_frames: 1 },
      drafted: { items: 2, breakers: 3, observations: 1 },
      engineer: { added: 1, target: "R3", free_u: "10-30", free_breakers: 1, spare_ac_btu: 6000, ladder_height_m: 2.6 },
    });
    expect(JSON.stringify(body.made)).not.toContain(id);
  });

  it("serves only a sample survey", async () => {
    await seed({ sample: 0, slug: "sample" });
    expect((await call("/api/replay/sample")).status).toBe(404);
    expect((await call("/api/replay/other")).status).toBe(404);
  });

  it("keeps reporting the approved run after a rerun adds a newer one", async () => {
    const { id, body } = await seed();
    await env.DB.batch([
      q("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, 2, 1, 'power', 'object', ?3, 1, 'now')", crypto.randomUUID(), id, body("power", 2)),
      q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, outcome, created_at) VALUES (?1, 2, 1, '{\"summary\":\"rerun\",\"placement\":{\"target\":\"none\",\"reason\":\"\"}}', 'm', 'done', 'now')", id),
    ]);
    const r = await (await call("/api/replay/sample")).json<Record<string, any>>();
    expect(r.timeline.run).toBe(2);
    expect(r.report.statements.map((s: { statement: string }) => s.statement)).toContain("power-run1");
  });
});

describe("GET /sample", () => {
  it("sends anyone to the current sample's replay, so the public link survives a new slug", async () => {
    await seed({ slug: "s-abc123" });
    const res = await call("/sample");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/replay/s-abc123");
  });

  it("goes to the start page when there is no sample", async () => {
    await seed({ sample: 0, slug: "s-abc123" });
    expect((await call("/sample")).headers.get("Location")).toBe("/");
  });
});

describe("GET /api/replay/:slug/frames/:n", () => {
  it("serves key frames by number and nothing else", async () => {
    await seed();
    const f2 = await call("/api/replay/sample/frames/2");
    expect(f2.status).toBe(200);
    expect(new Uint8Array(await f2.arrayBuffer())[3]).toBe(2);
    expect((await call("/api/replay/sample/frames/3")).status).toBe(404); // the panel photo is not a numbered frame
    expect((await call("/api/replay/sample/frames/0")).status).toBe(404);
  });
});

describe("POST /api/replay/:slug/rerun", () => {
  it("starts the next run live, once per IP per window", async () => {
    const { id } = await seed();
    const res = await rerun();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ run: 2 });
    expect(started).toEqual([`${id}:2:1`]);
    // Before the new run writes anything, the replay already shows it as running, and another visitor waits.
    expect((await (await call("/api/replay/sample")).json<Record<string, any>>()).rerun.running).toBe(true);
    expect((await rerun("203.0.113.95")).status).toBe(409);
    // Once it is over, the same visitor still waits out the window; a new visitor may run it again.
    await q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, outcome, created_at) VALUES (?1, 2, 1, '{}', 'm', 'done', ?2)", id, new Date(Date.now() + 1000).toISOString()).run();
    expect((await rerun()).status).toBe(429);
    expect((await rerun("203.0.113.96")).status).toBe(202);
    expect(started).toEqual([`${id}:2:1`, `${id}:3:1`]);
  });

  it("lets the same visitor rerun again after 3 minutes, not before", async () => {
    const { id } = await seed();
    await q("INSERT INTO rerun_requests (ip, at) VALUES ('203.0.113.80', ?1)", ago(2)).run();
    await q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, outcome, created_at) VALUES (?1, 2, 1, '{}', 'm', 'done', ?2)", id, ago(1)).run(); // that run is over
    const early = await rerun("203.0.113.80");
    expect(early.status).toBe(429);
    expect((await early.json<{ error: string }>()).error).toContain("every 3 minutes");
    await q("UPDATE rerun_requests SET at = ?1 WHERE ip = '203.0.113.80'", ago(4)).run();
    expect((await rerun("203.0.113.80")).status).toBe(202);
  });

  it("refuses while a round is running, unless that round has been stuck for long", async () => {
    const { id } = await seed();
    await q("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, 2, 1, 'power', 'approve', '{}', 1, ?3)", crypto.randomUUID(), id, ago(1)).run();
    expect((await rerun("203.0.113.91")).status).toBe(409);
    await q("UPDATE findings SET created_at = ?1 WHERE run = 2", ago(30)).run();
    expect((await rerun("203.0.113.92")).status).toBe(202);
    expect(started).toEqual([`${id}:3:1`]);
  });

  it("refuses with the budget message when the day's model calls are nearly used up", async () => {
    await seed();
    await q("INSERT INTO usage_counters (day, kind, count) VALUES (?1, 'model', ?2)", new Date().toISOString().slice(0, 10), Number(env.MODEL_DAILY_CAP) - 10).run();
    const res = await rerun("203.0.113.93");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/budget/i) });
    expect(started).toEqual([]);
  });

  it("keeps a reserve of the day's model budget for real surveys (CSO-1)", async () => {
    await seed();
    await q("INSERT INTO usage_counters (day, kind, count) VALUES (?1, 'model', ?2)", new Date().toISOString().slice(0, 10), Number(env.MODEL_DAILY_CAP) - 200).run();
    expect((await rerun("203.0.113.97")).status).toBe(429); // 200 left is enough for a meeting, but it is the reserve
    expect(started).toEqual([]);
  });

  it("allows at most 20 public reruns a day, whatever the IPs (CSO-1)", async () => {
    const { id } = await seed();
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.batch(Array.from({ length: 20 }, (_, k) => q("INSERT INTO rerun_requests (ip, at) VALUES (?1, ?2)", `198.51.100.${k}`, `${day}T00:00:00Z`)));
    // Those reruns have finished: a lead note newer than them, so the test also holds just after midnight UTC.
    await q("UPDATE lead_notes SET created_at = ?2 WHERE survey_id = ?1", id, new Date().toISOString()).run();
    const res = await rerun("203.0.113.98");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/today/i) });
    expect(started).toEqual([]);
  });

  it("is off when the flag is off", async () => {
    await seed();
    const off = { ...env, RERUN_ENABLED: "0" } as Env;
    expect((await rerun("203.0.113.94", off)).status).toBe(404);
    expect((await (await call("/api/replay/sample", {}, undefined, off)).json<Record<string, any>>()).rerun.enabled).toBe(false);
  });
});
