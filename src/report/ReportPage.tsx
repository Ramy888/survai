import { useEffect, useState } from "react";
import { modelName } from "../components/Footage";
import { FloorPlan } from "./FloorPlan";
import type { PlanItem } from "./plan";
import "./print.css";
import { reissueLinks, reopenSurvey, savedPasscode } from "../api";
import { LinkActions, SignoffLinks, type IssuedLink } from "../signoff/SignoffLinks";

export type Report = {
  header: Record<string, string | null>;
  devices_hall: Record<string, string | number | null>;
  connect_to: Record<string, string | number | null> | null;
  power: Record<string, string | number | null>;
  cooling: Record<string, string | number | null>;
  statements: { agent: string; verdict: string; statement: string; rule_refs: string[] }[];
  approved_items: { text: string; agent: string }[];
  specs: { kind: string; text: string; quantity: number | null; unit: string | null; agent: string }[];
  rules: { rule: string; text: string }[];
  cable_lengths: { path: string; cable_type: string; route: string; length_m: number | null; source?: "calc" | "narration" | "execution" | null }[];
  objections: { agent: string; rules: string[]; override_reason: string | null }[];
  lead: { summary: string; placement: { target: string; reason: string }; model: string; fell_back: boolean; next?: "another_round" | "done" | null } | null;
  meeting?: { run: number; round: number } | null;
  signoffs: { agent: string; rep_name: string; decision: string; comment: string | null; decided_at: string }[];
  tech_specs: { text: string } | null;
  plan: { size: { w: number; d: number } | null; items: PlanItem[]; lengths: Record<string, number | null>; clearances: { to: string; m: number; from: [number, number]; at: [number, number] }[] };
};

const TAG: Record<string, string> = { space: "SPC", power: "PWR", cooling: "CLG", execution: "EXE", transmission: "TRN", room_manager: "RMG" };
const LABEL: Record<string, string> = {
  floor: "Floor", floor_type: "Floor type", model: "Model", space_for_new_rack_cm: "Space for a new rack (W × D cm)", patch_cord_m: "Patch-cord length (m)",
  interconnect_m: "Interconnect cable to the connect-to room (m)", ladder_m: "Materials: ladder (m)", duct_m: "Materials: duct (m)", notes: "Notes",
  space_in_existing_rack: "Space in existing rack", required_feeds: "Required feeds", sources: "Number of sources", panel: "Power panel",
  power_cable_m: "Power cable length (m)", heat_load_btu: "Heat load (BTU/h)", ac_units: "A/C units", ac_condition: "A/C condition",
  orientation_and_place: "Orientation and reserved place",
};
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const MAX_ROUNDS = 3;
const empty = (v: unknown) => v === null || v === undefined || v === "";

function Fields({ title, data }: { title: string; data: Record<string, unknown> }) {
  // Captured values first; whatever the survey did not capture is named once, not shown as a wall of blanks.
  const rows = Object.entries(data).filter(([, v]) => !empty(v));
  const missing = Object.entries(data).filter(([, v]) => empty(v)).map(([k]) => LABEL[k] ?? k);
  return (
    <table className="form">
      <caption>{title}</caption>
      <tbody>
        {rows.map(([k, v]) => <tr key={k}><th scope="row">{LABEL[k] ?? k}</th><td className={typeof v === "number" ? "mono" : undefined}>{String(v)}</td></tr>)}
        {missing.length > 0 && <tr><td colSpan={2} className="muted">Not captured: {missing.join(", ")}</td></tr>}
      </tbody>
    </table>
  );
}

const NAME: Record<string, string> = { space: "Space", power: "Power", cooling: "Cooling", execution: "Execution", transmission: "Transmission", room_manager: "Room Manager" };

/** Two departments approving the same device in the same rack is one approval, confirmed twice. */
function mergeApprovals(items: Report["approved_items"], devices: string | null) {
  const model = (devices ?? "").split("×").pop()?.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  const merged: { text: string; agents: string[] }[] = [];
  for (const it of items) {
    const rack = it.text.match(/\bR\d+\b/)?.[0];
    const same = rack && model && it.text.toLowerCase().includes(model)
      ? merged.find((m) => m.text.match(/\bR\d+\b/)?.[0] === rack && m.text.toLowerCase().includes(model)) : undefined;
    if (same) { if (!same.agents.includes(it.agent)) same.agents.push(it.agent); } else merged.push({ text: it.text, agents: [it.agent] });
  }
  return merged;
}

