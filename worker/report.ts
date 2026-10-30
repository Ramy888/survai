// The survey report: the company's survey form mirrored from stored data (latest run, last round), plus the
// floor-plan data. The report is a template over stored data; the Lead writes only its summary.
import { RULES } from "./agents/config";
import { heatLoad } from "./calc";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CABLE_WORDS: Record<string, RegExp> = { fibre: /fib(re|er)|single.?mode|\bsm\b/i, data: /data|ethernet|utp|copper|patch/i, power: /power|\bdc\b|\bac\b|feed/i };
const sum = (xs: (number | null)[]) => (xs.some((x) => x == null) || !xs.length ? null : xs.reduce((a, b) => a! + b!, 0));

export async function buildReport(db: D1Database, surveyId: string) {
  const s = await db.prepare("SELECT * FROM surveys WHERE id = ?1").bind(surveyId).first<Record<string, any>>();
  if (!s) return null;
  // An approved survey reports the run the engineer approved, even if a replay rerun added a newer one.
  const last = await db.prepare("SELECT run, round, body_json, model, fell_back FROM lead_notes WHERE survey_id = ?1 AND (?2 IS NULL OR run = ?2) ORDER BY run DESC, round DESC LIMIT 1")
    .bind(surveyId, s.approved_run ?? null).first<{ run: number; round: number; body_json: string; model: string; fell_back: number }>();
  const [device, rooms, items, findings, calcs, signoffs] = await Promise.all([
    db.prepare("SELECT * FROM device_specs WHERE survey_id = ?1").bind(surveyId).first<Record<string, any>>(),
    db.prepare("SELECT id, role, name, facts_json FROM rooms WHERE survey_id = ?1 ORDER BY role DESC").bind(surveyId).all<{ id: string; role: string; name: string; facts_json: string | null }>(),
    db.prepare("SELECT li.* FROM layout_items li JOIN rooms r ON r.id = li.room_id WHERE r.survey_id = ?1").bind(surveyId).all<Record<string, any>>(),
    last
      ? db.prepare("SELECT agent, verdict, body_json, override_reason FROM findings WHERE survey_id = ?1 AND run = ?2 AND round = ?3 ORDER BY agent").bind(surveyId, last.run, last.round).all<{ agent: string; verdict: string; body_json: string; override_reason: string | null }>()
      : { results: [] as { agent: string; verdict: string; body_json: string; override_reason: string | null }[] },
    last
      ? db.prepare("SELECT rule, inputs_json, result_json, pass FROM calcs WHERE survey_id = ?1 AND run = ?2 AND round = ?3").bind(surveyId, last.run, last.round).all<{ rule: string; inputs_json: string; result_json: string; pass: number }>()
      : { results: [] as { rule: string; inputs_json: string; result_json: string; pass: number }[] },
    db.prepare("SELECT agent, rep_name, decision, comment, decided_at FROM signoffs WHERE survey_id = ?1 AND decision IS NOT NULL ORDER BY agent").bind(surveyId).all(),
  ]);
  const roomFacts = Object.fromEntries(rooms.results.map((r) => [r.role, r.facts_json ? JSON.parse(r.facts_json) : {}]));
  const hallId = rooms.results.find((r) => r.role === "devices_hall")?.id;
  const planItems = (roomId: string | undefined) => items.results.filter((i) => i.room_id === roomId).map((i) => ({
    id: i.id, kind: i.kind, label: i.label, x: i.x_tiles, y: i.y_tiles, w: i.w_tiles, d: i.d_tiles, facing: i.facing, props: i.props_json ? JSON.parse(i.props_json) : {}, source: i.source,
  }));
  const hallItems = planItems(hallId);
  const bodies = findings.results.map((f) => ({ ...f, body: JSON.parse(f.body_json) }));
  const allItems = bodies.flatMap((f) => (f.body.items ?? []).map((it: Record<string, unknown>) => ({ ...it, agent: f.agent })));
  // A length the plan cannot measure (a run to another room) comes from the engineer's narration, else from what
  // Execution measured for that cable type; the report says which.
  const said = s.request_json ? JSON.parse(s.request_json).cable_length_m : null;
  const measured = (type: string) => allItems.find((i) => i.agent === "execution" && typeof i.quantity === "number" && /^m(et(er|re)s?)?$/i.test(String(i.unit ?? ""))
    && CABLE_WORDS[type]?.test(String(i.text)))?.quantity as number | undefined;
  const lens = calcs.results.filter((c) => c.rule === "LEN").map((c) => {
    const l = { ...JSON.parse(c.inputs_json), ...JSON.parse(c.result_json) };
    if (l.length_m != null) return { ...l, source: "calc" };
    if (typeof said === "number" && l.cable_type !== "power") return { ...l, length_m: said, source: "narration" };
    const m = measured(l.cable_type);
    return m != null ? { ...l, length_m: m, source: "execution" } : { ...l, length_m: null, source: null };
  });
  const lengthOf = (pred: (l: Record<string, any>) => boolean) => sum(lens.filter(pred).map((l) => l.length_m ?? null));
  const pathItem = (label: string) => hallItems.find((i) => i.kind === "cable_path" && i.label === label);
  const target = hallItems.find((i) => i.props.is_target) ?? hallItems.find((i) => i.kind === "reserved");
  const reserved = hallItems.find((i) => i.kind === "reserved");
  const cited = [...new Set(bodies.flatMap((f) => f.body.rule_refs ?? []))].sort((a, b) => Number(String(a).slice(1)) - Number(String(b).slice(1)));
  const hall = roomFacts.devices_hall ?? {};
  const created = new Date(s.created_at);
  const lead = last && JSON.parse(last.body_json);

  return {
    header: {
      site: s.site, project: s.project, devices: `${s.quantity} × ${s.device_model}`, date: s.created_at.slice(0, 10), day: DAYS[created.getUTCDay()],
      status: s.status, problem: s.request_json ? (JSON.parse(s.request_json).translation_en ?? null) : null,
    },
    devices_hall: {
      floor: hall.floor ?? null,
      floor_type: "Raised floor, 600 mm tiles",
      model: s.device_model,
      space_for_new_rack_cm: reserved ? `${Math.round((reserved.w ?? 1) * 60)} × ${Math.round((reserved.d ?? 1.7) * 60)}` : null,
      patch_cord_m: lengthOf((l) => l.cable_type !== "power" && !pathItem(l.path)?.props.leaves_room),
      interconnect_m: lengthOf((l) => l.cable_type !== "power" && !!pathItem(l.path)?.props.leaves_room),
      ladder_m: sum(lens.filter((l) => l.route === "overhead").map((l) => l.run_m ?? null)),
      duct_m: sum(lens.filter((l) => l.route === "underfloor").map((l) => l.run_m ?? null)),
      notes: hall.inventory_notes ?? null,
    },
    connect_to: roomFacts.connect_to ? { floor: roomFacts.connect_to.floor ?? null, floor_type: "Raised floor, 600 mm tiles", space_in_existing_rack: null, ladder_m: null, notes: roomFacts.connect_to.inventory_notes ?? null } : null,
    power: {
      required_feeds: device ? `${device.feed_count * s.quantity} × ${device.feed_type}${device.breaker_rating_a ? `, ${device.breaker_rating_a} A breakers` : ""}` : null,
      sources: device?.feed_count ?? null,
      panel: hallItems.find((i) => i.kind === "panel")?.label ?? null,
      power_cable_m: lengthOf((l) => l.cable_type === "power"),
      notes: null,
    },
    cooling: {
      heat_load_btu: device ? heatLoad(device.power_w, s.quantity) : null,
      ac_units: hall.ac_count ?? null,
      ac_condition: hall.ac_condition ?? null,
      orientation_and_place: target ? `${target.label ?? target.kind}${target.facing ? `, facing ${target.facing}` : ""}` : null,
      notes: hall.spare_ac_btu != null ? `Spare A/C capacity ${hall.spare_ac_btu} BTU/h` : null,
    },
    statements: bodies.map((f) => ({ agent: f.agent, verdict: f.verdict, statement: f.body.statement, rule_refs: f.body.rule_refs, model: f.body.model, evidence: f.body.evidence })),
    approved_items: allItems.filter((i) => i.kind === "approved").map((i) => ({ text: String(i.text), agent: i.agent })),
    specs: allItems.filter((i) => i.kind !== "approved").map((i) => ({ kind: i.kind, text: i.text, quantity: i.quantity ?? null, unit: i.unit ?? null, agent: i.agent })),
    rules: cited.map((r) => ({ rule: r, text: RULES[r]?.text ?? "" })),
    cable_lengths: lens.map((l) => ({ path: l.path, cable_type: l.cable_type, route: l.route, length_m: l.length_m ?? null, source: l.source })),
    objections: bodies.filter((f) => f.verdict === "object" || f.verdict === "unavailable").map((f) => ({ agent: f.agent, rules: f.body.rule_refs, override_reason: f.override_reason })),
    lead: lead && { placement: lead.placement, summary: lead.summary, conflicts: lead.conflicts, next: lead.next ?? null, model: last!.model, fell_back: last!.fell_back === 1 },
    tech_specs: s.tech_specs_json ? JSON.parse(s.tech_specs_json) : null,
    signoffs: signoffs.results,
    meeting: last ? { run: last.run, round: last.round, layout_version: s.layout_version, deliberated_layout_version: s.deliberated_layout_version } : null,
    plan: {
      size: hall.size_tiles ?? null,
      items: hallItems,
      lengths: Object.fromEntries(lens.map((l) => [l.path, l.length_m ?? null])),
      clearances: calcs.results.filter((c) => c.rule === "CLR").flatMap((c) => JSON.parse(c.result_json).arrows ?? []),
    },
  };
}
