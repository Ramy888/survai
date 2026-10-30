import { useEffect, useRef, useState } from "react";
import { answerQuestion, getTimeline, savePasscode, savedPasscode, startMeeting, type Finding, type Question, type Round, type Survey, type Timeline } from "../api";
import { ModelChip } from "../components/Footage";
import { Shell } from "../components/Shell";

const MAX_ROUNDS = 3;
const TAG: Record<string, string> = { space: "SPC", power: "PWR", cooling: "CLG", execution: "EXE", transmission: "TRN", room_manager: "RMG", request: "REQ" };
export const NAME: Record<string, string> = { space: "Space", power: "Power", cooling: "Cooling", execution: "Execution", transmission: "Transmission", room_manager: "Room Manager", request: "The narration" };
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

/** The round on screen, and the tabs: a round that has just started shows at once, empty, with its reviewers typing. */
export function roundsToShow(t: Timeline, p: ReturnType<typeof phase>, shown: number | null) {
  const last = t.rounds.at(-1);
  const starting: Round | null = p.state === "running" && last?.lead && p.round > last.round ? { round: p.round, findings: [], calcs: [], lead: null } : null;
  const tabs = starting ? [...t.rounds, starting] : t.rounds;
  return { view: tabs.find((r) => r.round === shown) ?? tabs.at(-1) ?? null, tabs };
}

export type FrameHref = (e: { frame: number | null; file_id?: string }) => string;
type Calc = Round["calcs"][number];

/** What a failed calculation found, in one line from its own numbers; null when it passed or could not run. */
export function calcLine(c: Calc): string | null {
  if (c.pass !== false) return null;
  const r = c.result as Record<string, unknown>;
  const n = (k: string) => Number(r[k] ?? 0);
  switch (c.rule) {
    case "R11": return `R11 · needs ${n("needed")} free breakers, found ${n("matching")}`;
    case "R10": return r.w_per_m2 != null ? `R10 · adds ${n("w_per_m2")} W per m² of floor, over the ${n("limit_w_per_m2")} W/m² design figure`
      : `R10 · adds ${n("heat_btu")} BTU/h, ${n("over_btu")} over the spare A/C`;
    case "R8": return `R8 · needs ${n("needed_u")}U free in ${String(r.rack ?? "the rack")}, largest gap ${Number((r.block as { units?: number } | null)?.units ?? 0)}U`;
    case "R6": return `R6 · the door swing is blocked by ${(r.blocking as unknown[] ?? []).map(String).join(", ")}`;
    case "R3": return "R3 · a power cable shares a route with data";
    default: return `${c.rule} · failed`;
  }
}

/** One agent's verdict in each round of the run, null where it did not speak: its story across the meeting. */
export function verdictTrack(rounds: Round[], agent: string, max: number): (Finding["verdict"] | null)[] {
  return Array.from({ length: max }, (_, k) => rounds.find((r) => r.round === k + 1)?.findings.find((f) => f.agent === agent)?.verdict ?? null);
}

function Verdict({ f }: { f: Finding }) {
  const [cls, label] = VERDICT[f.verdict];
  const forced = f.verdict === "object" && f.forced_rules.length > 0;
  return <span className={`chip ${cls}`}>{forced ? <>{LOCK}Forced · {f.forced_rules.join(", ")}</> : label}</span>;
}

