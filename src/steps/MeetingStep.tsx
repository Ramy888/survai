import { useEffect, useState } from "react";
import { answerQuestion, getTimeline, savePasscode, savedPasscode, startMeeting, type Finding, type Question, type Round, type Survey, type Timeline } from "../api";
import { Shell } from "../components/Shell";

const MAX_ROUNDS = 3;
const TAG: Record<string, string> = { space: "SPC", power: "PWR", cooling: "CLG", execution: "EXE", transmission: "TRN", room_manager: "RMG", request: "REQ" };
const NAME: Record<string, string> = { space: "Space", power: "Power", cooling: "Cooling", execution: "Execution", transmission: "Transmission", room_manager: "Room Manager", request: "The narrated clip" };
const VERDICT: Record<Finding["verdict"], [string, string]> = { approve: ["ok", "Approve"], object: ["no", "Object"], question: ["q", "Question"], unavailable: ["neutral", "Unavailable"] };
const LOCK = <svg viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M3 5V3.5a3 3 0 0 1 6 0V5h.5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5zm1.2 0h3.6V3.5a1.8 1.8 0 0 0-3.6 0z" /></svg>;

/** Where the meeting stands: a round in progress, waiting for the engineer, or finished. */
export function phase(t: Timeline) {
  const last = t.rounds.at(-1);
  if (!last) return { state: "running" as const, round: 1, leadThinking: false };
  if (!last.lead) return { state: "running" as const, round: last.round, leadThinking: last.findings.length > 0 };
  if (last.lead.outcome === "next") return { state: "running" as const, round: last.round + 1, leadThinking: false };
  return { state: last.lead.outcome, round: last.round, leadThinking: false };
}

export type FrameHref = (e: { frame: number | null; file_id?: string }) => string;

function Statement({ f, frameHref, calcRule }: { f: Finding; frameHref: FrameHref; calcRule: (id: string) => string }) {
  const [all, setAll] = useState(false);
  const [cls, label] = VERDICT[f.verdict];
  const forced = f.verdict === "object" && f.forced_rules.length > 0;
  return (
    <div className="st">
      <span className="tag" title={NAME[f.agent]}>{TAG[f.agent] ?? f.agent}</span>
      <div>
        <div className="meta">
          <span className={`chip ${cls}`}>{forced ? <>{LOCK}Forced · {f.forced_rules.join(", ")}</> : label}</span>
          {/* One chip per calculation rule: two cable paths give two LEN calculations, read as one. */}
          {[...new Set(f.evidence.flatMap((e) => "calc_id" in e ? [calcRule(e.calc_id)] : []))].map((rule) => <span key={rule} className="ev muted">calc {rule}</span>)}
          {f.evidence.map((e, k) => "calc_id" in e ? null : <a key={k} className="ev" href={frameHref(e)} target="_blank" rel="noreferrer">frame {e.frame ?? "?"}</a>)}
        </div>
        <p className={all ? "" : "clamp"}>{f.statement}</p>
        {f.statement.length > 240 && <button className="more-btn" onClick={() => setAll(!all)}>{all ? "Show less" : "Show all"}</button>}
        {f.rules.map((r) => <p className="rt" key={r.id}><span className="mono">{r.id}</span> {r.text}</p>)}
      </div>
    </div>
  );
}

