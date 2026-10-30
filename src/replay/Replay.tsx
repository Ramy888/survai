// The public replay (/replay/sample): a real survey's meeting and report, read-only, plus "Run the meeting again",
// which starts a live run on the same fixed frames. It holds no survey id, so it cannot reach any write route.
import { useEffect, useState } from "react";
import { ApiError, type Timeline } from "../api";
import { Accuracy } from "../components/Accuracy";
import { Impact } from "../components/Impact";
import { ReportSheet, type Report } from "../report/ReportPage";
import "../report/print.css";
import { NAME, phase, Roster, RoundView, roundsToShow, Thinking } from "../steps/MeetingStep";
import { Feeds } from "../components/Feeds";
import { feedRows, type FeedInput } from "../steps/feeds";

type Made = {
  inputs?: FeedInput;
  footage: { frames: number; narration: boolean; photos: number; source: "video" | "prepared"; blurred: boolean };
  sam: { frames: number; rack_frames: number; tile_frames: number } | null;
  drafted: { items: number; breakers: number; observations: number };
  engineer: { added: number; target: string | null; free_u: string | null; free_breakers: number; spare_ac_btu: number | null; ladder_height_m: number | null };
};
type Payload = { timeline: Timeline; report: Report; made: Made | null; rerun: { enabled: boolean; running: boolean } };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How the key frames were made, in the replay's words. Prepared but not blurred means only faces and logos were. */
export function footageNote(f: Made["footage"]) {
  if (f.source === "prepared") return f.blurred
    ? { label: "Filmed, blurred on the engineer's computer", text: "Faces, labels and logos were blurred before upload." }
    : { label: "Filmed, logos blurred on the engineer's computer", text: "Only faces and equipment logos were blurred before upload; the room is shown as filmed." };
  return f.blurred
    ? { label: "Filmed, frames picked and blurred in SurvAI", text: "SurvAI picked the sharpest frames from the walk-through video, and Meta SAM 3.1 found the labels it blurred before anything was stored." }
    : { label: "Filmed, frames picked in SurvAI", text: "SurvAI picked the sharpest frames from the walk-through video." };
}

/** The pipeline behind the meeting, so a judge sees more than the finished result: filmed, drafted, corrected. */
function HowMade({ slug, made, t }: { slug: string; made: Made; t: Timeline }) {
  const { footage: f, sam, drafted: d, engineer: e } = made;
  const answers = [
    ...t.rounds.flatMap((r) => r.findings.filter((x) => x.question?.answer).map((x) => ({ who: x.agent, q: x.question!.text, a: x.question!.answer! }))),
    ...t.request_questions.filter((q) => q.answer).map((q) => ({ who: "request", q: q.text, a: q.answer! })),
  ];
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
  const facts = [
    e.free_breakers > 0 ? plural(e.free_breakers, "free breaker") : "",
    e.spare_ac_btu != null ? `${e.spare_ac_btu.toLocaleString("en-US")} BTU/h of spare cooling` : "",
    e.ladder_height_m != null ? `a ${e.ladder_height_m} m ladder` : "",
  ].filter(Boolean);
  const did = [
    facts.length ? `confirmed ${and(facts)}` : "",
    // A full layout save re-labels every drafted item as the engineer's, so a zero AI count means "reviewed", not "drew it all".
    e.added > 0 ? (d.items > 0 ? `edited or added ${plural(e.added, "layout item")}` : "reviewed and saved the drafted layout") : "",
  ].filter(Boolean);
  const engineer = [
    e.target ? `The engineer marked ${e.target} as the target${e.free_u ? ` (free U${e.free_u})` : ""}.` : "",
    did.length ? `${e.target ? "They" : "The engineer"} ${did.join(", and ")}.` : "",
  ].filter(Boolean).join(" ");
  return (
    <section className="panel made" aria-labelledby="made-h">
      <h2 id="made-h">How this survey was made</h2>
      <ol className="made-steps">
        <li>
          <span className="label">1 · {footageNote(f).label}</span>
          <div className="made-frames">{Array.from({ length: Math.min(6, f.frames) }, (_, k) => (
            <img key={k} src={`/api/replay/${slug}/frames/${k + 1}`} alt={`Key frame ${k + 1}`} loading="lazy" />))}</div>
          <p>{plural(f.frames, "key frame")}{f.narration ? ", the engineer's narration" : ""}{f.photos ? ` and ${plural(f.photos, "photo")}` : ""}. {footageNote(f).text}</p>
        </li>
        <li>
          <span className="label">2 · Drafted by the models</span>
          <p>{sam && <>Meta SAM 3.1 found racks in {sam.rack_frames} of {sam.frames} frames and floor tiles in {sam.tile_frames}. </>}
            Muse Spark drafted {d.items > 0 ? plural(d.items, "layout item") : "the room's layout"}, read {plural(d.breakers, "breaker slot")} on the panel photos
            {d.observations ? ` and noted ${plural(d.observations, "housekeeping issue")}` : ""}, and read the request from the engineer's narration.</p>
        </li>
        <li>
          <span className="label">3 · Corrected and answered by the engineer</span>
          {engineer && <p>{engineer}</p>}
          {answers.length > 0 && <ul className="made-answers">{answers.map((x, k) => <li key={k}><b>{NAME[x.who] ?? x.who}</b> asked: {x.q} <span className="mono">{x.a}</span></li>)}</ul>}
        </li>
      </ol>
    </section>
  );
}
const MAX_ROUNDS = 3;

