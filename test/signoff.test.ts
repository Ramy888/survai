// protects: department sign-off links (AC 11): issued once at approve and stored only as hashes; a link shows only
// its own department's statement, items and evidence; one decision per link; the report records it; the flag turns
// it off; fails_when: a raw token is stored, a bad token reads anything, a page leaks another department's statement
// or the survey id, a second decision lands, or a frame outside the department's evidence is served; no_claim: the
// page layout (checked in the browser).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../worker/index";
import { buildReport } from "../worker/report";

const app = createApp({ startRound: async () => {} });
const call = (path: string, init: RequestInit = {}, e: Env = env) =>
  app.request(path, { ...init, headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.80", ...init.headers } }, e);
const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
const withToken = (token: string, init: RequestInit = {}) => ({ ...init, headers: { "X-Signoff-Token": token } });

async function seed() {
  const id = crypto.randomUUID();
  const hall = crypto.randomUUID();
  const ids: Record<string, string> = {};
  const stmts = [
    q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, layout_version, created_at) VALUES (?1, 'Demo room', 'Router install', 'Juniper MX104', 1, 'same_room', 'deliberating', 2, 'now')", id),
    q("INSERT INTO rooms (id, survey_id, role, name, facts_json, layout_saved) VALUES (?1, ?2, 'devices_hall', 'Devices hall', '{}', 1)", hall, id),
    q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, outcome, created_at) VALUES (?1, 1, 1, '{}', 'm', 'done', 'now')", id),
    ...[1, 2, 3].map((n) => q("INSERT INTO files (id, room_id, kind, r2_key, created_at) VALUES (?1, ?2, 'key_frame', ?3, ?4)", `${id}_f${n}`, hall, `sig/${id}/${n}`, `2026-10-27T00:00:0${n}Z`)),
  ];
  const body = (agent: string, frames: number[]) => JSON.stringify({
    statement: `${agent.toUpperCase()}-STATEMENT`, rule_refs: agent === "power" ? ["R11"] : ["R1"], forced_rules: [],
    evidence: frames.map((n) => ({ frame_id: `${id}_f${n}` })).concat([{ frame_id: `${id}_f${frames[0]}` }]), // repeats, as live findings do
    items: [{ kind: "spec", text: `${agent} item`, quantity: 2, unit: "pcs" }],
  });
  for (const [agent, verdict, frames] of [["power", "approve", [1]], ["room_manager", "object", [2, 3]]] as const) {
    ids[agent] = crypto.randomUUID();
    stmts.push(q("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, 1, 1, ?3, ?4, ?5, 2, 'now')", ids[agent], id, agent, verdict, body(agent, [...frames])));
  }
  await env.DB.batch(stmts);
  for (const n of [1, 2, 3]) await env.MEDIA.put(`sig/${id}/${n}`, new Uint8Array([0xff, 0xd8, 0xff, n]), { httpMetadata: { contentType: "image/jpeg" } });
  return { id, ids };
}

const approveWithLinks = async (id: string, ids: Record<string, string>, e: Env = env) =>
  call(`/api/surveys/${id}/approve`, { method: "POST", headers: { "X-Passcode": env.DEMO_PASSCODE }, body: JSON.stringify({ overrides: { [ids.room_manager]: "Pre-work item" }, issue_links: true }) }, e);
async function links() {
  const s = await seed();
  const r = await (await approveWithLinks(s.id, s.ids)).json<{ links: { agent: string; token: string }[] }>();
  const token = (agent: string) => r.links.find((l) => l.agent === agent)!.token;
  return { ...s, links: r.links, token };
}