/** One agent's turn in the meeting chat: who and how they voted, the statement in a bubble, then its evidence and rules. */
function Statement({ f, frameHref, calcRule, calcs: roundCalcs = [] }: { f: Finding; frameHref: FrameHref; calcRule: (id: string) => string; calcs?: Calc[] }) {
  const [all, setAll] = useState(false);
  // "Show all" whenever the four-line clamp actually cuts the text: it depends on the width, not the length.
  const text = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = text.current;
    if (!el || all) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [all, f.statement]);
  // One chip per calculation rule: two cable paths give two LEN calculations, read as one.
  const calcs = [...new Set(f.evidence.flatMap((e) => "calc_id" in e ? [calcRule(e.calc_id)] : []))];
  const frames = f.evidence.flatMap((e) => "calc_id" in e ? [] : [e]);
  const measured = (f.items ?? []).filter((i) => i.quantity != null); // metres, feeds, runs: the numbers a team acts on
  return (
    <article className="msg" data-finding={f.id}>
      <span className="tag" title={NAME[f.agent]}>{TAG[f.agent] ?? f.agent}</span>
      <div className="msg-body">
        <div className="msg-head">
          <b className="who">{NAME[f.agent] ?? f.agent}</b>
          <Verdict f={f} />
          {f.model && <ModelChip model={f.model} />}
          {f.fell_back && <span className="muted small">fell back</span>}
        </div>
        <div className="bubble">
          <p ref={text} className={all ? "" : "clamp"}>{f.statement}</p>
          {(clipped || all) && <button className="more-btn" onClick={() => setAll(!all)}>{all ? "Show less" : "Show all"}</button>}
        </div>
        {(() => {
          const failed = [...new Set(f.evidence.flatMap((e) => "calc_id" in e ? [e.calc_id] : []))]
            .map((id) => roundCalcs.find((c) => c.id === id)).flatMap((c) => (c && calcLine(c) ? [calcLine(c)!] : []));
          return failed.length > 0 && <div className="calc-lines"><span className="label">Calculated in code</span>{failed.map((l) => <p key={l} className="calc-line mono">{l}</p>)}</div>;
        })()}
        {f.question && (
          <div className="turn-q">
            <p><span className="label">Asks the engineer</span> {f.question.text}</p>
            {f.question.answer && <p className="turn-a"><span className="label">Engineer</span> {f.question.answer}</p>}
          </div>
        )}
        {measured.length > 0 && <div className="msg-items">{measured.map((i, k) => <span key={k} className="item-chip" title={i.text}><b className="mono">{i.quantity} {i.unit ?? ""}</b> {i.text}</span>)}</div>}
        {(calcs.length > 0 || frames.length > 0) && (
          <div className="msg-foot">
            {calcs.map((rule) => <span key={rule} className="ev muted">calc {rule}</span>)}
            {frames.map((e, k) => <a key={k} className="ev ev-frame" href={frameHref(e)} target="_blank" rel="noreferrer"><img src={frameHref(e)} alt="" loading="lazy" />frame {e.frame ?? "?"}</a>)}
          </div>
        )}
        {f.rules.map((r) => <p className="rt" key={r.id}><span className="mono">{r.id}</span> {r.text}</p>)}
      </div>
    </article>
  );
}

/** A department (or the Lead) still working: a typing bubble in the chat. */
export function Thinking({ agent, text }: { agent: string; text: string }) {
  return (
    <div className="msg thinking">
      <span className={agent === "lead" ? "tag lead" : "tag"}>{agent === "lead" ? "LEAD" : TAG[agent] ?? agent}</span>
      <div className="msg-body">
        <div className="msg-head"><ModelChip model={agent === "lead" ? "muse-wonder-1.0" : "muse-spark-open"} what="planned" /></div>
        <div className="bubble"><span className="dots" aria-hidden="true"><i /><i /><i /></span><span className="muted">{text}</span></div>
      </div>
    </div>
  );
}