export function RoundView({ r, t, frameHref, running }: { r: Round; t: Timeline; frameHref: FrameHref; running: { round: number; leadThinking: boolean } | null }) {
  const calcRule = (id: string) => r.calcs.find((c) => c.id === id)?.rule ?? "";
  const pending = running && running.round === r.round && !running.leadThinking ? t.reps.filter((a) => !r.findings.some((f) => f.agent === a)) : [];
  return (
    <section className="panel" style={{ paddingTop: 2 }} aria-label={`Round ${r.round}`}>
      {r.findings.map((f) => <Statement key={f.id} f={f} frameHref={frameHref} calcRule={calcRule} />)}
      {pending.map((a) => <p className="st thinking muted" key={a}><span className="tag">{TAG[a]}</span><span>{NAME[a]} is reviewing the room…</span></p>)}
      {r.lead ? (
        <div className="st">
          <span className="tag lead">LEAD</span>
          <div>
            <p>{r.lead.summary}</p>
            {r.lead.conflicts.map((c, k) => <p className="rt" key={k}>{c.agents.map((a) => NAME[a] ?? a).join(" vs ")}: {c.resolution}</p>)}
            {r.lead.placement.target !== "none" && <p className="rt">Placement: <span className="mono">{r.lead.placement.target.replace("rack:", "rack ")}</span>. {r.lead.placement.reason}</p>}
            {r.lead.model === "unavailable" ? <p className="rt">The Survey Lead was unavailable this round.</p>
              : r.lead.fell_back && <p className="rt">The Survey Lead ran on {r.lead.model} because Muse Wonder did not answer in time.</p>}
          </div>
        </div>
      ) : running?.round === r.round && running.leadThinking && <p className="st thinking muted"><span className="tag lead">LEAD</span><span>The Survey Lead is reading the statements…</span></p>}
    </section>
  );
}

