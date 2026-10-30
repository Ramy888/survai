import { useState } from "react";
import { createSurvey, savePasscode, savedPasscode, type NewSurvey } from "../api";
import { OWNED_RULES, RULES } from "../../worker/agents/config";
import { ModelChip } from "../components/Footage";
import { Impact } from "../components/Impact";
import { Shell } from "../components/Shell";

const DEMO_VIDEO = "https://youtu.be/a9AVNlmbErw";

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
  // The judges' link carries their passcode after "#judge=", so it never reaches a server log; it is kept for this tab
  // and wiped from the address bar.
  const [passcode, setPasscode] = useState(() => {
    const judge = new URLSearchParams(location.hash.slice(1)).get("judge");
    if (!judge) return savedPasscode();
    savePasscode(judge);
    try { sessionStorage.setItem("survai.judge", "1"); } catch { /* private mode: the note shows until a reload */ }
    history.replaceState(null, "", location.pathname);
    return judge;
  });
  // Opened from the judges' link: nothing to type, so no field to look for.
  const [linked] = useState(() => { try { return sessionStorage.getItem("survai.judge") === "1"; } catch { return false; } });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NewSurvey>(k: K, v: NewSurvey[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleRep = (id: string) =>
    set("reps", form.reps.includes(id) ? form.reps.filter((r) => r !== id) : [...form.reps, id]);
  const ready = form.site.trim() && form.project.trim() && form.device_model.trim() && form.reps.length > 0 && passcode;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      // One room: the device and what it links to are in the filmed room (the API still takes "other_room").
      const { id } = await createSurvey({ ...form, reps: form.reps.filter((r) => r !== "transmission") }, passcode);
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
            footage, one AI agent per department reviews the plan, and you approve the report.</p>
          <p className="intro-links"><a className="btn btn-secondary" href="/sample">See a sample survey, no passcode</a>
            <a href={DEMO_VIDEO} target="_blank" rel="noopener noreferrer">Watch the 3-minute demo</a></p>
        </div>
        <Impact />
        {/* First: nothing can be created without it, and a visitor should learn that before filling in the form. */}
        {linked && passcode && !/passcode/i.test(error) ? (
          <section className="panel" aria-label="Access">
            <p className="note info judge-access"><b>Judge access</b> · the passcode came with your link, so there is nothing to type. Up to 5 surveys a day.</p>
          </section>
        ) : (
        <section className="panel fields" aria-label="Access">
          <div className="field"><label htmlFor="pass">Team passcode</label>
            <input id="pass" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)}
              aria-describedby="pass-hint" aria-invalid={error.includes("passcode") || undefined} />
            <span className="sub" id="pass-hint">Ask your team lead for it. Creating a survey runs paid models, so it is passcode-only.</span>
            {/* Someone filling in the form without it learns why "Create survey" stays grey before they finish. */}
            {!passcode && (form.site || form.project || form.device_model) && <p className="note warn small" role="status">Add the team passcode to create this survey.</p>}
            {/* A passcode error belongs where the eye lands after the page jumps back to this field. */}
            {/passcode/i.test(error) && <p className="note error" role="alert">{error}</p>}</div>
        </section>
        )}
        <section className="panel fields" aria-label="Request">
          <div className="two by-label">
            <div className="field"><label htmlFor="site">Site code</label>
              <input id="site" placeholder="e.g. CAI-104" value={form.site} onChange={(e) => set("site", e.target.value)} autoComplete="off" /></div>
            <div className="field"><label htmlFor="qty">Quantity</label>
              <input id="qty" type="number" inputMode="numeric" min={1} max={20} value={form.quantity} aria-describedby="qty-hint"
                onChange={(e) => set("quantity", Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
              <span className="sub" id="qty-hint">How many of this device go in</span></div>
          </div>
          <div className="field"><label htmlFor="project">Project</label>
            <input id="project" placeholder="e.g. Card expansion" value={form.project} onChange={(e) => set("project", e.target.value)} /></div>
          <div className="field"><label htmlFor="model">Device model</label>
            <input id="model" placeholder="e.g. Juniper MX104" value={form.device_model} onChange={(e) => set("device_model", e.target.value)} /></div>
        </section>
        <section className="panel" aria-labelledby="reps-h">
          <h2 id="reps-h">The meeting: {form.reps.length} agents meet, {form.reps.length} people sign off</h2>
          <p className="muted small">One AI agent per ticked department reviews the plan against the rules it owns; that department's real representative signs off the report later from a link.</p>
          <div className="rows agents">
            {DEPARTMENTS.map(([id, tag, name]) => (
              <label className="r seat-card" key={id}>
                <span className="tag">{tag}</span>
                <span className="grow"><b>{name}</b>
                  <span className="sub">{OWNED_RULES[id as keyof typeof OWNED_RULES]?.map((r) => `${r} ${RULES[r].text}`).join(" · ") || "reviews the plan"}</span>
                  <span className="sub agent-line"><ModelChip model="muse-spark-open" what="agent" /> signs off: the real representative</span></span>
                <input type="checkbox" className="check" checked={form.reps.includes(id)} onChange={() => toggleRep(id)} />
              </label>
            ))}
            <div className="r seat-card">
              <span className="tag lead">LEAD</span>
              <span className="grow"><b>Survey Lead</b>
                <span className="sub">sums up each round, resolves conflicts, places the device</span>
                <span className="sub agent-line"><ModelChip model="muse-wonder-1.0" what="agent" /></span></span>
            </div>
          </div>
        </section>
        {error && !/passcode/i.test(error) && <p className="note error" role="alert">{error}</p>}
      </form>
    </Shell>
  );
}