/** One line on what was decided: approved for planning, what installation waits on, who has signed off. */
function Decision({ r }: { r: Report }) {
  const signed = r.signoffs.filter((s) => s.decision).length;
  const of = r.statements.length;
  if (r.header.status !== "approved") return <p className="decision open">Not approved yet: the departments are still meeting.</p>;
  const waits = r.objections.map((o) => `${NAME[o.agent] ?? o.agent} (${o.rules.join(", ")})`);
  return (
    <p className="decision">
      {waits.length ? <>Approved by the engineer for planning. Installation waits on {waits.length > 1 ? `${waits.slice(0, -1).join(", ")} and ${waits.at(-1)}` : waits[0]}: see the override reasons below.</>
        : <>Approved: every department agreed.</>}
      {" "}{signed} of {of} departments signed off.
    </p>
  );
}

export function ReportPage({ id }: { id: string }) {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [links, setLinks] = useState<{ issued: IssuedLink[]; decided: string[] } | null>(null);
  const [linkError, setLinkError] = useState("");
  const passcode = savedPasscode();
  const reissue = () => reissueLinks(id, passcode).then((r) => { setLinks({ issued: r.links, decided: r.decided }); setLinkError(""); }, (e: Error) => setLinkError(e.message));
  useEffect(() => {
    fetch(`/api/surveys/${id}/report`).then(async (res) => (res.ok ? setR(await res.json()) : setError((await res.json()).error ?? "Report unavailable")), () => setError("Report unavailable"));
  }, [id]);
  useEffect(() => { if (r) document.title = `Report · ${r.header.site} · SurvAI`; }, [r]);
  if (error) return <main className="wrap"><p className="note error" role="alert">{error}</p></main>;
  if (!r) return <main className="wrap"><p className="muted">Loading report…</p></main>;
  const h = r.header;
  return (
    <main className="wrap report">
      <div className="no-print report-actions">
        {h.status !== "approved" && <a className="btn btn-secondary" href={`/survey/${id}`}>Back to survey</a>}
        {h.status === "approved" && passcode && <button className="btn btn-secondary" onClick={() => void reissue()}>New sign-off links</button>}
        <button className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      {h.status === "approved" && passcode && r.signoffs.some((x) => x.decision === "object") && (
        <section className="no-print panel reopen" aria-label="A department objected">
          {r.signoffs.filter((x) => x.decision === "object").map((x) => (
            <p key={x.agent}><b>{NAME[x.agent] ?? x.agent}</b> objected{x.rep_name ? ` (${x.rep_name})` : ""}{x.comment ? `: ${x.comment}` : "."}</p>
          ))}
          <p className="muted small">Reopen the meeting to act on it: a new run starts, and every department reads the sign-offs and comments.</p>
          <button className="btn btn-primary" onClick={() => reopenSurvey(id, passcode).then(() => { location.href = `/survey/${id}`; }, (e: Error) => setLinkError(e.message))}>Reopen the meeting</button>
        </section>
      )}
      {(links || linkError) && (
        <div className="no-print stack" style={{ marginBottom: 16 }}>
          {linkError && <p className="note error" role="alert">{linkError}</p>}
          {links && (
            <>
              <p className="muted">{links.issued.length ? "New links for the departments that have not decided. Their old links no longer work." : "Every department has decided; no new links needed."}
                {links.decided.length > 0 && ` Already decided: ${links.decided.length}.`}</p>
              {links.issued.length > 0 && <><SignoffLinks links={links.issued} /><div className="row-btns"><LinkActions links={links.issued} /></div></>}
            </>
          )}
        </div>
      )}
      <ReportSheet r={r} />
    </main>
  );
}

