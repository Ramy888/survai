import { useEffect, useState } from "react";
import { FloorPlan } from "./FloorPlan";
import type { PlanItem } from "./plan";
import "./print.css";
import { reissueLinks, savedPasscode } from "../api";
import { copyAll, SignoffLinks, type IssuedLink } from "../signoff/SignoffLinks";

type Report = {
  header: Record<string, string | null>;
  devices_hall: Record<string, string | number | null>;
  connect_to: Record<string, string | number | null> | null;
  power: Record<string, string | number | null>;
  cooling: Record<string, string | number | null>;
  statements: { agent: string; verdict: string; statement: string; rule_refs: string[] }[];
  approved_items: string[];
  specs: { kind: string; text: string; quantity: number | null; unit: string | null; agent: string }[];
  rules: { rule: string; text: string }[];
  cable_lengths: { path: string; cable_type: string; route: string; length_m: number | null }[];
  objections: { agent: string; rules: string[]; override_reason: string | null }[];
  lead: { summary: string; placement: { target: string; reason: string }; model: string; fell_back: boolean } | null;
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

function Fields({ title, data }: { title: string; data: Record<string, unknown> }) {
  return (
    <table className="form">
      <caption>{title}</caption>
      <tbody>{Object.entries(data).map(([k, v]) => <tr key={k}><th scope="row">{LABEL[k] ?? k}</th><td className={typeof v === "number" ? "mono" : undefined}>{show(v)}</td></tr>)}</tbody>
    </table>
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
      {(links || linkError) && (
        <div className="no-print stack" style={{ marginBottom: 16 }}>
          {linkError && <p className="note error" role="alert">{linkError}</p>}
          {links && (
            <>
              <p className="muted">{links.issued.length ? "New links for the departments that have not decided. Their old links no longer work." : "Every department has decided; no new links needed."}
                {links.decided.length > 0 && ` Already decided: ${links.decided.length}.`}</p>
              {links.issued.length > 0 && <><SignoffLinks links={links.issued} /><button className="btn btn-secondary" onClick={() => copyAll(links.issued)}>Copy all links</button></>}
            </>
          )}
        </div>
      )}
      <article className="sheet">
        <header className="sheet-head"><h1>Site Survey Report</h1><span className="mono">{h.site} · {h.date} ({h.day})</span></header>
        <table className="form"><tbody>
          <tr><th scope="row">Site</th><td>{show(h.site)}</td><th scope="row">Project</th><td>{show(h.project)}</td></tr>
          <tr><th scope="row">Devices</th><td>{show(h.devices)}</td><th scope="row">Status</th><td>{show(h.status)}</td></tr>
          <tr><th scope="row">Request</th><td colSpan={3}>{show(h.problem)}</td></tr>
        </tbody></table>
        <Fields title="Devices hall" data={r.devices_hall} />
        {r.connect_to && <Fields title="Connect-to room" data={r.connect_to} />}
        <Fields title="Power" data={r.power} />
        <Fields title="Cooling" data={r.cooling} />
        <table className="form">
          <caption>Approved items</caption>
          <tbody>{r.approved_items.length ? r.approved_items.map((t, k) => <tr key={k}><td className="mono num">{k + 1}</td><td>{t}</td></tr>) : <tr><td>—</td></tr>}</tbody>
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
          <tbody>{r.cable_lengths.length ? r.cable_lengths.map((c) => <tr key={c.path}><td>{c.path}</td><td>{c.route}</td><td className="mono">{c.length_m == null ? "unknown" : `${c.length_m} m`}</td></tr>) : <tr><td colSpan={3}>—</td></tr>}</tbody>
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
            <tbody><tr><td>{r.lead.summary}<span className="muted"> (Muse {r.lead.model.includes("wonder") ? "Wonder" : "Spark 1.3"}{r.lead.fell_back ? ", fallback" : ""})</span></td></tr></tbody>
          </table>
        )}
        <table className="form">
          <caption>Sign-off</caption>
          <thead><tr><th>Department</th><th>Name</th><th>Decision</th><th>Date</th></tr></thead>
          <tbody>{r.statements.map((s) => {
            const so = r.signoffs.find((x) => x.agent === s.agent);
            return <tr key={s.agent}><td><span className="tag">{TAG[s.agent] ?? s.agent}</span></td><td>{show(so?.rep_name)}</td>
              <td className={so?.decision === "object" ? "objected" : undefined}>{show(so?.decision)}{so?.comment ? `: ${so.comment}` : ""}</td><td className="mono">{show(so?.decided_at?.slice(0, 10))}</td></tr>;
          })}</tbody>
        </table>
      </article>
    </main>
  );
}
