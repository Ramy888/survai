import { useState } from "react";
import { createSurvey, savePasscode, savedPasscode, type NewSurvey } from "../api";
import { Shell } from "../components/Shell";

const DEMO_VIDEO = "https://youtu.be/e7pMw10oSwg";

export const DEPARTMENTS = [
  ["space", "SPC", "Space"],
  ["power", "PWR", "Power"],
  ["cooling", "CLG", "Cooling"],
  ["execution", "EXE", "Execution"],
  ["room_manager", "RMG", "Room Manager"],
] as const;

export function SurveyStep({ onCreated }: { onCreated: (id: string) => void }) {
  const [form, setForm] = useState<NewSurvey>({
    site: "", project: "", device_model: "", quantity: 1, connects_to: "same_room",
    reps: DEPARTMENTS.map(([id]) => id),
  });
  const [passcode, setPasscode] = useState(savedPasscode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const other = form.connects_to === "other_room";
  const set = <K extends keyof NewSurvey>(k: K, v: NewSurvey[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleRep = (id: string) =>
    set("reps", form.reps.includes(id) ? form.reps.filter((r) => r !== id) : [...form.reps, id]);
  const ready = form.site.trim() && form.project.trim() && form.device_model.trim() && form.reps.length > 0 && passcode;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const reps = form.reps.filter((r) => r !== "transmission");
      const { id } = await createSurvey({ ...form, reps: other ? [...reps, "transmission"] : reps }, passcode);
      savePasscode(passcode);
      onCreated(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      step={1}
      actions={
        <>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={submit}>
            {busy ? "Creating survey…" : "Create survey"}
          </button>
        </>
      }
    >
      <form className="stack narrow" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <div>
          <h1>New survey</h1>
          <p className="muted">SurvAI turns one walk-through of a telecom equipment room into an approved site survey: Meta models read the
            footage, one AI agent per department reviews the plan, and you approve the report. <a href={DEMO_VIDEO} target="_blank" rel="noopener noreferrer">Watch the 3-minute demo</a></p>
        </div>
        {/* First: nothing can be created without it, and a visitor should learn that before filling in the form. */}
        <section className="panel fields" aria-label="Access">
          <div className="field"><label htmlFor="pass">Team passcode</label>
            <input id="pass" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)}
              aria-describedby="pass-hint" aria-invalid={error.includes("passcode") || undefined} />
            <span className="sub" id="pass-hint">Ask your team lead for it. Creating a survey runs paid models, so it is passcode-only.</span></div>
        </section>
        <section className="panel fields" aria-label="Request">
          <div className="two">
            <div className="field"><label htmlFor="site">Site code</label>
              <input id="site" placeholder="e.g. CAI-104" value={form.site} onChange={(e) => set("site", e.target.value)} autoComplete="off" /></div>
            <div className="field"><label htmlFor="qty">Quantity</label>
              <input id="qty" type="number" inputMode="numeric" min={1} max={20} value={form.quantity}
                onChange={(e) => set("quantity", Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></div>
          </div>
          <div className="field"><label htmlFor="project">Project</label>
            <input id="project" placeholder="e.g. Card expansion" value={form.project} onChange={(e) => set("project", e.target.value)} /></div>
          <div className="field"><label htmlFor="model">Device model</label>
            <input id="model" placeholder="e.g. Juniper MX104" value={form.device_model} onChange={(e) => set("device_model", e.target.value)} /></div>
          <div className="field">
            <span className="label" id="connects">Connects to</span>
            <div className="seg" role="group" aria-labelledby="connects">
              <button type="button" aria-pressed={!other} onClick={() => set("connects_to", "same_room")}>Same room</button>
              <button type="button" aria-pressed={other} onClick={() => set("connects_to", "other_room")}>Another room</button>
            </div>
          </div>
        </section>
        <section className="panel" aria-labelledby="reps-h">
          <h2 id="reps-h">Departments that must agree</h2>
          <p className="muted small">One AI agent per ticked department reviews the plan; the real representatives sign off later from a link.</p>
          <div className="rows">
            {DEPARTMENTS.map(([id, tag, name]) => (
              <label className="r" key={id}>
                <span className="tag">{tag}</span><span className="grow">{name}</span>
                <input type="checkbox" className="check" checked={form.reps.includes(id)} onChange={() => toggleRep(id)} />
              </label>
            ))}
            {other && (
              <label className="r">
                <span className="tag">TRN</span>
                <span className="grow">Transmission<span className="sub">Joins because the device connects to another room</span></span>
                <input type="checkbox" className="check" checked disabled />
              </label>
            )}
          </div>
        </section>
        {error && <p className="note error" role="alert">{error}</p>}
      </form>
    </Shell>
  );
}
