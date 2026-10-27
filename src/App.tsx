import { useEffect, useState } from "react";
import { getSurvey, type Survey } from "./api";
import { Shell } from "./components/Shell";
import { SurveyStep } from "./steps/SurveyStep";

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
  useEffect(() => { getSurvey(id).then(setSurvey, (e: Error) => setError(e.message)); }, [id]);

  return (
    <Shell step={1} surveyCode={survey?.site} actions={<button className="btn btn-primary" disabled>Confirm device</button>}>
      <div className="stack narrow">
        {error && <p className="note error" role="alert">{error}</p>}
        {!survey && !error && <p className="muted">Loading survey…</p>}
        {survey && (
          <>
            <div><h1>Survey created</h1><p className="muted">{survey.project} · {survey.quantity} × {survey.device_model}</p></div>
            <p className="note ok">Saved. Device confirmation and upload come next.</p>
          </>
        )}
      </div>
    </Shell>
  );
}
