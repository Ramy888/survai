// One meeting round: calculations on the current layout, the assigned departments in parallel, their findings and
// questions, then the Survey Lead. The round ends the meeting, waits for the engineer, or starts the next round.
import { type Agent } from "./agents/config";
import { BadModelAnswer, askJsonReply } from "./agents/json";
import { type LeadNote, leadPrompt, leadSchema } from "./agents/lead";
import { type MeetingInput, runAgent } from "./agents/runner";
import {
  type Breaker, type Calc, type CablePath, type Rect, cableLength, clearances, r3PowerSeparation, r6DoorSwing, r8FreeU, r10Cooling, r11Breakers, rackSpots,
} from "./calc";
import { BudgetExceeded, ModelError, type createModels } from "./clients/models";
import type { StepRunner } from "./processing";

export const MAX_ROUNDS = 3;
export type { StartRound } from "./types";
import type { StartRound } from "./types";
interface Deps { env: Env; models: ReturnType<typeof createModels>; step: StepRunner; startRound: StartRound }
type Item = MeetingInput["rooms"][number]["items"][number];
type Outcome = "next" | "waiting" | "done";

const STEP = { retries: { limit: 1, delay: "5 seconds" as const } };
const FRAME_OFFSET: Record<string, number> = { devices_hall: 0, connect_to: 100 }; // connect-to frames are F101...

/** Frame numbers as the agents see them (F1... per room, connect-to from F101), from key frames in upload order. */
export function numberFrames(frames: { id: string; role: string }[]) {
  const counters: Record<string, number> = {};
  return frames.map((f) => ({ n: (FRAME_OFFSET[f.role] ?? 0) + (counters[f.role] = (counters[f.role] ?? 0) + 1), fileId: f.id }));
}

