import { Hono } from "hono";
import { BudgetExceeded, createModels } from "./clients/models";
import { deliberate } from "./routes/deliberate";
import { device } from "./routes/device";
import { startRoundWorkflow } from "./workflows/round";
import { files } from "./routes/files";
import { layout } from "./routes/layout";
import { surveys } from "./routes/surveys";
import { StateConflict } from "./state";
import type { AppEnv, StartProcessing, StartRound } from "./types";

export { ProcessSurvey } from "./workflows/process";
export { MeetingRound } from "./workflows/round";

// One instance per processing attempt: a survey can return to uploading and be processed again.
const startWorkflow: StartProcessing = (env, surveyId) => env.PROCESS.create({ id: `${surveyId}-${Date.now()}`, params: { surveyId } });

/** The Worker app; tests pass a fake fetch, sleep and job starter so nothing reaches a live API. */
export function createApp(deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; startProcessing?: StartProcessing; startRound?: StartRound } = {}) {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    c.set("models", createModels({ env: c.env, fetch: deps.fetch, sleep: deps.sleep }));
    c.set("startProcessing", deps.startProcessing ?? startWorkflow);
    c.set("startRound", deps.startRound ?? startRoundWorkflow);
    await next();
    c.header("Referrer-Policy", "no-referrer");
  });

  app.get("/api/health", async (c) => {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ ok: true });
  });
  app.route("/api/surveys", surveys);
  app.route("/api/surveys", device);
  app.route("/api/surveys", files);
  app.route("/api/surveys", deliberate);
  app.route("/api/surveys", layout);

  app.onError((err, c) => {
    if (err instanceof StateConflict) return c.json({ error: err.message, state: err.state }, 409);
    if (err instanceof BudgetExceeded) return c.json({ error: err.message }, 429);
    console.error(JSON.stringify({ evt: "error", path: c.req.path, message: err.message }));
    return c.json({ error: "Something went wrong" }, 500);
  });
  return app;
}

export default createApp();