export function RoundView({ r, t, frameHref, running }: { r: Round; t: Timeline; frameHref: FrameHref; running: { round: number; leadThinking: boolean } | null }) {
  const calcRule = (id: string) => r.calcs.find((c) => c.id === id)?.rule ?? "";
  const pending = running && running.round === r.round && !running.leadThinking ? t.reps.filter((a) => !r.findings.some((f) => f.agent === a)) : [];
  const log = useRef<HTMLDivElement>(null);
  const count = r.findings.length + (r.lead ? 1 : 0);
  const jump = (id: string) => {
    const el = log.current?.querySelector<HTMLElement>(`[data-finding="${id}"]`);
    if (el && log.current) log.current.scrollTo({ top: el.offsetTop - 8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  // Follow new statements and whoever is thinking while a round runs, unless the reader has scrolled up to read an
  // earlier one. Our own smooth scroll also fires scroll events on its way down; those must not count as the reader's.
  const near = useRef(true);
  const following = useRef(0);
  const thinking = pending.length + (running?.leadThinking ? 1 : 0);
  // Followed live once, it keeps following to the round's last word (the Lead's), even after the round stops running.
  const live = useRef(false);
  useEffect(() => { near.current = true; live.current = false; }, [r.round]); // a past round opens at its top
  useEffect(() => {
    const el = log.current;
    if (running) live.current = true;
    if (!el || !live.current || !near.current) return;
    // Jump, then again once late layout settles (a statement's "Show all" button, wrapped evidence), so the newest
    // turn is never left just below the fold.
    const toEnd = () => { following.current = Date.now() + 500; el.scrollTop = el.scrollHeight; };
    toEnd();
    const frame = requestAnimationFrame(toEnd);
    const late = setTimeout(toEnd, 400);
    return () => { cancelAnimationFrame(frame); clearTimeout(late); };
  }, [count, thinking, r.round, running !== null]);
  return (
    <section className="panel chat-panel" aria-label={`Round ${r.round}`}>
      {(r.findings.length > 0 || pending.length > 0) && (
        <p className="key muted">Tap a vote to read it. <b>Forced</b>: a rule the app calculated failed, so that department must object.
          {" "}<span className="mono">calc</span>: a check the app computed, not the model.</p>
      )}
      <div className="chat" key={r.round} ref={log} role="log" aria-live="off" tabIndex={0} aria-label={`Round ${r.round} statements`}
        onScroll={(e) => { const el = e.currentTarget; if (Date.now() > following.current) near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
        {r.findings.map((f) => <Statement key={f.id} f={f} frameHref={frameHref} calcRule={calcRule} calcs={r.calcs} />)}
        {pending.map((a) => <Thinking key={a} agent={a} text={`${NAME[a]} is reviewing the room`} />)}
        {r.lead ? (
          <article className="msg">
            <span className="tag lead">LEAD</span>
            <div className="msg-body">
              <div className="msg-head"><b className="who">Survey Lead</b><ModelChip model={r.lead.model} /></div>
              <p className="lead-call">{decision(r)}</p>
              <p className="rt order">Placement order: calculated rules → cooling (Cooling's call) → cost</p>
              <div className="bubble lead"><p>{r.lead.summary}</p></div>
              {r.lead.placement.target !== "none" && r.lead.placement.reason && <p className="rt clamp">Why: {r.lead.placement.reason}</p>}
              {r.lead.conflicts.length > 0 && (
                <div className="resolved"><span className="label">Resolved</span>
                  {r.lead.conflicts.map((c, k) => {
                    // The evidence the first-named department cited: its first frame, so the decision shows what it rests on.
                    const cited = r.findings.find((f) => f.agent === c.agents[0])?.evidence.find((e): e is { frame: number | null; file_id?: string } => !("calc_id" in e));
                    return (
                      <p key={k}>
                        <span className="vs">{c.agents.map((a) => { const f = r.findings.find((x) => x.agent === a);
                          return f ? <button key={a} type="button" className="tag tag-btn" onClick={() => jump(f.id)} aria-label={`Show ${NAME[a] ?? a}'s statement`}>{TAG[a] ?? a}</button> : <span key={a} className="tag">{TAG[a] ?? a}</span>; })}</span>
                        <span className="clamp">{c.resolution}</span>
                        {cited && <a className="ev-frame solo" href={frameHref(cited)} target="_blank" rel="noreferrer"><img src={frameHref(cited)} alt={`frame ${cited.frame ?? ""}`} loading="lazy" /></a>}
                      </p>
                    );
                  })}
                </div>
              )}
              {r.lead.model === "unavailable" ? <p className="rt">The Survey Lead was unavailable this round.</p>
                : r.lead.fell_back && <p className="rt">The Survey Lead ran on {r.lead.model} because Muse Wonder did not answer in time.</p>}
            </div>
          </article>
        ) : running?.round === r.round && running.leadThinking && <Thinking agent="lead" text="The Survey Lead is reading the statements" />}
      </div>
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

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
/** Two questions are the same when most of their words are (client's rack / customer's rack). */
const sameQuestion = (a: string, b: string) => {
  const x = words(a), y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared) >= 0.6;
};

/** The Lead's call in one line, the first thing a reader needs: where the device goes and what still stands against it. */
export function decision(r: Round) {
  const where = r.lead!.placement.target === "none" ? "No placement yet" : r.lead!.placement.target === "reserved" ? "Decision: a new rack position"
    : `Decision: rack ${r.lead!.placement.target.slice(5)}`;
  const against = r.findings.filter((f) => f.verdict === "object").length;
  const open = r.findings.filter((f) => f.verdict === "question").length;
  return [where, against ? `${against} objection${against > 1 ? "s" : ""} remain${against > 1 ? "" : "s"}` : "no objections",
    open ? `${open} question${open > 1 ? "s" : ""} open` : ""].filter(Boolean).join(" · ");
}

/** What the engineer is asked now: the departments' open questions, then the narrated clip's optional ones. */
export function openQuestions(t: Timeline, p: { state: string }) {
  const last = t.rounds.at(-1);
  const asked = p.state === "waiting" && last ? last.findings.filter((f) => f.question && !f.question.answer).map((f) => ({ q: f.question!, agent: f.agent })) : [];
  // The clip's optional questions are context for the meeting; once it has ended they would only be clutter,
  // and one a department asks, or already asked in an earlier round, would be the same question twice.
  const departments = t.rounds.flatMap((r) => r.findings.flatMap((f) => (f.question ? [f.question.text] : [])));
  const clip = p.state === "done" ? [] : t.request_questions.filter((q) => !q.answer && !departments.some((d) => sameQuestion(d, q.text))).map((q) => ({ q, agent: "request" }));
  return [...asked, ...clip];
}

/** Who sits at the meeting: one seat per department agent and the Survey Lead, each with the Meta model that spoke for it
 * (fallbacks shown), its verdict in the round on screen, and its verdicts across rounds. A tap jumps to its statement. */
export function Roster({ t, r, running }: { t: Timeline; r: Round | null; running: boolean }) {
  const seat = (agent: string) => r?.findings.find((f) => f.agent === agent);
  const jump = (id: string) => document.querySelector(`[data-finding="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return (
    <section className="panel roster" aria-label="Who is in the meeting">
      <h2>At the table</h2>
      <ul>
        {t.reps.map((agent) => {
          const f = seat(agent);
          return (
            <li key={agent} className={f ? `seat ${f.verdict}` : "seat"}>
              <button type="button" className="seat-btn" disabled={!f} onClick={() => f && jump(f.id)}
                aria-label={`${NAME[agent] ?? agent}: ${f ? VERDICT[f.verdict][1] : running ? "reviewing" : "no statement"}`}>
                <span className="tag">{TAG[agent] ?? agent}</span>
                <span className="seat-name"><b>{NAME[agent] ?? agent}</b>
                  <span className="seat-model">{f?.model ? <ModelChip model={f.model} /> : <ModelChip model="muse-spark-open" what={running ? "reviewing" : "planned"} />}{f?.fell_back && <span className="muted small"> fell back</span>}</span></span>
                <span className="seat-side">{f ? <Verdict f={f} /> : <span className="chip neutral">{running ? "Reviewing" : "—"}</span>}
                  <span className="track" aria-hidden="true">{verdictTrack(t.rounds, agent, MAX_ROUNDS).map((v, k) => <i key={k} className={v ?? ""} />)}</span></span>
              </button>
            </li>
          );
        })}
        <li className="seat lead">
          <div className="seat-btn">
            <span className="tag lead">LEAD</span>
            <span className="seat-name"><b>Survey Lead</b><span className="seat-model"><ModelChip model={r?.lead?.model ?? "muse-wonder-1.0"} what={r?.lead ? undefined : "planned"} />{r?.lead?.fell_back && <span className="muted small"> fell back</span>}</span></span>
            <span className="seat-side small">{r?.lead ? decision(r) : running ? "Waiting for the statements" : ""}</span>
          </div>
        </li>
      </ul>
    </section>
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
  const open = t && p ? openQuestions(t, p) : [];
  const stale = t != null && t.deliberated_layout_version != null && t.layout_version > t.deliberated_layout_version;
  const { view, tabs } = t && p ? roundsToShow(t, p, shown) : { view: null, tabs: [] };

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
        {tabs.length > 1 && (
          <div className="seg full" role="group" aria-label="Round" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
            {tabs.map((r) => <button key={r.round} type="button" aria-pressed={r.round === view?.round} onClick={() => setShown(r.round)}>Round {r.round}</button>)}
          </div>
        )}
        <div>
          {view ? <RoundView r={view} t={t!} frameHref={frameHref} running={p?.state === "running" && view === tabs.at(-1) ? p : null} />
            : t && <RoundView r={{ round: 1, findings: [], calcs: [], lead: null }} t={t} frameHref={frameHref} running={{ round: 1, leadThinking: false }} />}
        </div>
        <div className="stack meeting-side">
          {t && <Roster t={t} r={view} running={p?.state === "running" && view === tabs.at(-1)} />}
          {open.map(({ q, agent }) => <Ask key={q.id} q={q} agent={agent} value={answers[q.id] ?? ""} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />)}
        </div>
        {askPass && (open.length > 0 || stale) && (
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