async function loadMeeting(db: D1Database, surveyId: string, run: number, round: number) {
  const s = await db.prepare("SELECT quantity, device_model, layout_version, request_json FROM surveys WHERE id = ?1").bind(surveyId)
    .first<{ quantity: number; device_model: string; layout_version: number; request_json: string | null }>();
  if (!s) throw new Error(`survey ${surveyId} not found`);
  const [d, reps, rooms, items, frames, prev, lead, answers, signed] = await Promise.all([
    db.prepare("SELECT height_u, power_w, feed_type, feed_count, breaker_rating_a, interfaces, transceivers, connectors FROM device_specs WHERE survey_id = ?1").bind(surveyId)
      .first<{ height_u: number; power_w: number; feed_type: "AC" | "DC"; feed_count: number; breaker_rating_a: number | null; interfaces: string | null; transceivers: string | null; connectors: string | null }>(),
    db.prepare("SELECT agent FROM survey_reps WHERE survey_id = ?1 ORDER BY agent").bind(surveyId).all<{ agent: Agent }>(),
    db.prepare("SELECT id, role, facts_json FROM rooms WHERE survey_id = ?1 ORDER BY role DESC").bind(surveyId).all<{ id: string; role: string; facts_json: string | null }>(),
    db.prepare("SELECT li.id, li.room_id, li.kind, li.label, li.x_tiles, li.y_tiles, li.w_tiles, li.d_tiles, li.facing, li.props_json, li.source FROM layout_items li JOIN rooms r ON r.id = li.room_id WHERE r.survey_id = ?1")
      .bind(surveyId).all<{ id: string; room_id: string; kind: string; label: string | null; x_tiles: number; y_tiles: number; w_tiles: number | null; d_tiles: number | null; facing: string | null; props_json: string | null; source: string }>(),
    db.prepare("SELECT f.id, r.role FROM files f JOIN rooms r ON r.id = f.room_id WHERE r.survey_id = ?1 AND f.kind = 'key_frame' ORDER BY f.created_at").bind(surveyId).all<{ id: string; role: string }>(),
    round > 1
      ? db.prepare("SELECT agent, verdict, body_json FROM findings WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(surveyId, run, round - 1).all<{ agent: string; verdict: string; body_json: string }>()
      : db.prepare("SELECT agent, verdict, body_json FROM findings WHERE survey_id = ?1 AND round = 0").bind(surveyId).all<{ agent: string; verdict: string; body_json: string }>(),
    db.prepare("SELECT body_json FROM lead_notes WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(surveyId, run, round - 1).first<{ body_json: string }>(),
    db.prepare("SELECT q.text, q.answer FROM questions q JOIN findings f ON f.id = q.finding_id WHERE f.survey_id = ?1 AND q.answer IS NOT NULL").bind(surveyId).all<{ text: string; answer: string }>(),
    // A department representative's sign-off (from their link, in their office) goes into the next run of the meeting.
    db.prepare("SELECT agent, rep_name, decision, comment FROM signoffs WHERE survey_id = ?1 AND decision IS NOT NULL ORDER BY agent").bind(surveyId)
      .all<{ agent: string; rep_name: string | null; decision: string; comment: string | null }>(),
  ]);
  if (!d) throw new Error(`survey ${surveyId} has no confirmed device`);
  const frameList = numberFrames(frames.results);
  const leadNote = lead ? (JSON.parse(lead.body_json) as LeadNote) : null;
  const input: MeetingInput = {
    round,
    quantity: s.quantity,
    device: { model: s.device_model, ...d },
    request: s.request_json ? JSON.parse(s.request_json) : null,
    rooms: rooms.results.map((r) => {
      const facts = r.facts_json ? JSON.parse(r.facts_json) : {};
      const { sam: _sam, breakers_draft: _draft, observations = [], size_tiles = null, ...rest } = facts;
      return {
        role: r.role,
        size_tiles,
        facts: rest,
        observations: (observations as { rule: string; text: string; frames: number[] }[]).map((o) => ({ ...o, frames: o.frames.map((n) => n + (FRAME_OFFSET[r.role] ?? 0)) })),
        items: items.results.filter((i) => i.room_id === r.id).map((i): Item => ({
          id: i.id, kind: i.kind, label: i.label, x: i.x_tiles, y: i.y_tiles, w: i.w_tiles, d: i.d_tiles, facing: i.facing,
          props: { ...(i.props_json ? JSON.parse(i.props_json) : {}), source: i.source },
        })),
      };
    }),
    frames: frameList,
    calcs: [],
    previous: prev.results.map((p) => ({ agent: p.agent, verdict: p.verdict, statement: String(JSON.parse(p.body_json).statement ?? "") })),
    lead: leadNote && { conflicts: leadNote.conflicts, summary: leadNote.summary },
    answers: [
      ...answers.results.map((a) => ({ question: a.text, answer: a.answer })),
      ...signed.results.map((r) => ({ question: `Sign-off by the ${r.agent.replace("_", " ")} department's representative${r.rep_name ? ` (${r.rep_name})` : ""}`,
        answer: `${r.decision}${r.comment ? `: ${r.comment}` : ""}` })),
    ],
  };
  return { input, reps: reps.results.map((r) => r.agent), layoutVersion: s.layout_version, roomIds: Object.fromEntries(rooms.results.map((r) => [r.role, r.id])) };
}

type Side = "north" | "south" | "east" | "west";
/** A door swings into the room: away from the wall it sits on (the nearest one). */
export function swingSide(door: Rect, size: { w: number; d: number } | null): Side {
  if (!size) return "south"; // the door wall is y = 0 by convention
  const walls: [number, Side][] = [[door.y, "south"], [size.d - (door.y + door.d), "north"], [door.x, "east"], [size.w - (door.x + door.w), "west"]];
  return walls.reduce((m, w) => (w[0] < m[0] ? w : m))[1];
}

const rect = (i: Item): Rect => ({ label: i.label ?? i.kind, x: i.x, y: i.y, w: i.w ?? 1, d: i.d ?? 1 });

/** Every calculation for the current layout (pure; ids are added by the caller). */
export function computeCalcs(input: MeetingInput): Calc[] {
  const out: Calc[] = [];
  const hall = input.rooms.find((r) => r.role === "devices_hall");
  const f = (hall?.facts ?? {}) as Record<string, unknown>;
  const target = hall?.items.find((i) => i.kind === "rack" && i.props.is_target);
  const reserved = hall?.items.filter((i) => i.kind === "reserved") ?? [];
  const rack = target
    ? { label: target.label ?? "target", free_blocks: (target.props.free_blocks as { from_u: number; to_u: number }[]) ?? [] }
    : reserved[0] ? { label: reserved[0].label ?? "new rack", free_blocks: [{ from_u: 1, to_u: Number(reserved[0].props.height_u ?? 42) }] } : null;
  out.push(r8FreeU({ height_u: input.device.height_u, quantity: input.quantity, rack }));
  out.push(r10Cooling({ power_w: input.device.power_w, quantity: input.quantity, spare_ac_btu: (f.spare_ac_btu as number | null) ?? null, room_tiles: hall?.size_tiles ?? null }));
  out.push(r11Breakers({
    feed_type: input.device.feed_type, feed_count: input.device.feed_count, quantity: input.quantity, breaker_rating_a: input.device.breaker_rating_a,
    breakers: Array.isArray(f.breakers_confirmed) ? (f.breakers_confirmed as Breaker[]) : null,
  }));
  for (const room of input.rooms) {
    const facts = room.facts as Record<string, unknown>;
    for (const door of room.items.filter((i) => i.kind === "door")) {
      const side = (door.props.side as Side | null) ?? swingSide(rect(door), room.size_tiles);
      out.push(r6DoorSwing({ door: { ...rect(door), swing_m: door.props.swing_m as number | undefined, side }, items: room.items.map((i) => ({ ...rect(i), kind: i.kind })) }));
    }
    const paths: CablePath[] = room.items.filter((i) => i.kind === "cable_path").map((i) => ({
      label: i.label ?? String(i.props.cable_type), cable_type: i.props.cable_type as CablePath["cable_type"], route: i.props.route as CablePath["route"], points: i.props.points as [number, number][],
    }));
    if (paths.length) out.push(r3PowerSeparation(paths));
    for (const [k, p] of paths.entries()) {
      const item = room.items.filter((i) => i.kind === "cable_path")[k];
      const other = input.rooms.find((r) => r.role === "connect_to")?.facts as Record<string, unknown> | undefined;
      const interRoom = item.props.leaves_room ? ((facts.inter_room_m ?? other?.inter_room_m) as number | null) ?? null : 0;
      const len = interRoom === null
        ? { length_m: null, run_m: null, drops_m: null, missing: ["inter_room_m"] } // leaving the room with an unknown distance is not 0 m
        : cableLength({ points: p.points, route: p.route, ladder_height_m: (facts.ladder_height_m as number | null) ?? null, rack_top_m: Number(target?.props.top_height_m ?? 2.0), inter_room_m: interRoom });
      out.push({ rule: "LEN", inputs: { path: p.label, cable_type: p.cable_type, route: p.route }, result: len, pass: len.length_m === null ? null : true });
    }
    const size = room.size_tiles;
    // Where a new 80 x 80 cm rack fits without blocking a door or an aisle: facts for Space and the Lead's placement.
    if (size) out.push({ rule: "SPOT", inputs: { size_m: 0.8 }, pass: true, result: { spots: rackSpots({ room: size, items: room.items.map((i) => ({ ...rect(i), kind: i.kind, facing: i.facing })) }) } });
    if (size) {
      for (const r of room.items.filter((i) => i.kind === "reserved")) {
        const door = room.items.find((i) => i.kind === "door");
        out.push({ rule: "CLR", inputs: { reserved: r.label }, pass: true, result: { arrows: clearances({ reserved: rect(r), room: size, racks: room.items.filter((i) => i.kind === "rack").map(rect), door: door ? rect(door) : null }) } });
      }
    }
  }
  return out;
}

export async function runRound({ env, models, step, startRound }: Deps, surveyId: string, run: number, round: number): Promise<{ outcome: Outcome; round: number }> {
  const db = env.DB;
  const existing = await step.do(`check round ${round}`, STEP, async () =>
    db.prepare("SELECT outcome FROM lead_notes WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(surveyId, run, round).first<{ outcome: Outcome }>());
  if (existing) return { outcome: existing.outcome, round };

  const m = await step.do("load", STEP, () => loadMeeting(db, surveyId, run, round));
  const calcs = await step.do("calculations", STEP, async () => {
    const withIds = computeCalcs(m.input).map((c) => ({ ...c, id: crypto.randomUUID() }));
    await db.batch([
      db.prepare("DELETE FROM calcs WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(surveyId, run, round),
      ...withIds.map((c) => db.prepare("INSERT INTO calcs (id, survey_id, run, round, rule, inputs_json, result_json, pass) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(c.id, surveyId, run, round, c.rule, JSON.stringify(c.inputs), JSON.stringify(c.result), c.pass === null ? -1 : Number(c.pass))),
    ]);
    return withIds;
  });
  const input = { ...m.input, calcs };
  const findings = await Promise.all(m.reps.map((agent) => step.do(`agent ${agent}`, STEP, () => runAgent(models, agent, input, { survey: surveyId }))));

  await step.do("store findings", STEP, async () => {
    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [
      db.prepare("DELETE FROM questions WHERE finding_id IN (SELECT id FROM findings WHERE survey_id = ?1 AND run = ?2 AND round = ?3)").bind(surveyId, run, round),
      db.prepare("DELETE FROM findings WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(surveyId, run, round),
    ];
    for (const f of findings) {
      const id = crypto.randomUUID();
      stmts.push(db.prepare("INSERT INTO findings (id, survey_id, run, round, agent, verdict, body_json, layout_version, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
        .bind(id, surveyId, run, round, f.agent, f.verdict, JSON.stringify(f), m.layoutVersion, now));
      if (f.question) {
        stmts.push(db.prepare("INSERT INTO questions (id, finding_id, text, answer_kind, target_item_id, target_fact) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
          .bind(crypto.randomUUID(), id, f.question.text, f.question.answer_kind, f.question.target_item_id, f.question.target_fact));
      }
    }
    await db.batch(stmts);
  });

  const hall = input.rooms.find((r) => r.role === "devices_hall");
  const lead = await step.do("lead", STEP, async () => {
    const racks = (hall?.items ?? []).filter((i) => i.kind === "rack").map((i) => i.label ?? "");
    // Each door with its swing (from the R6 calculation), so a cable path the Lead draws through one is sent back.
    const doorZones = (hall?.items ?? []).filter((i) => i.kind === "door").map((d) => {
      const z = calcs.find((c) => c.rule === "R6" && c.inputs.door === d.label)?.result.zone as { x0: number; x1: number; y0: number; y1: number } | undefined;
      const [w, dd] = [d.w ?? 1.5, d.d ?? 0.2];
      return { label: d.label ?? "door", x0: Math.min(d.x, z?.x0 ?? d.x), x1: Math.max(d.x + w, z?.x1 ?? d.x + w), y0: Math.min(d.y, z?.y0 ?? d.y), y1: Math.max(d.y + dd, z?.y1 ?? d.y + dd) };
    });
    try {
      const r = await askJsonReply(models, "lead", { text: leadPrompt({
        round, final: round >= MAX_ROUNDS, device: input.device, answers: input.answers, quantity: input.quantity, items: hall?.items ?? [], calcs,
        findings: findings.map((f) => ({ agent: f.agent, verdict: f.verdict, statement: f.statement, rule_refs: f.rule_refs, question: f.question })),
      }) }, leadSchema(racks, round >= MAX_ROUNDS, doorZones), "lead note", { survey: surveyId, round, agent: "lead" });
      return { note: r.value as LeadNote, model: r.model as string, fellBack: r.fellBack };
    } catch (err) {
      if (err instanceof BudgetExceeded || !(err instanceof ModelError || err instanceof BadModelAnswer)) throw err;
      console.log(JSON.stringify({ evt: "lead_unavailable", reason: err.constructor.name, message: err.message, survey: surveyId, run, round }));
      const note: LeadNote = { round, placement: { target: "none", reason: "The Survey Lead was unavailable this round." }, propose_items: [], conflicts: [], summary: "The Survey Lead was unavailable this round.", next: "another_round" };
      return { note, model: "unavailable", fellBack: false };
    }
  });

  const outcome = await step.do("store lead", STEP, async () => {
    const result: Outcome = lead.note.next === "done" || round >= MAX_ROUNDS ? "done" : "next";
    const hallId = m.roomIds.devices_hall;
    // The Lead's items of a kind it proposes again are replaced (kinds it does not mention stay); they never bump
    // layout_version, so calculations simply rerun next round.
    // An approved survey's layout is what the report draws, so a replay rerun's Lead never changes it.
    const kinds = [...new Set(lead.note.propose_items.map((p) => p.kind))];
    const open = "(SELECT status FROM surveys WHERE id = ?3) <> 'approved'";
    // Numbered within the cable type, so a path keeps its label (and its LEN calculation) whatever order the Lead lists it in.
    const label = (p: (typeof lead.note.propose_items)[number], k: number) => p.kind === "reserved" ? "NEW"
      : `${p.props.cable_type}-${lead.note.propose_items.slice(0, k + 1).filter((q) => q.kind === "cable_path" && q.props.cable_type === p.props.cable_type).length}`;
    await db.batch([
      ...kinds.map((k) => db.prepare(`DELETE FROM layout_items WHERE room_id = ?1 AND source = 'lead' AND kind = ?2 AND ${open}`).bind(hallId, k, surveyId)),
      ...lead.note.propose_items.map((p, k) => db.prepare(
        `INSERT INTO layout_items (id, room_id, kind, label, x_tiles, y_tiles, w_tiles, d_tiles, props_json, source)
          SELECT ?1, ?2, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'lead' WHERE ${open}`,
      ).bind(crypto.randomUUID(), hallId, surveyId, p.kind, label(p, k), p.x_tiles, p.y_tiles, p.w_tiles ?? null, p.d_tiles ?? null, JSON.stringify(p.props))),
      // Open questions are checked in the same write that stores the outcome, so an answer arriving mid-round is
      // either seen here or flips this note from 'waiting' itself (routes/answer.ts); it is never lost between the two.
      // A replay rerun of an approved survey has no engineer to answer (routes/answer.ts refuses), so it never waits.
      db.prepare(`INSERT OR IGNORE INTO lead_notes (survey_id, run, round, body_json, model, fell_back, outcome, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN (SELECT status FROM surveys WHERE id = ?1) <> 'approved' AND EXISTS (SELECT 1 FROM questions q JOIN findings f ON f.id = q.finding_id
          WHERE f.survey_id = ?1 AND f.run = ?2 AND f.round = ?3 AND q.answer IS NULL) THEN 'waiting' ELSE ?7 END, ?8`)
        .bind(surveyId, run, round, JSON.stringify(lead.note), lead.model, Number(lead.fellBack), result, new Date().toISOString()),
      db.prepare("UPDATE surveys SET deliberated_layout_version = ?1 WHERE id = ?2").bind(m.layoutVersion, surveyId),
    ]);
    return (await db.prepare("SELECT outcome FROM lead_notes WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(surveyId, run, round).first<{ outcome: Outcome }>())!.outcome;
  });
  if (outcome === "next") await step.do("start next round", STEP, async () => { await startRound(env, surveyId, run, round + 1); });
  return { outcome, round };
}
