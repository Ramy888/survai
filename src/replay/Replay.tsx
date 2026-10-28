// The public replay (/replay/sample): a real survey's meeting and report, read-only, plus "Run the meeting again",
// which starts a live run on the same fixed frames. It holds no survey id, so it cannot reach any write route.
import { useEffect, useState } from "react";
import { ApiError, type Timeline } from "../api";
import { ReportSheet, type Report } from "../report/ReportPage";
import "../report/print.css";
import { phase, RoundView } from "../steps/MeetingStep";

type Payload = { timeline: Timeline; report: Report; rerun: { enabled: boolean; running: boolean } };
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
  const waiting = ph?.state === "waiting" && last ? last.findings.filter((f) => f.question && !f.question.answer) : [];
  return (
    <>
      <header className="top"><div className="wrap bar"><a className="brand" href="/">Surv<b>AI</b></a><span className="mono muted">Replay · sample survey</span></div></header>
      <main className="wrap stack">
        <div className="narrow-intro">
          <h1>A real equipment-room survey, replayed</h1>
          <p className="muted">Six department agents met over prepared, anonymised footage of a real room. Read their meeting and the report, or run the meeting again live.</p>
          <p className="muted small">In this sample the engineer's part (correcting the drafted layout, answering the departments and approving) was played by the builder; every department statement and the Survey Lead's notes are live model output.</p>
        </div>
        {error && <p className="note error" role="alert">{error}</p>}
        {!p && !error && <p className="muted">Loading the replay…</p>}
        {p && t && (
          <>
            <div className="seg" role="group" aria-label="View">
              <button type="button" aria-pressed={tab === "meeting"} onClick={() => setTab("meeting")}>Meeting</button>
              <button type="button" aria-pressed={tab === "report"} onClick={() => setTab("report")}>Report</button>
            </div>
            {tab === "meeting" ? (
              <div className="stack">
                <div>
                  <div className="title-row"><h2>Run {t.run}</h2>{ph && <span className="mono muted">{ph.state === "done" ? `Ended in round ${ph.round}` : `Round ${Math.min(ph.round, MAX_ROUNDS)} of ${MAX_ROUNDS}`}</span>}</div>
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
                    {t.reps.map((a) => <p className="st thinking muted" key={a}><span className="tag">{a.slice(0, 3).toUpperCase()}</span><span>Reviewing the room…</span></p>)}
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
                <p className="muted small">Starts a live run of the same six agents on the same frames (Muse Spark and Muse Wonder). The report keeps the run the engineer approved.</p>
                {note && <p className="note warn" role="status">{note}</p>}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