export function Replay({ slug }: { slug: string }) {
  const [p, setP] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"meeting" | "report">("meeting");
  const [shown, setShown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetch(`/api/replay/${slug}`).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (res.ok) { setP(body); setError(""); } else setError(body.error ?? "Replay unavailable");
  }, () => setError("Replay unavailable"));
  useEffect(() => { void load(); }, [slug]);
  useEffect(() => { document.title = "Sample survey replay · SurvAI"; }, []);
  const running = p?.rerun.running ?? false;
  // A live run shows its clock, so a judge sees it is working and roughly how long it takes.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => void load(), 2000);
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [running]);
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  async function rerun() {
    setBusy(true); setNote("");
    try {
      const res = await fetch(`/api/replay/${slug}/rerun`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
      setShown(null); setTab("meeting");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  const t = p?.timeline;
  const ph = t && phase(t);
  const last = t?.rounds.at(-1);
  const { view, tabs } = t && ph ? roundsToShow(t, ph, shown) : { view: null, tabs: [] };
  // How many departments met, in words; the sample's count comes from the survey, not from this copy.
  const agents = t ? `${["", "one", "two", "three", "four", "five", "six", "seven"][t.reps.length] ?? t.reps.length} department agents` : "The department agents";
  const waiting = ph?.state === "waiting" && last ? last.findings.filter((f) => f.question && !f.question.answer) : [];
  return (
    <>
      <header className="top"><div className="wrap bar"><a className="brand" href="/">Surv<b>AI</b></a><span className="mono muted">Replay · sample survey</span></div></header>
      <main className="wrap stack">
        {error && !p ? (
          <div className="narrow-intro stack">
            <h1>Replay not found</h1>
            <p className="note error" role="alert">{error === "Replay not found" ? "" : `${error}. `}Check that you opened the full link you were sent.</p>
            <p><a className="btn btn-secondary" href="/">Go to SurvAI</a></p>
          </div>
        ) : <div className="narrow-intro">
          <h1>A real equipment-room survey, replayed</h1>
          <p className="muted">{agents.charAt(0).toUpperCase() + agents.slice(1)} met over the key frames of a real room. Read their meeting and the report, or run the meeting again live.</p>
          <p className="muted small">In this sample the engineer's part (correcting the drafted layout, answering the departments and approving) was played by the builder; every department statement and the Survey Lead's notes are live model output.</p>
          {/* The live proof, where a judge sees it first; the full panel stays at the bottom. */}
          {p?.rerun.enabled && (
            <p className="rerun-top"><button className="btn btn-secondary" disabled={busy || running} onClick={rerun}>{running ? `Meeting running · ${clock}` : "Run the meeting again, live"}</button>
              <span className="muted small">About 2 minutes on Meta models. The report keeps the run the engineer approved.</span></p>
          )}
        </div>}
        {p && <Impact />}
        {p && <Accuracy />}
        {error && p && <p className="note error" role="alert">{error}</p>}
        {!p && !error && <p className="muted">Loading the replay…</p>}
        {p && t && (
          <>
            {p.made && <HowMade slug={slug} made={p.made} t={t} />}
            {p.made?.inputs && <Feeds rows={feedRows(p.made.inputs)} title="What the agents started from" foot="Read from the frames, the narration, the datasheet and the panel photos, then checked by the engineer; the agents got these values as text." />}
            <div className="seg" role="group" aria-label="View">
              <button type="button" aria-pressed={tab === "meeting"} onClick={() => setTab("meeting")}>Meeting</button>
              <button type="button" aria-pressed={tab === "report"} onClick={() => setTab("report")}>Report</button>
            </div>
            {tab === "meeting" ? (
              <div className="stack">
                <div>
                  <div className="title-row"><h2>{t.run && t.run > 1 ? `Meeting, run ${t.run}` : "The meeting"}</h2>{ph && <span className="mono muted">{ph.state === "done" ? `Ended in round ${ph.round}` : `Round ${Math.min(ph.round, MAX_ROUNDS)} of ${MAX_ROUNDS}`}</span>}</div>
                  <p className="muted" aria-live="polite">{running ? (ph?.state === "running" ? `Round ${ph.round}: the departments are reviewing the room live.` : "A new run is starting.")
                    : ph?.state === "waiting" ? "This run stopped on a question only the survey's engineer could answer." : "The meeting is over."}</p>
                </div>
                {tabs.length > 1 && (
                  <div className="seg" role="group" aria-label="Round" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
                    {tabs.map((r) => <button key={r.round} type="button" aria-pressed={r.round === view?.round} onClick={() => setShown(r.round)}>Round {r.round}</button>)}
                  </div>
                )}
                <Roster t={t} r={view} running={!!running && ph?.state === "running" && view === tabs.at(-1)} />
                {view
                  ? <RoundView r={view} t={t} frameHref={(e) => `/api/replay/${slug}/frames/${e.frame}`} running={running && ph && view === tabs.at(-1) ? ph : null} />
                  : <RoundView r={{ round: 1, findings: [], calcs: [], lead: null }} t={t} frameHref={() => "#"} running={{ round: 1, leadThinking: false }} />}
                {running && ph?.state !== "running" && (
                  <section className="panel" aria-label={`Run ${t.run! + 1}`}>
                    <p className="muted">Run {t.run! + 1} is starting live:</p>
                    <div className="chat">{t.reps.map((a) => <Thinking key={a} agent={a} text="Reviewing the room" />)}</div>
                  </section>
                )}
                {waiting.map((f) => <div className="ask" key={f.id}><span className="label">Waiting on the engineer</span><p>{f.question!.text}</p></div>)}
              </div>
            ) : (
              <div className="report"><ReportSheet r={p.report} /></div>
            )}
            {p.rerun.enabled && (
              <div className="panel stack" style={{ gap: 10 }}>
                <button className="btn btn-primary" disabled={busy || running} onClick={rerun}>{running ? `Meeting running · ${clock}` : busy ? "Starting…" : "Run the meeting again"}</button>
                <p className="muted small">Starts a live run of the same {agents} on the same frames (Muse Spark and Muse Wonder). The report keeps the run the engineer approved.</p>
                {note && <p className="note warn" role="status">{note}</p>}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