function Ask({ q, agent, value, onChange }: { q: Question; agent: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ask">
      <span className="label">{NAME[agent] ?? agent} asks{agent === "request" && " · optional"}</span>
      <p>{q.text}</p>
      {q.answer_kind === "yes_no" ? (
        <div className="seg" role="group" aria-label="Your answer">
          {["yes", "no"].map((v) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{v === "yes" ? "Yes" : "No"}</button>)}
        </div>
      ) : (
        <input aria-label="Your answer" inputMode={q.answer_kind === "number" ? "decimal" : "text"} className={q.answer_kind === "number" ? "mono" : ""}
          placeholder={q.answer_kind === "number" ? "Number" : "Type your answer"} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function MeetingStep({ survey, onEditLayout, onApprove }: { survey: Survey; onEditLayout: () => void; onApprove: () => void }) {
  const [t, setT] = useState<Timeline | null>(null);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [passcode, setPasscode] = useState(savedPasscode);
  const [askPass] = useState(() => !savedPasscode()); // a new tab has no passcode yet; kept visible while typing
  const frameHref: FrameHref = (e) => `/api/surveys/${survey.id}/files/${e.file_id}`;
  const load = () => getTimeline(survey.id).then((x) => { setT(x); setError(""); }, (e: Error) => setError(e.message));

  const p = t && phase(t);
  useEffect(() => { void load(); }, [survey.id]);
  // Rounds run in the background; check every 2 s while one is in progress.
  useEffect(() => {
    if (p?.state !== "running") return;
    const id = setInterval(() => void load(), 2000);
    return () => clearInterval(id);
  }, [p?.state]);

  const last = t?.rounds.at(-1);
  const open = [
    ...(p?.state === "waiting" && last ? last.findings.filter((f) => f.question && !f.question.answer).map((f) => ({ q: f.question!, agent: f.agent })) : []),
    ...(t?.request_questions.filter((q) => !q.answer).map((q) => ({ q, agent: "request" })) ?? []),
  ];
  const stale = t != null && t.deliberated_layout_version != null && t.layout_version > t.deliberated_layout_version;
  const view = t && (t.rounds.find((r) => r.round === shown) ?? last);

  async function send() {
    setBusy(true); setError("");
    try {
      for (const { q } of open) if (answers[q.id]?.trim()) await answerQuestion(q.id, answers[q.id].trim(), passcode);
      savePasscode(passcode);
      setAnswers({});
      setShown(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }
  async function rerun() {
    setBusy(true); setError("");
    try { await startMeeting(survey.id, passcode); savePasscode(passcode); setShown(null); } catch (e) { setError((e as Error).message); } finally { setBusy(false); await load(); }
  }

  // The departments' questions hold the meeting; the narrated clip's questions are optional context.
  const required = open.filter((o) => o.agent !== "request");
  const filled = (q: Question) => Boolean(answers[q.id]?.trim());
  const ready = required.every(({ q }) => filled(q)) && open.some(({ q }) => filled(q));
  const next = p && p.round < MAX_ROUNDS ? `start round ${p.round + 1}` : "finish the meeting";
  const primary = !t || p?.state === "running"
    ? <button className="btn btn-primary" disabled>Meeting in progress…</button>
    : required.length || open.some(({ q }) => filled(q))
      ? <button className="btn btn-primary" disabled={!ready || busy || !passcode} onClick={send}>{busy ? "Sending…" : `Send ${open.filter(({ q }) => filled(q)).length > 1 ? "answers" : "answer"}${p?.state === "waiting" ? `, ${next}` : ""}`}</button>
      : stale
        ? <button className="btn btn-primary" disabled={busy || !passcode} onClick={rerun}>{busy ? "Starting…" : "Run the meeting again"}</button>
        : <button className="btn btn-primary" onClick={onApprove}>Continue to approve</button>;

  return (
    <Shell step={4} surveyCode={survey.site}
      actions={<><button className="btn btn-secondary" onClick={onEditLayout}>Edit layout</button>{primary}</>}>
      <div className="stack layout-grid">
        <div className="full">
          <div className="title-row"><h1>The meeting</h1>{p && <span className="mono muted">{p.state === "done" ? `Ended in round ${p.round}` : `Round ${Math.min(p.round, MAX_ROUNDS)} of ${MAX_ROUNDS}`}</span>}</div>
          <div className="rounds" aria-hidden="true">
            {Array.from({ length: MAX_ROUNDS }, (_, k) => k + 1).map((n) => <i key={n} className={p && (n < p.round || (n === p.round && p.state === "done")) ? "d" : p && n === p.round ? "n" : ""} />)}
          </div>
          <p className="muted" aria-live="polite" style={{ marginTop: 8 }}>
            {!t ? "Loading the meeting…" : p?.state === "running" ? `Round ${p.round}: the departments are reviewing the room.`
              : p?.state === "waiting" ? "The departments need your answers before the next round." : "The meeting is over."}
          </p>
        </div>
        {stale && p?.state !== "running" && <p className="note warn full">The layout changed after the last round. Run the meeting again so the departments see it.</p>}
        {t && t.rounds.length > 1 && (
          <div className="seg full" role="group" aria-label="Round" style={{ gridTemplateColumns: `repeat(${t.rounds.length}, 1fr)` }}>
            {t.rounds.map((r) => <button key={r.round} type="button" aria-pressed={r.round === view?.round} onClick={() => setShown(r.round)}>Round {r.round}</button>)}
          </div>
        )}
        <div>
          {view ? <RoundView r={view} t={t} frameHref={frameHref} running={p?.state === "running" && view === last ? p : null} />
            : t && <RoundView r={{ round: 1, findings: [], calcs: [], lead: null }} t={t} frameHref={frameHref} running={{ round: 1, leadThinking: false }} />}
          {p?.state === "running" && last?.lead && view === last && (
            <section className="panel" style={{ marginTop: 12 }} aria-label={`Round ${p.round}`}>
              {t!.reps.map((a) => <p className="st thinking muted" key={a}><span className="tag">{TAG[a]}</span><span>{NAME[a]} is reviewing round {p.round}…</span></p>)}
            </section>
          )}
        </div>
        {open.length > 0 && (
          <div className="stack">
            {open.map(({ q, agent }) => <Ask key={q.id} q={q} agent={agent} value={answers[q.id] ?? ""} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />)}
          </div>
        )}
{askPass && (
          <section className="panel fields full">
            <div className="field"><label htmlFor="pass">Team passcode</label>
              <input id="pass" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></div>
          </section>
        )}
        {error && <p className="note error full" role="alert">{error} <button className="link-btn" onClick={() => void load()}>Reload</button></p>}
      </div>
    </Shell>
  );
}
