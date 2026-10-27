import { Hono } from "hono";
import { surveys } from "./routes/surveys";
import { StateConflict } from "./state";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Referrer-Policy", "no-referrer");
});

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});
app.route("/api/surveys", surveys);

app.onError((err, c) => {
  if (err instanceof StateConflict) return c.json({ error: err.message, state: err.state }, 409);
  console.error(JSON.stringify({ evt: "error", path: c.req.path, message: err.message }));
  return c.json({ error: "Something went wrong" }, 500);
});

export default app;
