import { useEffect, useState } from "react";
import { getSurvey, type Survey } from "./api";
import { ModelChip } from "./components/Footage";
import { Shell, StepNav } from "./components/Shell";
import { DeviceStep } from "./steps/DeviceStep";
import { SurveyStep } from "./steps/SurveyStep";
import { UploadStep } from "./steps/UploadStep";
import { LayoutStep } from "./steps/LayoutStep";
import { MeetingStep } from "./steps/MeetingStep";
import { ApproveStep } from "./steps/ApproveStep";
import { ReportPage } from "./report/ReportPage";
import { Signoff } from "./signoff/Signoff";
import { Replay } from "./replay/Replay";

const surveyIdFromPath = () => location.pathname.match(/^\/survey\/([0-9a-f-]{36})(\/report)?$/)?.[1] ?? null;
const isReport = () => location.pathname.endsWith("/report");

export function App() {
  const [id, setId] = useState(surveyIdFromPath);
  useEffect(() => {
    const onPop = () => setId(surveyIdFromPath());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  // Department links keep the token in the fragment, so it never reaches a server log or a Referer.
  if (location.pathname === "/s") return <Signoff token={location.hash.slice(1)} />;
  const replay = location.pathname.match(/^\/replay\/([a-z0-9-]{1,40})$/)?.[1];
  if (replay) return <Replay slug={replay} />;
  if (id && isReport()) return <ReportPage id={id} />;
  if (!id) return <SurveyStep onCreated={(newId) => { history.pushState(null, "", `/survey/${newId}`); setId(newId); }} />;
  return <SurveyView id={id} />;
}

const STEP_OF: Record<string, number> = { draft: 1, uploading: 2, processing: 2, layout_review: 3, deliberating: 4 };
const BACK: Record<string, string> = { uploading: "Back to upload", processing: "Back to processing", layout_review: "Back to the layout", deliberating: "Back to the meeting" };

function SurveyView({ id }: { id: string }) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<number | null>(null); // a step the engineer went back to; null = where the survey is
  const [visited, setVisited] = useState<number[]>([]);
  const [saves, setSaves] = useState(0); // a layout save makes the open meeting and approve views stale
  const load = () => getSurvey(id).then(setSurvey, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [id]);
  // Processing runs in the background (about a minute); check every 2 s until it moves on.
  useEffect(() => {
    if (survey?.status !== "processing") return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [survey?.status]);

  const status = survey?.status ?? "";
  const reached = STEP_OF[status] ?? 0;
  const active = chosen ?? reached;
  // The survey moved on: show where it is now and drop the kept views, which hold the old state.
  useEffect(() => { setChosen(null); setVisited([]); }, [status]);
  // Steps already opened stay mounted (hidden), so what was typed there is still there on the way back.
  useEffect(() => {
    if (active) setVisited((v) => (v.includes(active) ? v : [...v, active]));
    scrollTo(0, 0);
  }, [active]);

  // Approved is terminal in v1: the report is the survey from here on.
  if (status === "approved") { location.replace(`/survey/${id}/report`); return null; }
  if (!survey || !reached) {
    return (
      <Shell step={1} actions={null}>
        <div className="stack narrow">
          {error ? <p className="note error" role="alert">{error}</p> : <p className="muted">Loading survey…</p>}
        </div>
      </Shell>
    );
  }

  const back = { label: BACK[status] ?? "Back", go: () => setChosen(null) };
  const step = (n: number) => {
    switch (n) {
      case 1: return <DeviceStep survey={survey} onConfirmed={load} back={back} />;
      case 2: return status === "processing" ? <Processing survey={survey} /> : <UploadStep survey={survey} onStarted={load} back={back} />;
      case 3: return <LayoutStep key={`layout-${saves}`} survey={survey} onSaved={() => { setSaves((k) => k + 1); setChosen(null); void load(); }}
        onBack={status === "deliberating" ? () => setChosen(null) : undefined} />;
      case 4: return <MeetingStep key={`meeting-${saves}`} survey={survey} onEditLayout={() => setChosen(3)} onApprove={() => setChosen(5)} />;
      default: return <ApproveStep key={`approve-${saves}`} survey={survey} onBack={() => setChosen(null)} onApproved={() => { location.assign(`/survey/${id}/report`); }} />;
    }
  };
  // The shown step first, so its ids (the passcode field, headings) are the ones labels and links find.
  const order = [active, ...visited.filter((n) => n !== active)];
  return (
    <StepNav.Provider value={{ reached, go: (n) => setChosen(n === reached ? null : n) }}>
      {order.map((n) => <div key={n} hidden={n !== active}>{step(n)}</div>)}
    </StepNav.Provider>
  );
}

function Processing({ survey }: { survey: Survey }) {
  return (
    <Shell step={2} surveyCode={survey.site} actions={<button className="btn btn-primary" disabled>Layout is right, start meeting</button>}>
      <div className="stack narrow">
        <div><h1>Processing footage</h1><p className="muted">{survey.quantity} × {survey.device_model}</p></div>
        <p className="loading" aria-live="polite"><span className="spin" aria-hidden="true" />About a minute. The models are working on your footage:</p>
        <ul className="stages">
          <li>Racks and floor tiles in every key frame <ModelChip model="sam-3.1" /></li>
          <li>The room drafted from the frames <ModelChip model="Muse Spark" /></li>
          <li>The power panel photos read <ModelChip model="muse-spark-1.3" /></li>
          <li>The narrated path clip transcribed and translated <ModelChip model="muse-spark-1.3" /></li>
        </ul>
      </div>
    </Shell>
  );
}
