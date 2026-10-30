import type { z } from "zod";

export class BadModelAnswer extends Error {}

/** The first JSON object in a model reply, checked against a schema. */
export function parseAnswer<T>(text: string, schema: z.ZodType<T>, what: string): T {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  let json: unknown;
  try {
    json = JSON.parse(text.slice(s, e + 1));
  } catch {
    throw new BadModelAnswer(`${what}: the answer was not JSON`);
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new BadModelAnswer(`${what}: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return r.data;
}

type Models = ReturnType<typeof import("../clients/models").createModels>;
type RunArgs = Parameters<Models["run"]>;

/** Ask for JSON; a malformed or cut-off answer is retried once with the error (spec: then "unavailable"). */
export async function askJsonReply<T>(models: Models, route: RunArgs[0], prompt: RunArgs[1], schema: z.ZodType<T>, what: string, ctx?: RunArgs[2], retries = 1) {
  let reply = await models.run(route, prompt, ctx);
  for (let k = 0; ; k++) {
    try {
      return { value: parseAnswer(reply.text, schema, what), model: reply.model, fellBack: reply.fellBack };
    } catch (err) {
      if (!(err instanceof BadModelAnswer) || k >= retries) throw err;
      reply = await models.run(route, {
        ...prompt,
        text: `${prompt.text}\n\nYour previous answer could not be used (${err.message}). Reply again with only the complete JSON object, shorter if needed.`,
      }, ctx);
    }
  }
}

export const askJson = async <T>(...a: Parameters<typeof askJsonReply<T>>) => (await askJsonReply(...a)).value;
