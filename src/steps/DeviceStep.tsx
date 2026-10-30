import { useEffect, useState } from "react";
import { ApiError, confirmDevice, lookupDevice, savePasscode, savedPasscode, type DeviceSpec, type Survey } from "../api";
import { ModelChip } from "../components/Footage";
import { Shell } from "../components/Shell";
import { DEPARTMENTS } from "./SurveyStep";

type Fields = Record<"height_u" | "power_w" | "feed_count" | "breaker_rating_a" | "depth_mm" | "weight_kg" | "airflow" | "interfaces" | "transceivers" | "connectors", string>;
const empty: Fields = { height_u: "", power_w: "", feed_count: "", breaker_rating_a: "", depth_mm: "", weight_kg: "", airflow: "", interfaces: "", transceivers: "", connectors: "" };
const toFields = (s: DeviceSpec): Fields => ({
  height_u: String(s.height_u), power_w: String(s.power_w), feed_count: String(s.feed_count),
  breaker_rating_a: s.breaker_rating_a == null ? "" : String(s.breaker_rating_a), depth_mm: s.depth_mm == null ? "" : String(s.depth_mm),
  weight_kg: s.weight_kg == null ? "" : String(s.weight_kg), airflow: s.airflow ?? "",
  interfaces: s.interfaces ?? "", transceivers: s.transceivers ?? "", connectors: s.connectors ?? "",
});
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** A cited source, with its site named: a third-party mirror (often behind a bot check) is visible before the click. */
function Source({ s }: { s: DeviceSpec["sources"][number] }) {
  let host = "";
  try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* a malformed URL still shows its title */ }
  return <li><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || host || s.url}</a>{host && s.title ? <span className="muted"> · {host}</span> : null}</li>;
}

const REP_NAME: Record<string, string> = { ...Object.fromEntries(DEPARTMENTS.map(([id, , name]) => [id, name])), transmission: "Transmission" };

