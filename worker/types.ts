import type { createModels } from "./clients/models";

/** Hono env: Worker bindings plus the per-request model client and job starter (both injectable for tests). */
export type StartProcessing = (env: Env, surveyId: string) => Promise<unknown>;
export type StartRound = (env: Env, surveyId: string, run: number, round: number) => Promise<unknown>;
// JUDGE_PASSCODE is an optional secret: a second passcode for the judges' link, capped at a few new surveys a day.
export type AppEnv = { Bindings: Env & { JUDGE_PASSCODE?: string }; Variables: { models: ReturnType<typeof createModels>; startProcessing: StartProcessing; startRound: StartRound; judge?: boolean } };
