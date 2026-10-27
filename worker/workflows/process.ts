import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createModels } from "../clients/models";
import { runProcessing } from "../processing";

export class ProcessSurvey extends WorkflowEntrypoint<Env, { surveyId: string }> {
  async run(event: WorkflowEvent<{ surveyId: string }>, step: WorkflowStep) {
    await runProcessing({ env: this.env, models: createModels({ env: this.env }), step }, event.payload.surveyId);
  }
}
