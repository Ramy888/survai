// protects: answering the meeting's questions (AC 8) and the timeline the meeting screen polls; fails_when: an
// answer is accepted twice, the next round starts before the last open question is answered or starts twice, a
// "yes" to the R7 question does not mark the rack off limits, a number answer is not written to the room facts, a
// round past 3 starts, an earlier round's question restarts the meeting, or the timeline loses rule text, the
// Lead's fallback or frame numbers; no_claim: the screen (checked in the browser).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../worker/index";

const started: string[] = [];
const app = createApp({ startRound: async (_e, id, run, round) => void started.push(`${id}:${run}:${round}`) });
const req = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { "Content-Type": "application/json", "X-Passcode": env.DEMO_PASSCODE, "CF-Connecting-IP": "203.0.113.60", ...init.headers } }, env);
const answer = (qid: string, value: string) => req(`/api/questions/${qid}/answer`, { method: "POST", body: JSON.stringify({ answer: value }) });
const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
const one = <T>(sql: string, ...a: unknown[]) => q(sql, ...a).first<T>();

type Ask = { agent: string; text: string; kind: "yes_no" | "number" | "text"; item?: string; fact?: string };

/** A survey whose run 1 round `round` ended waiting on `asks`. */
async function seed(asks: Ask[], round = 1, status = "deliberating") {
  const id = crypto.randomUUID();
  const hall = crypto.randomUUID();
  const r5 = crypto.randomUUID();
  const stmts = [
    q("INSERT INTO surveys (id, site, project, device_model, quantity, connects_to, status, layout_version, deliberated_layout_version, created_at) VALUES (?1, 'S', 'P', 'M', 1, 'same_room', ?2, 2, 2, 'now')", id, status),
    q("INSERT INTO survey_reps (survey_id, agent) VALUES (?1, 'room_manager'), (?1, 'cooling')", id),
    q("INSERT INTO rooms (id, survey_id, role, name, facts_json) VALUES (?1, ?2, 'devices_hall', 'Devices hall', ?3)", hall, id, JSON.stringify({ ladder_height_m: 2.6 })),
    q("INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, props_json, source) VALUES (?1, ?2, 'rack', 'R5', 1, 1, '{\"height_u\":42}', 'ai')", r5, hall),
    ...[1, 2].map((n) => q("INSERT INTO files (id, room_id, kind, r2_key, created_at) VALUES (?1, ?2, 'key_frame', 'k', ?3)", `${id}_f${n}`, hall, `2026-10-27T00:00:0${n}Z`)),
    q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, fell_back, outcome, created_at) VALUES (?1, 1, ?2, ?3, 'muse-spark-1.3', 1, 'waiting', 'now')",
      id, round, JSON.stringify({ round, placement: { target: "rack:R5", reason: "fits" }, propose_items: [], conflicts: [], summary: "Answer the questions.", next: "another_round" })),
  ];
  const qids: string[] = [];
  for (const a of asks) {
    const fid = crypto.randomUUID();
    const qid = crypto.randomUUID();
    qids.push(qid);
    const body = { agent: a.agent, verdict: "question", statement: `${a.agent} asks`, rule_refs: a.agent === "room_manager" ? ["R7"] : [], forced_rules: [], evidence: [{ frame_id: `${id}_f2` }], model: "muse-spark-open", question: null };
    stmts.push(q("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, 1, ?3, ?4, 'question', ?5, 2, 'now')", fid, id, round, a.agent, JSON.stringify(body)));
    stmts.push(q("INSERT INTO questions (id, finding_id, text, answer_kind, target_item_id, target_fact) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", qid, fid, a.text, a.kind, a.item === "R5" ? r5 : a.item ?? null, a.fact ?? null));
  }
  await env.DB.batch(stmts);
  return { id, hall, r5, qids };
}

const r7: Ask = { agent: "room_manager", text: "Does rack R5 hold access devices?", kind: "yes_no", item: "R5" };
const btu: Ask = { agent: "cooling", text: "What is the spare A/C capacity in BTU/h?", kind: "number", fact: "spare_ac_btu" };
const facts = async (hall: string) => JSON.parse((await one<{ facts_json: string }>("SELECT facts_json FROM rooms WHERE id = ?1", hall))!.facts_json);

