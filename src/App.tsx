import { useEffect, useState } from "react";
import { getSurvey, type Survey } from "./api";
import { Shell } from "./components/Shell";
import { DeviceStep } from "./steps/DeviceStep";
import { SurveyStep } from "./steps/SurveyStep";
import { UploadStep } from "./steps/UploadStep";

const surveyIdFromPath = () => location.pathname.match(/^\/survey\/([0-9a-f-]{36})$/)?.[1] ?? null;

export function App() {
  const [id, setId] = useState(surveyIdFromPath);
  useEffect(() => {
    const onPop = () => setId(surveyIdFromPath());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  if (!id) return <SurveyStep onCreated={(newId) => { history.pushState(null, "", `/survey/${newId}`); setId(newId); }} />;
  return <SurveyView id={id} />;
}

function SurveyView({ id }: { id: string }) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [error, setError] = useState("");
  const load = () => getSurvey(id).then(setSurvey, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [id]);

  if (survey?.status === "draft") return <DeviceStep survey={survey} onConfirmed={load} />;
  if (survey?.status === "uploading") return <UploadStep survey={survey} onStarted={load} />;
  return (
    <Shell step={survey ? 2 : 1} surveyCode={survey?.site} actions={<button className="btn btn-primary" disabled>Check the layout</button>}>
      <div className="stack narrow">
        {error && <p className="note error" role="alert">{error}</p>}
        {!survey && !error && <p className="muted">Loading survey…</p>}
        {survey && (
          <>
            <div><h1>Processing footage</h1><p className="muted">{survey.quantity} × {survey.device_model}</p></div>
            <p className="note ok">All files are in. The models read them next (finding floor tiles, racks, the panel and the path).</p>
          </>
        )}
      </div>
    </Shell>
  );
}
