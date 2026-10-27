import type { createModels } from "./clients/models";

/** Hono env: Worker bindings plus the per-request model client (injectable for tests). */
export type AppEnv = { Bindings: Env; Variables: { models: ReturnType<typeof createModels> } };
