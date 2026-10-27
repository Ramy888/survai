import { useEffect, useState } from "react";
import { ApiError, approveSurvey, getTimeline, savedPasscode, type Survey, type Timeline } from "../api";
import { Shell } from "../components/Shell";

const TAG: Record<string, string> = { space: "SPC", power: "PWR", cooling: "CLG", execution: "EXE", transmission: "TRN", room_manager: "RMG" };
const NAME: Record<string, string> = { space: "Space", power: "Power", cooling: "Cooling", execution: "Execution", transmission: "Transmission", room_manager: "Room Manager" };

export function ApproveStep({ survey, onBack, onApproved }: { survey: Survey; onBack: () => void; onApproved: () => void }) {
  const [t, setT] = useState<Timeline | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [specs, setSpecs] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const passcode = savedPasscode();
  useEffect(() => { getTimeline(survey.id).then(setT, (e: Error) => setProblems([e.message])); }, [survey.id]);

  const last = t?.rounds.at(-1);
  const blocking = last?.findings.filter((f) => f.verdict === "object" || f.verdict === "unavailable") ?? [];
  const approving = (last?.findings.length ?? 0) - blocking.length;
  const missing = blocking.filter((f) => !reasons[f.id]?.trim()).length;

  async function submit() {
    setBusy(true); setProblems([]);
    try {
      await approveSurvey(survey.id, { tech_specs: specs, overrides: Object.fromEntries(blocking.map((f) => [f.id, reasons[f.id] ?? ""])) }, passcode);
      onApproved();
    } catch (e) {
      setProblems(e instanceof ApiError && e.problems?.length ? e.problems : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell step={5} surveyCode={survey.site}
      actions={<><button className="btn btn-secondary" onClick={onBack}>Back to meeting</button>
        <button className="btn btn-primary" disabled={!t || busy || missing > 0 || !passcode} onClick={submit}>{busy ? "Approving…" : "Approve survey"}</button></>}>
      <div className="stack narrow">
        <div>
          <h1>Approve and report</h1>
          <p className="muted">{!t ? "Loading the meeting…" : `${approving} ${approving === 1 ? "department approves" : "departments approve"}.${blocking.length
            ? ` ${blocking.length === 1 ? "One objection needs" : `${blocking.length} objections need`} your reason before you can approve.` : ""}`}</p>
        </div>
        {blocking.length > 0 && (
          <section className="panel" aria-label="Objections to override">
            {blocking.map((f) => (
              <div className="override" key={f.id}>
                <div className="r">
                  <span className="tag">{TAG[f.agent] ?? f.agent}</span>
                  <div className="grow">{f.statement.length > 140 ? `${f.statement.slice(0, 140)}…` : f.statement}
                    <div className="sub mono">{[...new Set([...f.forced_rules, ...f.rules.map((r) => r.id)])].join(", ") || "no rule"}{f.forced_rules.length ? " · forced" : ""}</div></div>
                  <span className={`chip ${f.verdict === "object" ? "no" : "neutral"}`}>{f.verdict === "object" ? "Object" : "Unavailable"}</span>
                </div>
                <div className="field">
                  <label htmlFor={`why-${f.id}`}>Override reason for {NAME[f.agent] ?? f.agent}</label>
                  <textarea id={`why-${f.id}`} maxLength={500} rows={2} value={reasons[f.id] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [f.id]: e.target.value }))} />
                </div>
              </div>
            ))}
          </section>
        )}
        <section className="panel">
          <div className="field">
            <label htmlFor="specs">Tech specs</label>
            <textarea id="specs" rows={2} maxLength={1000} placeholder="Cable type, connectors, power cable size" value={specs} onChange={(e) => setSpecs(e.target.value)} />
          </div>
        </section>
        {problems.length > 0 && <div className="note error" role="alert">{problems.map((p) => <p key={p}>{p}</p>)}</div>}
      </div>
    </Shell>
  );
}
