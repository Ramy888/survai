import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createModels } from "../clients/models";
import { type StartRound, runRound } from "../meeting";

/** Round ids are {survey}-run{n}-r{m}: starting a round twice finds the existing instance and does nothing. */
export const startRoundWorkflow: StartRound = async (env, surveyId, run, round) => {
  try {
    await env.ROUND.create({ id: `${surveyId}-run${run}-r${round}`, params: { surveyId, run, round } });
  } catch (err) {
    if (!/already exists|duplicate/i.test((err as Error).message)) throw err;
  }
};

export class MeetingRound extends WorkflowEntrypoint<Env, { surveyId: string; run: number; round: number }> {
  async run(event: WorkflowEvent<{ surveyId: string; run: number; round: number }>, step: WorkflowStep) {
    const { surveyId, run, round } = event.payload;
    await runRound({ env: this.env, models: createModels({ env: this.env }), step, startRound: startRoundWorkflow }, surveyId, run, round);
  }
}
