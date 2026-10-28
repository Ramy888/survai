import { useEffect, useState } from "react";
import { getSurvey, type Survey } from "./api";
import { ModelChip } from "./components/Footage";
import { Shell } from "./components/Shell";
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

function SurveyView({ id }: { id: string }) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"meeting" | "layout" | "approve">("meeting");
  const load = () => getSurvey(id).then(setSurvey, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [id]);
  // Processing runs in the background (about a minute); check every 2 s until it moves on.
  useEffect(() => {
    if (survey?.status !== "processing") return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [survey?.status]);

  if (survey?.status === "draft") return <DeviceStep survey={survey} onConfirmed={load} />;
  if (survey?.status === "uploading") return <UploadStep survey={survey} onStarted={load} />;
  const meeting = survey?.status === "deliberating";
  if (survey?.status === "layout_review" || (meeting && view === "layout")) return <LayoutStep survey={survey} onSaved={() => { setView("meeting"); void load(); }} onBack={meeting ? () => setView("meeting") : undefined} />;
  if (meeting && view === "approve") return <ApproveStep survey={survey} onBack={() => setView("meeting")} onApproved={() => { location.assign(`/survey/${id}/report`); }} />;
  if (meeting) return <MeetingStep survey={survey} onEditLayout={() => setView("layout")} onApprove={() => setView("approve")} />;
  // Approved is terminal in v1: the report is the survey from here on.
  if (survey?.status === "approved") { location.replace(`/survey/${id}/report`); return null; }
  return (
    <Shell step={survey?.status === "processing" ? 2 : survey ? 3 : 1} surveyCode={survey?.site} actions={<button className="btn btn-primary" disabled>Layout is right, start meeting</button>}>
      <div className="stack narrow">
        {error && <p className="note error" role="alert">{error}</p>}
        {!survey && !error && <p className="muted">Loading survey…</p>}
        {survey && (
          <>
            {survey.status === "processing" ? (
              <>
                <div><h1>Processing footage</h1><p className="muted">{survey.quantity} × {survey.device_model}</p></div>
                <p className="loading" aria-live="polite"><span className="spin" aria-hidden="true" />About a minute. The models are working on your footage:</p>
                <ul className="stages">
                  <li>Racks and floor tiles in every key frame <ModelChip model="sam-3.1" /></li>
                  <li>The room drafted from the frames <ModelChip model="Muse Spark" /></li>
                  <li>The power panel photos read <ModelChip model="muse-spark-1.3" /></li>
                  <li>The narrated path clip transcribed and translated <ModelChip model="muse-spark-1.3" /></li>
                </ul>
              </>
            ) : (
              <>
                <div><h1>{survey.status === "layout_review" ? "Check the layout" : "The meeting"}</h1><p className="muted">{survey.quantity} × {survey.device_model}</p></div>
                <p className="note ok">{survey.status === "layout_review" ? "The draft layout is ready. The layout screen comes next." : "The departments are meeting. The meeting screen comes next."}</p>
                <a className="btn btn-secondary" href={`/survey/${survey.id}/report`}>Open the report</a>
              </>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