/** What was saved in step 1, once the device is confirmed: the survey and the device, read-only. */
export function DeviceSummary({ survey }: { survey: Survey }) {
  const d = survey.device;
  const row = (label: string, value: React.ReactNode) => value == null || value === "" ? null : <div className="kv"><dt>{label}</dt><dd>{value}</dd></div>;
  return (
    <>
      <section className="panel" aria-labelledby="h-survey">
        <h2 id="h-survey">Survey</h2>
        <dl className="kvs">
          {row("Site", survey.site)}
          {row("Project", survey.project)}
          {row("Device", `${survey.quantity} × ${survey.device_model}`)}
          {row("Connects to", survey.connects_to === "same_room" ? "Same room" : "Another room")}
          {row("Representatives", survey.reps.map((r) => REP_NAME[r] ?? r).join(", "))}
        </dl>
      </section>
      {d && (
        <section className="panel" aria-labelledby="h-device">
          <h2 id="h-device">Device</h2>
          <dl className="kvs mono-values">
            {row("Height (U)", d.height_u)}
            {row("Power, max (W)", d.power_w)}
            {row("Feeds", `${d.feed_count} × ${d.feed_type}`)}
            {row("Breaker (A)", d.breaker_rating_a)}
            {row("Depth (mm)", d.depth_mm)}
            {row("Weight (kg)", d.weight_kg)}
            {row("Airflow", d.airflow)}
            {row("Interfaces", d.interfaces)}
            {row("Transceivers", d.transceivers)}
            {row("Fibre connectors", d.connectors)}
          </dl>
          {d.sources.length > 0 && (
            <div>
              <span className="label">Sources</span>
              <ul className="sources">
                {d.sources.map((s) => <Source key={s.url} s={s} />)}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function DeviceStep({ survey, onConfirmed, back }: { survey: Survey; onConfirmed: () => void; back?: { label: string; go: () => void } }) {
  if (survey.status !== "draft") {
    return (
      <Shell step={1} surveyCode={survey.site} actions={back && <button className="btn btn-primary" onClick={back.go}>{back.label}</button>}>
        <div className="stack narrow">
          <div><h1>Survey and device</h1><p className="muted">{survey.quantity} × {survey.device_model} · {survey.project}</p></div>
          <p className="note info">Saved and locked once the device was confirmed: the footage, layout and meeting are built on it. To change it, start a new survey.</p>
          <DeviceSummary survey={survey} />
        </div>
      </Shell>
    );
  }
  return <DeviceForm survey={survey} onConfirmed={onConfirmed} />;
}

function DeviceForm({ survey, onConfirmed }: { survey: Survey; onConfirmed: () => void }) {
  const [passcode, setPasscode] = useState(savedPasscode);
  const [phase, setPhase] = useState<"looking" | "found" | "manual">(passcode ? "looking" : "manual");
  const [fields, setFields] = useState<Fields>(empty);
  const [feedType, setFeedType] = useState<"AC" | "DC">("DC");
  const [sources, setSources] = useState<DeviceSpec["sources"]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!passcode || phase !== "looking") return;
    lookupDevice(survey.id, passcode).then(
      ({ spec }) => { setFields(toFields(spec)); setFeedType(spec.feed_type); setSources(spec.sources); setPhase("found"); },
      (e: ApiError) => { setNote(e.message); setPhase("manual"); },
    );
  }, [survey.id, passcode, phase]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const ready = num(fields.height_u)! > 0 && num(fields.power_w)! > 0 && num(fields.feed_count)! > 0 && passcode && phase !== "looking";

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await confirmDevice(survey.id, {
        height_u: Number(fields.height_u), power_w: Math.round(Number(fields.power_w)), feed_type: feedType,
        feed_count: Math.round(Number(fields.feed_count)), breaker_rating_a: num(fields.breaker_rating_a),
        depth_mm: num(fields.depth_mm) === null ? null : Math.round(Number(fields.depth_mm)),
        weight_kg: num(fields.weight_kg), airflow: fields.airflow.trim() || null,
        interfaces: fields.interfaces.trim() || null, transceivers: fields.transceivers.trim() || null, connectors: fields.connectors.trim() || null, sources,
      }, passcode);
      savePasscode(passcode);
      onConfirmed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof Fields, label: string, mode: "decimal" | "numeric" | "text" = "decimal") => (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      <input id={k} inputMode={mode} className={mode === "text" ? undefined : "mono"} value={fields[k]} onChange={set(k)} disabled={phase === "looking"}
        placeholder={phase === "found" ? "not in the datasheet" : undefined} />
    </div>
  );

  return (
    <Shell step={1} surveyCode={survey.site}
      actions={<button className="btn btn-primary" disabled={!ready || busy} onClick={confirm}>{busy ? "Saving…" : "Confirm device"}</button>}>
      <div className="stack narrow">
        <div>
          <h1>Confirm the device</h1>
          <p className="muted">{survey.quantity} × {survey.device_model} · {survey.project}</p>
        </div>
        <section className="panel fields" aria-live="polite">
          {phase === "looking" && (
            <p className="loading"><span className="spin" aria-hidden="true" />Reading the {survey.device_model} datasheet. This takes about 30 seconds.</p>
          )}
          {phase === "found" && <p className="found"><ModelChip model="muse-spark-1.3" what={`web search · ${sources.length} source${sources.length === 1 ? "" : "s"}`} /> Check the values before confirming.</p>}
          {phase === "manual" && note && <p className="note error">{note}</p>}
          <div className="three">
            {input("height_u", "Height (U)")}
            {input("power_w", "Power, max (W)", "numeric")}
            {input("feed_count", "Feeds", "numeric")}
          </div>
          <div className="field">
            <span className="label" id="feed">Feed type</span>
            <div className="seg" role="group" aria-labelledby="feed">
              {(["DC", "AC"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={feedType === t} onClick={() => setFeedType(t)} disabled={phase === "looking"}>{t}</button>
              ))}
            </div>
          </div>
          <div className="three">
            {input("breaker_rating_a", "Breaker (A)")}
            {input("depth_mm", "Depth (mm)", "numeric")}
            {input("weight_kg", "Weight (kg)")}
          </div>
          {input("airflow", "Airflow", "text")}
          {input("interfaces", "Interfaces", "text")}
          <div className="two">
            {input("transceivers", "Transceivers", "text")}
            {input("connectors", "Fibre connectors", "text")}
          </div>
          {sources.length > 0 && (
            <div>
              <span className="label">Sources</span>
              <ul className="sources">
                {sources.map((s) => <Source key={s.url} s={s} />)}
              </ul>
            </div>
          )}
        </section>
        {!savedPasscode() && (
          <section className="panel fields">
            <div className="field"><label htmlFor="pass">Team passcode</label>
              <input id="pass" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></div>
          </section>
        )}
        {error && <p className="note error" role="alert">{error}</p>}
      </div>
    </Shell>
  );
}
