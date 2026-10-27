import type { createModels } from "./clients/models";

/** Hono env: Worker bindings plus the per-request model client and job starter (both injectable for tests). */
export type StartProcessing = (env: Env, surveyId: string) => Promise<unknown>;
export type StartRound = (env: Env, surveyId: string, run: number, round: number) => Promise<unknown>;
export type AppEnv = { Bindings: Env; Variables: { models: ReturnType<typeof createModels>; startProcessing: StartProcessing; startRound: StartRound } };