beforeEach(async () => {
  for (const t of ["surveys", "rooms", "files", "findings", "questions", "lead_notes", "signoffs", "passcode_failures"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("issuing links at approve", () => {
  it("returns one link per department of the last round, once, and stores only SHA-256 hashes", async () => {
    const { id, links: l } = await links();
    expect(l.map((x) => x.agent).sort()).toEqual(["power", "room_manager"]);
    for (const x of l) expect(x.token).toMatch(/^[A-Za-z0-9_-]{22}$/); // 128 bits, base64url
    const rows = (await q("SELECT token_hash FROM signoffs WHERE survey_id = ?1", id).all<{ token_hash: string }>()).results;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(l.some((x) => x.token === r.token_hash)).toBe(false);
    }
  });

  it("issues nothing when sign-off is switched off, and the page is 404", async () => {
    const s = await seed();
    const off = { ...env, SIGNOFF_ENABLED: "0" } as Env;
    expect(await (await approveWithLinks(s.id, s.ids, off)).json()).toEqual({ status: "approved", links: [] });
    expect((await q("SELECT COUNT(*) AS n FROM signoffs WHERE survey_id = ?1", s.id).first<{ n: number }>())!.n).toBe(0);
    const { token } = await links(); // issued while on, then switched off: the page goes dark
    expect((await call("/api/signoff", withToken(token("power")))).status).toBe(200);
    expect((await call("/api/signoff", withToken(token("power")), off)).status).toBe(404);
  });
});

describe("the department page", () => {
  it("is 404 for a bad or missing token", async () => {
    await links();
    expect((await call("/api/signoff", withToken("A".repeat(22)))).status).toBe(404);
    expect((await call("/api/signoff")).status).toBe(404);
  });

  it("shows only its own statement, items and evidence, never the survey id (AC 11)", async () => {
    const { id, token } = await links();
    const res = await call("/api/signoff", withToken(token("room_manager")));
    expect(res.status).toBe(200);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    const body = await res.json<Record<string, any>>();
    expect(body).toMatchObject({
      agent: "room_manager", site: "Demo room", device: "1 × Juniper MX104", verdict: "object", statement: "ROOM_MANAGER-STATEMENT",
      rules: [{ id: "R1", text: expect.stringMatching(/leftover/) }], items: [{ text: "room_manager item" }], override_reason: "Pre-work item", frames: 2, decision: null,
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("POWER-STATEMENT");
    expect(text).not.toContain(id);
  });

  it("serves the department's own evidence frames by page index only", async () => {
    const { token } = await links();
    const t = token("room_manager");
    const f2 = await call("/api/signoff/frames/2", withToken(t));
    expect(f2.status).toBe(200);
    expect(new Uint8Array(await f2.arrayBuffer())[3]).toBe(3); // frame 3 of the room is this page's 2nd frame
    expect((await call("/api/signoff/frames/3", withToken(t))).status).toBe(404);
    expect((await call("/api/signoff/frames/0", withToken(t))).status).toBe(404);
    expect((await call("/api/signoff/frames/1", withToken("A".repeat(22)))).status).toBe(404);
  });
});

describe("the decision", () => {
  const decide = (token: string, body: object) => call("/api/signoff", withToken(token, { method: "POST", body: JSON.stringify(body) }));

  it("records one decision; a second is 409; the report shows it", async () => {
    const { id, token } = await links();
    expect((await decide(token("room_manager"), { rep_name: "Site manager", decision: "object", comment: "Remove the ladder first" })).status).toBe(200);
    expect((await decide(token("room_manager"), { rep_name: "Someone else", decision: "approve" })).status).toBe(409);
    const page = await (await call("/api/signoff", withToken(token("room_manager")))).json<Record<string, any>>();
    expect(page.decision).toMatchObject({ rep_name: "Site manager", decision: "object", comment: "Remove the ladder first" });
    const report = (await buildReport(env.DB, id))!;
    expect(report.signoffs).toEqual([expect.objectContaining({ agent: "room_manager", rep_name: "Site manager", decision: "object", comment: "Remove the ladder first" })]);
  });

  it("needs a name, a decision, and a comment when objecting", async () => {
    const { token } = await links();
    const t = token("power");
    expect((await decide(t, { rep_name: "", decision: "approve" })).status).toBe(400);
    expect((await decide(t, { rep_name: "A", decision: "maybe" })).status).toBe(400);
    expect((await decide(t, { rep_name: "A", decision: "object", comment: " " })).status).toBe(400);
    expect((await decide(t, { rep_name: "Power lead", decision: "approve" })).status).toBe(200);
  });
});
