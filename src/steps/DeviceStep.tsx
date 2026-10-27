import { useEffect, useState } from "react";
import { ApiError, confirmDevice, lookupDevice, savePasscode, savedPasscode, type DeviceSpec, type Survey } from "../api";
import { Shell } from "../components/Shell";

type Fields = Record<"height_u" | "power_w" | "feed_count" | "breaker_rating_a" | "depth_mm" | "weight_kg" | "airflow", string>;
const empty: Fields = { height_u: "", power_w: "", feed_count: "", breaker_rating_a: "", depth_mm: "", weight_kg: "", airflow: "" };
const toFields = (s: DeviceSpec): Fields => ({
  height_u: String(s.height_u), power_w: String(s.power_w), feed_count: String(s.feed_count),
  breaker_rating_a: s.breaker_rating_a == null ? "" : String(s.breaker_rating_a), depth_mm: s.depth_mm == null ? "" : String(s.depth_mm),
  weight_kg: s.weight_kg == null ? "" : String(s.weight_kg), airflow: s.airflow ?? "",
});
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function DeviceStep({ survey, onConfirmed }: { survey: Survey; onConfirmed: () => void }) {
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
        weight_kg: num(fields.weight_kg), airflow: fields.airflow.trim() || null, sources,
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
      <input id={k} inputMode={mode} className={mode === "text" ? undefined : "mono"} value={fields[k]} onChange={set(k)} disabled={phase === "looking"} />
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
          {phase === "found" && <p className="found">Datasheet found. Check the values before confirming.</p>}
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
          {sources.length > 0 && (
            <div>
              <span className="label">Sources</span>
              <ul className="sources">
                {sources.map((s) => (
                  <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || new URL(s.url).hostname}</a></li>
                ))}
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
