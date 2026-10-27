import { Hono } from "hono";
import { BudgetExceeded, createModels } from "./clients/models";
import { device } from "./routes/device";
import { surveys } from "./routes/surveys";
import { StateConflict } from "./state";
import type { AppEnv } from "./types";

/** The Worker app; tests pass a fake fetch and sleep so model calls replay recorded responses. */
export function createApp(deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    c.set("models", createModels({ env: c.env, fetch: deps.fetch, sleep: deps.sleep }));
    await next();
    c.header("Referrer-Policy", "no-referrer");
  });

  app.get("/api/health", async (c) => {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ ok: true });
  });
  app.route("/api/surveys", surveys);
  app.route("/api/surveys", device);

  app.onError((err, c) => {
    if (err instanceof StateConflict) return c.json({ error: err.message, state: err.state }, 409);
    if (err instanceof BudgetExceeded) return c.json({ error: err.message }, 429);
    console.error(JSON.stringify({ evt: "error", path: c.req.path, message: err.message }));
    return c.json({ error: "Something went wrong" }, 500);
  });
  return app;
}

export default createApp();