beforeEach(async () => {
  started.length = 0;
  for (const t of ["surveys", "survey_reps", "rooms", "layout_items", "files", "findings", "questions", "lead_notes", "calcs", "passcode_failures"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("POST /api/questions/:id/answer", () => {
  it("marks the rack off limits on a yes to the R7 question, writes a number fact, and starts the next round on the last answer (AC 8)", async () => {
    const { id, hall, r5, qids } = await seed([r7, btu]);
    expect((await answer(qids[0], "yes")).status).toBe(200);
    expect(started).toEqual([]); // one question still open
    const props = JSON.parse((await one<{ props_json: string }>("SELECT props_json FROM layout_items WHERE id = ?1", r5))!.props_json);
    expect(props).toMatchObject({ off_limits: true, height_u: 42 });
    expect(await (await answer(qids[1], "6000")).json()).toMatchObject({ next_round: 2 });
    expect(await facts(hall)).toEqual({ ladder_height_m: 2.6, spare_ac_btu: 6000 });
    expect(started).toEqual([`${id}:1:2`]);
    expect(await one("SELECT outcome FROM lead_notes WHERE survey_id = ?1 AND round = 1", id)).toEqual({ outcome: "next" });
    const s = await one<{ layout_version: number }>("SELECT layout_version FROM surveys WHERE id = ?1", id);
    expect(s!.layout_version).toBe(2); // answers never bump the layout version (the approve gate depends on it)
  });

  it("refuses a second answer, so the last answer arriving twice starts one round", async () => {
    const { id, qids } = await seed([r7]);
    expect((await answer(qids[0], "no")).status).toBe(200);
    expect((await answer(qids[0], "yes")).status).toBe(409);
    expect(started).toEqual([`${id}:1:2`]);
  });

  it("validates the answer against its kind and the fact against the whitelist", async () => {
    const { qids, hall } = await seed([r7, btu, { agent: "space", text: "Odd?", kind: "number", fact: "layout_version" }]);
    expect((await answer(qids[0], "maybe")).status).toBe(400);
    expect((await answer(qids[1], "-5")).status).toBe(400);
    expect((await answer(qids[1], "lots")).status).toBe(400);
    expect((await answer(qids[2], "7")).status).toBe(200); // stored as an answer, never written as a fact
    expect(await facts(hall)).toEqual({ ladder_height_m: 2.6 });
  });

  it("stores a text answer without touching the layout", async () => {
    const { hall, qids } = await seed([{ agent: "cooling", text: "Which breakers are free?", kind: "text", fact: "breakers_confirmed" }]);
    expect((await answer(qids[0], "3 and 4, both 16 A DC")).status).toBe(200);
    expect(await facts(hall)).toEqual({ ladder_height_m: 2.6 });
    expect(await one("SELECT answer FROM questions WHERE id = ?1", qids[0])).toEqual({ answer: "3 and 4, both 16 A DC" });
  });

  it("ends the meeting instead of starting a fourth round", async () => {
    const { id, qids } = await seed([r7], 3);
    expect(await (await answer(qids[0], "yes")).json()).toMatchObject({ next_round: null });
    expect(started).toEqual([]);
    expect(await one("SELECT outcome FROM lead_notes WHERE survey_id = ?1 AND round = 3", id)).toEqual({ outcome: "done" });
  });

  it("refuses an earlier round's question, unknown questions and answers outside the meeting", async () => {
    const { id, qids } = await seed([r7]);
    await q("INSERT INTO lead_notes (survey_id, run, round, body_json, model, outcome, created_at) VALUES (?1, 2, 1, '{}', 'm', 'done', 'now')", id).run();
    expect((await answer(qids[0], "yes")).status).toBe(409);
    expect((await answer(crypto.randomUUID(), "yes")).status).toBe(404);
    const other = await seed([r7], 1, "approved");
    expect((await answer(other.qids[0], "yes")).status).toBe(409);
    expect(started).toEqual([]);
  });

  it("needs the passcode", async () => {
    const { qids } = await seed([r7]);
    expect((await req(`/api/questions/${qids[0]}/answer`, { method: "POST", body: JSON.stringify({ answer: "yes" }), headers: { "X-Passcode": "wrong" } })).status).toBe(401);
    expect(await one("SELECT answer FROM questions WHERE id = ?1", qids[0])).toEqual({ answer: null });
  });
});

describe("GET /api/surveys/:id/timeline", () => {
  it("returns each round's findings with rule text and frame numbers, questions, and the Lead's fallback (AC 13)", async () => {
    const { id, qids } = await seed([r7]);
    const t = await (await req(`/api/surveys/${id}/timeline`)).json<Record<string, any>>();
    expect(t).toMatchObject({ status: "deliberating", run: 1, reps: ["cooling", "room_manager"], layout_version: 2, deliberated_layout_version: 2 });
    expect(t.rounds).toHaveLength(1);
    const [r] = t.rounds;
    expect(r.lead).toMatchObject({ outcome: "waiting", fell_back: true, model: "muse-spark-1.3", summary: "Answer the questions." });
    expect(r.findings[0]).toMatchObject({
      agent: "room_manager", verdict: "question", rules: [{ id: "R7", text: expect.stringMatching(/Off-limits racks/) }],
      evidence: [{ frame: 2, file_id: `${id}_f2` }], question: { id: qids[0], text: r7.text, answer_kind: "yes_no", answer: null }, items: [],
    });
  });

  it("is 404 for an unknown survey", async () => {
    expect((await req(`/api/surveys/${crypto.randomUUID()}/timeline`)).status).toBe(404);
  });
});

describe("GET /api/surveys/:id/files/:fileId", () => {
  it("serves a frame of this survey only", async () => {
    const a = await seed([]);
    const b = await seed([]);
    await env.MEDIA.put("k", new Uint8Array([0xff, 0xd8, 0xff, 1]), { httpMetadata: { contentType: "image/jpeg" } });
    const ok = await req(`/api/surveys/${a.id}/files/${a.id}_f1`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await req(`/api/surveys/${b.id}/files/${a.id}_f1`)).status).toBe(404);
  });
});
