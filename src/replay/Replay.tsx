// The public replay (/replay/sample): a real survey's meeting and report, read-only, plus "Run the meeting again",
// which starts a live run on the same fixed frames. It holds no survey id, so it cannot reach any write route.
import { useEffect, useState } from "react";
import { ApiError, type Timeline } from "../api";
import { ReportSheet, type Report } from "../report/ReportPage";
import "../report/print.css";
import { NAME, phase, RoundView, Thinking } from "../steps/MeetingStep";

type Made = {
  footage: { frames: number; clip: boolean; photos: number };
  sam: { frames: number; rack_frames: number; tile_frames: number } | null;
  drafted: { items: number; breakers: number; observations: number };
  engineer: { added: number; target: string | null; free_u: string | null; free_breakers: number; spare_ac_btu: number | null; ladder_height_m: number | null };
};
type Payload = { timeline: Timeline; report: Report; made: Made | null; rerun: { enabled: boolean; running: boolean } };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The pipeline behind the meeting, so a judge sees more than the finished result: filmed, drafted, corrected. */
function HowMade({ slug, made, t }: { slug: string; made: Made; t: Timeline }) {
  const { footage: f, sam, drafted: d, engineer: e } = made;
  const answers = [
    ...t.rounds.flatMap((r) => r.findings.filter((x) => x.question?.answer).map((x) => ({ who: x.agent, q: x.question!.text, a: x.question!.answer! }))),
    ...t.request_questions.filter((q) => q.answer).map((q) => ({ who: "request", q: q.text, a: q.answer! })),
  ];
  const confirmed = [
    e.target && `marked ${e.target} as the target${e.free_u ? ` (free U${e.free_u})` : ""}`,
    e.free_breakers > 0 && `confirmed ${plural(e.free_breakers, "free breaker")}`,
    e.spare_ac_btu != null && `${e.spare_ac_btu.toLocaleString("en-US")} BTU/h of spare cooling`,
    e.ladder_height_m != null && `a ${e.ladder_height_m} m ladder`,
    d.items > 0 ? e.added > 0 && `edited or added ${plural(e.added, "layout item")}` : e.added > 0 && "reviewed and saved the drafted layout",
  ].filter(Boolean);
  return (
    <section className="panel made" aria-labelledby="made-h">
      <h2 id="made-h">How this survey was made</h2>
      <ol className="made-steps">
        <li>
          <span className="label">1 · Filmed, blurred on the engineer's computer</span>
          <div className="made-frames">{Array.from({ length: Math.min(6, f.frames) }, (_, k) => (
            <img key={k} src={`/api/replay/${slug}/frames/${k + 1}`} alt={`Key frame ${k + 1}`} loading="lazy" />))}</div>
          <p>{plural(f.frames, "key frame")}{f.clip ? ", a narrated path clip" : ""}{f.photos ? ` and ${plural(f.photos, "photo")}` : ""}. Faces, labels and logos were blurred before upload.</p>
        </li>
        <li>
          <span className="label">2 · Drafted by the models</span>
          <p>{sam && <>Meta SAM 3.1 found racks in {sam.rack_frames} of {sam.frames} frames and floor tiles in {sam.tile_frames}. </>}
            Muse Spark drafted {d.items > 0 ? plural(d.items, "layout item") : "the room's layout"}, read {plural(d.breakers, "breaker slot")} on the panel photos
            {d.observations ? ` and noted ${plural(d.observations, "housekeeping issue")}` : ""}, and read the request from the narrated clip.</p>
        </li>
        <li>
          <span className="label">3 · Corrected and answered by the engineer</span>
          {confirmed.length > 0 && <p>The engineer {confirmed.join(", ")}.</p>}
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
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [running]);

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
  const view = t && (t.rounds.find((r) => r.round === shown) ?? last);
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
          <p className="muted">{agents.charAt(0).toUpperCase() + agents.slice(1)} met over prepared, anonymised footage of a real room. Read their meeting and the report, or run the meeting again live.</p>
          <p className="muted small">In this sample the engineer's part (correcting the drafted layout, answering the departments and approving) was played by the builder; every department statement and the Survey Lead's notes are live model output.</p>
        </div>}
        {error && p && <p className="note error" role="alert">{error}</p>}
        {!p && !error && <p className="muted">Loading the replay…</p>}
        {p && t && (
          <>
            {p.made && <HowMade slug={slug} made={p.made} t={t} />}
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
                {t.rounds.length > 1 && (
                  <div className="seg" role="group" aria-label="Round" style={{ gridTemplateColumns: `repeat(${t.rounds.length}, 1fr)` }}>
                    {t.rounds.map((r) => <button key={r.round} type="button" aria-pressed={r.round === view?.round} onClick={() => setShown(r.round)}>Round {r.round}</button>)}
                  </div>
                )}
                {view
                  ? <RoundView r={view} t={t} frameHref={(e) => `/api/replay/${slug}/frames/${e.frame}`} running={running && ph && view === last ? ph : null} />
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
                <button className="btn btn-primary" disabled={busy || running} onClick={rerun}>{running ? "Meeting running…" : busy ? "Starting…" : "Run the meeting again"}</button>
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
