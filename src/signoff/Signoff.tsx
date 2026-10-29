// The page a department representative opens from their link (/s#<token>): their agent's statement, items and
// evidence, then one decision. No stepper: this is not the engineer's flow.
import { useEffect, useState } from "react";
import { getSignoff, sendSignoff, signoffFrame, type SignoffPage } from "../api";

const NAME: Record<string, string> = { space: "Space", power: "Power", cooling: "Cooling", execution: "Execution", transmission: "Transmission", room_manager: "Room Manager" };
const VERDICT: Record<string, [string, string]> = { approve: ["ok", "Approve"], object: ["no", "Object"], question: ["q", "Question"], unavailable: ["neutral", "Unavailable"] };

function Frame({ token, n }: { token: string; n: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    signoffFrame(token, n).then((u) => setSrc((url = u)), () => setSrc(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [token, n]);
  return src ? <img className="evidence" src={src} alt={`Evidence frame ${n}`} /> : <div className="evidence muted">Frame {n}</div>;
}

export function Signoff({ token }: { token: string }) {
  const [p, setP] = useState<SignoffPage | null>(null);
  const [error, setError] = useState(token ? "" : "This link is incomplete. Open the full link you were sent, or ask the engineer who sent it for a new one.");
  const [name, setName] = useState("");
  const [decision, setDecision] = useState<"approve" | "object" | "">("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => getSignoff(token).then(setP, (e: Error) => setError(e.message));
  useEffect(() => { if (token) void load(); }, [token]);

  async function send() {
    if (!decision) return;
    setBusy(true); setError("");
    try { await sendSignoff(token, { rep_name: name, decision, comment }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); await load(); }
  }

  const ready = name.trim() && decision && (decision === "approve" || comment.trim());
  const dept = p ? NAME[p.agent] ?? p.agent : "";
  const [cls, label] = VERDICT[p?.verdict ?? "approve"];
  return (
    <>
      <header className="top"><div className="wrap bar"><span className="brand">Surv<b>AI</b></span><span className="mono muted">Sign-off</span></div></header>
      <main className="wrap stack narrow signoff">
        {!p && !error && <p className="muted">Loading…</p>}
        {p && (
          <>
            <div>
              <h1>{dept} sign-off</h1>
              <p className="muted">{p.site} · {p.project} · {p.device}</p>
            </div>
            <section className="panel" aria-label={`${dept} agent statement`}>
              <div className="meta"><span className={`chip ${cls}`}>{p.forced_rules.length && p.verdict === "object" ? `Forced · ${p.forced_rules.join(", ")}` : label}</span><span className="muted">{dept} agent</span></div>
              <p style={{ marginTop: 8 }}>{p.statement}</p>
              {p.rules.map((r) => <p className="rt" key={r.id}><span className="mono">{r.id}</span> {r.text}</p>)}
              {p.override_reason && <p className="note warn" style={{ marginTop: 10 }}>The engineer overrode this objection: {p.override_reason}</p>}
            </section>
            {p.items.length > 0 && (
              <section className="panel" aria-label="Items">
                <h2>Items</h2>
                <ul className="items">{p.items.map((i, k) => <li key={k}>{i.text}{i.quantity != null && <span className="mono muted"> · {i.quantity}{i.unit ? ` ${i.unit}` : ""}</span>}</li>)}</ul>
              </section>
            )}
            {p.frames > 0 && (
              <section className="panel" aria-label="Evidence">
                <h2>Evidence</h2>
                <div className="frames">{Array.from({ length: p.frames }, (_, k) => <Frame key={k} token={token} n={k + 1} />)}</div>
              </section>
            )}
            {p.decision ? (
              <p className={`note ${p.decision.decision === "approve" ? "ok" : "error"}`}>
                {p.decision.rep_name} {p.decision.decision === "approve" ? "approved" : "objected"} on {p.decision.decided_at.slice(0, 10)}{p.decision.comment ? `: ${p.decision.comment}` : "."}
              </p>
            ) : (
              <section className="panel fields" aria-label="Your decision">
                <div className="field"><label htmlFor="rep">Your name</label><input id="rep" maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="seg" role="group" aria-label="Decision">
                  <button type="button" aria-pressed={decision === "approve"} onClick={() => setDecision("approve")}>Approve</button>
                  <button type="button" aria-pressed={decision === "object"} onClick={() => setDecision("object")}>Object</button>
                </div>
                <div className="field"><label htmlFor="why">{decision === "object" ? "Why you object" : "Comment (optional)"}</label>
                  <textarea id="why" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
                <button className="btn btn-primary" disabled={!ready || busy} onClick={send}>{busy ? "Sending…" : decision === "object" ? "Send objection" : "Send approval"}</button>
                <p className="muted small">One decision per link. It goes into the survey report.</p>
              </section>
            )}
          </>
        )}
        {error && <p className="note error" role="alert">{error}</p>}
      </main>
    </>
  );
}
