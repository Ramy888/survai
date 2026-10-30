// protects: the approve gate (AC 9) and the move to approved; fails_when: a survey is approved with an objection or
// unavailable department lacking a reason, an open question, a meeting still running, or a layout edited after the
// last round; a double approve succeeds; or tech specs and override reasons are not stored; no_claim: the screen.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { approveGate } from "../worker/approve";
import { createApp } from "../worker/index";

const started: string[] = [];
const app = createApp({ startRound: async (_e, id, run, round) => void started.push(`${id}:${run}:${round}`) });
const req = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { "Content-Type": "application/json", "X-Passcode": env.DEMO_PASSCODE, "CF-Connecting-IP": "203.0.113.70", ...init.headers } }, env);
const approve = (id: string, body: object) => req(`/api/surveys/${id}/approve`, { method: "POST", body: JSON.stringify(body) });
const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);

/** A survey whose run 1 round 2 ended `outcome`: power objects, the rest approve; optionally an open question. */
async function seed({ outcome = "done", openQuestion = false, roundVersion = 4 } = {}) {
  const id = crypto.randomUUID();
  const hall = crypto.randomUUID();
  const ids: Record<string, string> = {};
  const stmts = [
    q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, layout_version, created_at) VALUES (?1, 'S', 'P', 'M', 1, 'same_room', 'deliberating', 4, 'now')", id),
    q("INSERT INTO rooms (id, survey_id, role, name, facts_json, layout_saved) VALUES (?1, ?2, 'devices_hall', 'Devices hall', '{}', 1)", hall, id),
    q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, outcome, created_at) VALUES (?1, 1, 2, '{}', 'm', ?2, 'now')", id, outcome),
  ];
  for (const [agent, verdict] of [["power", "object"], ["space", "approve"], ["cooling", openQuestion ? "question" : "approve"]]) {
    ids[agent] = crypto.randomUUID();
    stmts.push(q("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, 1, 2, ?3, ?4, '{\"statement\":\"s\"}', ?5, 'now')", ids[agent], id, agent, verdict, roundVersion));
  }
  // An unavailable department in an earlier round no longer counts.
  stmts.push(q("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, 1, 1, 'space', 'unavailable', '{}', 4, 'now')", crypto.randomUUID(), id));
  if (openQuestion) stmts.push(q("INSERT INTO questions (id, finding_id, text, answer_kind) VALUES (?1, ?2, 'Spare BTU/h?', 'number')", crypto.randomUUID(), ids.cooling));
  await env.DB.batch(stmts);
  return { id, ids };
}

const status = async (id: string) => (await q("SELECT status FROM surveys WHERE id = ?1", id).first<{ status: string }>())!.status;