/** The A4 sheet itself, shared by the survey's report page and the public replay. */
export function ReportSheet({ r }: { r: Report }) {
  const h = r.header;
  const overrides = h.status === "approved" ? r.objections.length : 0;
  // The Lead asked for another round, but the meeting had used its rounds: say who decided, so the report reads as one decision.
  const atLimit = r.lead?.next === "another_round" && (r.meeting?.round ?? 0) >= MAX_ROUNDS;
  return (
    <article className="sheet">
      <header className="sheet-head"><h1>Site Survey Report</h1><span className="mono">{h.site} · {h.date} ({h.day})</span></header>
      <Decision r={r} />
      <table className="form"><tbody>
        <tr><th scope="row">Site</th><td>{show(h.site)}</td><th scope="row">Project</th><td>{show(h.project)}</td></tr>
        <tr><th scope="row">Devices</th><td>{show(h.devices)}</td><th scope="row">Status</th><td>{overrides ? `approved with ${overrides} engineer override${overrides > 1 ? "s" : ""}` : show(h.status)}</td></tr>
        <tr><th scope="row">Request</th><td colSpan={3}>{show(h.problem)}</td></tr>
      </tbody></table>
      <Fields title="Devices hall" data={r.devices_hall} />
      {r.connect_to && <Fields title="Connect-to room" data={r.connect_to} />}
      <Fields title="Power" data={r.power} />
      <Fields title="Cooling" data={r.cooling} />
      <table className="form">
        <caption>Approved items</caption>
        <tbody>{r.approved_items.length ? mergeApprovals(r.approved_items, h.devices).map((t, k) => (
          <tr key={k}><td className="mono num">{k + 1}</td><td>{t.agents.map((a) => <span key={a} className="tag">{TAG[a] ?? a}</span>)} {t.text}</td></tr>
        )) : <tr><td>—</td></tr>}</tbody>
      </table>
      <table className="form">
        <caption>Specs and rules</caption>
        <tbody>
          {r.rules.map((x) => <tr key={x.rule}><td className="mono num">{x.rule}</td><td>{x.text}</td></tr>)}
          {r.specs.map((x, k) => <tr key={k}><td className="mono num">{TAG[x.agent] ?? x.agent}</td><td>{x.text}{x.quantity != null ? ` (${x.quantity}${x.unit ? ` ${x.unit}` : ""})` : ""}</td></tr>)}
        </tbody>
      </table>
      <table className="form">
        <caption>Cable lengths</caption>
        <thead><tr><th>Cable</th><th>Route</th><th>Length</th></tr></thead>
        <tbody>{r.cable_lengths.length ? r.cable_lengths.map((c) => <tr key={c.path}><td>{c.path}</td><td>{c.route}</td><td className="mono">{c.length_m == null ? "unknown" : `${c.length_m} m`}{c.source === "narration" ? <span className="muted"> (said in the narration)</span> : c.source === "execution" ? <span className="muted"> (Execution)</span> : null}</td></tr>) : <tr><td colSpan={3} className="muted">No cable path was drawn in this survey.</td></tr>}</tbody>
      </table>
      <section className="plan-section"><h2>Layout</h2><FloorPlan {...r.plan} /></section>
      <table className="form">
        <caption>Engineer's tech specs</caption>
        <tbody><tr><td>{show(r.tech_specs?.text)}</td></tr></tbody>
      </table>
      <table className="form">
        <caption>Representative statements</caption>
        <tbody>{r.statements.map((s) => (
          <tr key={s.agent}><td className="num"><span className="tag">{TAG[s.agent] ?? s.agent}</span></td>
            <td><span className={`chip v-${s.verdict}`}>{s.verdict}</span> {s.statement}{s.rule_refs.length ? <span className="muted mono"> ({s.rule_refs.join(", ")})</span> : null}</td></tr>
        ))}</tbody>
      </table>
      {r.objections.length > 0 && (
        <table className="form">
          <caption>{h.status === "approved" ? "Objections overridden by the engineer" : "Open objections"}</caption>
          <thead><tr><th>Department</th><th>Rules</th><th>Override reason</th></tr></thead>
          <tbody>{r.objections.map((o) => <tr key={o.agent}><td><span className="tag">{TAG[o.agent] ?? o.agent}</span></td><td className="mono">{o.rules.join(", ")}</td><td>{show(o.override_reason)}</td></tr>)}</tbody>
        </table>
      )}
      {r.lead && (
        <table className="form">
          <caption>Survey Lead</caption>
          <tbody><tr><td>{r.lead.summary}<span className="muted"> (Meta {modelName(r.lead.model) ?? r.lead.model}{r.lead.fell_back ? ", fallback" : ""})</span>
            {atLimit && <p className="muted" style={{ margin: "6px 0 0" }}>The meeting stopped at its {MAX_ROUNDS}-round limit. {h.status === "approved"
              ? "The engineer approved over the remaining objections; see Objections overridden by the engineer." : "The engineer decides on the remaining objections."}</p>}</td></tr></tbody>
        </table>
      )}
      <table className="form">
        <caption>Sign-off</caption>
        <thead><tr><th>Department</th><th>Name</th><th>Decision</th><th>Date</th></tr></thead>
        <tbody>{r.statements.map((s) => {
          const so = r.signoffs.find((x) => x.agent === s.agent);
          return <tr key={s.agent}><td><span className="tag">{TAG[s.agent] ?? s.agent}</span></td><td>{show(so?.rep_name)}</td>
            <td className={so?.decision === "object" ? "objected" : undefined}>{so ? <>{so.decision}{so.comment ? `: ${so.comment}` : ""}</> : <span className="muted">not signed yet</span>}</td><td className="mono">{show(so?.decided_at?.slice(0, 10))}</td></tr>;
        })}</tbody>
      </table>
    </article>
  );
}