beforeEach(async () => {
  for (const t of ["surveys", "rooms", "layout_items", "findings", "questions", "lead_notes", "passcode_failures", "signoffs"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("approveGate", () => {
  const base = { status: "deliberating", layout_version: 4, latest: { layout_version: 4, outcome: "done" as const }, findings: [{ id: "f1", agent: "power", verdict: "object" }], open_questions: 0, overrides: { f1: "New breaker ordered" } };
  it("passes when every objection has a reason, nothing is open and the round ran on this layout", () => {
    expect(approveGate(base)).toEqual([]);
  });
  it("names each problem", () => {
    expect(approveGate({ ...base, overrides: {} })).toEqual([expect.stringMatching(/power/)]);
    expect(approveGate({ ...base, overrides: { f1: "   " } })).toEqual([expect.stringMatching(/power/)]);
    expect(approveGate({ ...base, findings: [{ id: "f2", agent: "cooling", verdict: "unavailable" }] })).toEqual([expect.stringMatching(/cooling/i)]);
    expect(approveGate({ ...base, open_questions: 1, latest: { layout_version: 4, outcome: "waiting" } })).toEqual([expect.stringMatching(/question/)]);
    expect(approveGate({ ...base, layout_version: 5 })).toEqual([expect.stringMatching(/layout changed/)]);
    expect(approveGate({ ...base, latest: { layout_version: 4, outcome: null } })).toEqual([expect.stringMatching(/still running/)]);
    expect(approveGate({ ...base, latest: null })).toEqual([expect.stringMatching(/not run/)]);
    expect(approveGate({ ...base, status: "approved" })).toEqual([expect.stringMatching(/already approved/)]);
  });
});

describe("POST /api/surveys/:id/approve", () => {
  it("stores the tech specs and override reasons and approves, once", async () => {
    const { id, ids } = await seed();
    const res = await approve(id, { tech_specs: "SM fibre LC/LC duplex; DC 2 × 6 mm²", overrides: { [ids.power]: "Power team adds a 16 A DC breaker before install" } });
    expect(res.status).toBe(200);
    expect(await status(id)).toBe("approved");
    const s = await q("SELECT tech_specs_json FROM surveys WHERE id = ?1", id).first<{ tech_specs_json: string }>();
    expect(JSON.parse(s!.tech_specs_json)).toEqual({ text: "SM fibre LC/LC duplex; DC 2 × 6 mm²" });
    expect(await q("SELECT override_reason FROM findings WHERE id = ?1", ids.power).first()).toEqual({ override_reason: "Power team adds a 16 A DC breaker before install" });
    expect((await approve(id, { overrides: { [ids.power]: "again" } })).status).toBe(409);
  });

  it("is 409 for an objection without a reason (AC 9)", async () => {
    const { id, ids } = await seed();
    const res = await approve(id, { overrides: { [ids.power]: "  " } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ problems: [expect.stringMatching(/power/i)] });
    expect(await status(id)).toBe("deliberating");
  });

  it("is 409 for an unanswered question (AC 9)", async () => {
    const { id, ids } = await seed({ outcome: "waiting", openQuestion: true });
    expect((await approve(id, { overrides: { [ids.power]: "ok" } })).status).toBe(409);
  });

  it("is 409 when the layout was edited after the last round (AC 9)", async () => {
    const { id, ids } = await seed({ roundVersion: 3 });
    expect((await approve(id, { overrides: { [ids.power]: "ok" } })).status).toBe(409);
  });

  it("regression: a round waits, the engineer edits the layout and answers, approve is still 409", async () => {
    const { id, ids } = await seed({ outcome: "waiting", openQuestion: true });
    const saved = await req(`/api/surveys/${id}/rooms/devices_hall/layout`, { method: "PUT", body: JSON.stringify({ layout_version: 4, items: [], facts: { spare_ac_btu: 6000 } }) });
    expect(saved.status).toBe(200);
    const qid = (await q("SELECT id FROM questions").first<{ id: string }>())!.id;
    await req(`/api/questions/${qid}/answer`, { method: "POST", body: JSON.stringify({ answer: "6000" }) });
    const res = await approve(id, { overrides: { [ids.power]: "ok" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ problems: expect.arrayContaining([expect.stringMatching(/layout changed|still running/)]) });
  });

  it("needs the passcode and a known survey", async () => {
    const { id } = await seed();
    expect((await req(`/api/surveys/${id}/approve`, { method: "POST", body: "{}", headers: { "X-Passcode": "wrong" } })).status).toBe(401);
    expect((await approve(crypto.randomUUID(), {})).status).toBe(404);
  });
});

describe("POST /api/surveys/:id/reopen", () => {
  it("takes an approved survey back to the meeting, and approving again issues fresh sign-off links", async () => {
    const { id, ids } = await seed();
    expect((await approve(id, { overrides: { [ids.power]: "ok" }, issue_links: true })).status).toBe(200);
    await q("UPDATE signoffs SET rep_name = 'Rep', decision = 'object', comment = 'feed from P2', decided_at = 'now' WHERE survey_id = ?1 AND agent = 'power'", id).run();
    const res = await req(`/api/surveys/${id}/reopen`, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(await status(id)).toBe("deliberating");
    expect(started.at(-1)).toMatch(new RegExp(`^${id}:\\d+:1$`)); // a new meeting run starts at round 1
    // The objection stays on record until the next approval, so the next meeting run reads it.
    expect(await q("SELECT decision FROM signoffs WHERE survey_id = ?1 AND agent = 'power'", id).first()).toEqual({ decision: "object" });
    const again = await approve(id, { overrides: { [ids.power]: "rerouted from P2" }, issue_links: true });
    expect(again.status).toBe(200);
    expect((await again.json<{ links: unknown[] }>()).links.length).toBeGreaterThan(0);
    expect(await q("SELECT decision FROM signoffs WHERE survey_id = ?1 AND agent = 'power'", id).first()).toEqual({ decision: null });
  });

  it("is 409 unless approved, refuses the public sample, and needs the passcode", async () => {
    const { id } = await seed();
    expect((await req(`/api/surveys/${id}/reopen`, { method: "POST", body: "{}" })).status).toBe(409);
    await q("UPDATE surveys SET status = 'approved', is_sample = 1 WHERE id = ?1", id).run();
    expect((await req(`/api/surveys/${id}/reopen`, { method: "POST", body: "{}" })).status).toBe(409);
    expect((await req(`/api/surveys/${id}/reopen`, { method: "POST", body: "{}", headers: { "X-Passcode": "wrong" } })).status).toBe(401);
  });
});
