import type { z } from "zod";
import { ROUTES } from "../clients/models";

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

/** Ask for JSON; a malformed or cut-off answer goes back to the model that wrote it with the error, `retries` times,
 * then to the route's next model (spec: then "unavailable"). A timeout or error already falls back inside run(). */
export async function askJsonReply<T>(models: Models, route: RunArgs[0], prompt: RunArgs[1], schema: z.ZodType<T>, what: string, ctx?: RunArgs[2], retries = 1) {
  const chain: readonly string[] = ROUTES[route];
  let reply = await models.run(route, prompt, ctx);
  for (let k = 0; ; k++) {
    try {
      return { value: parseAnswer(reply.text, schema, what), model: reply.model, fellBack: reply.fellBack };
    } catch (err) {
      if (!(err instanceof BadModelAnswer)) throw err;
      const at = Math.max(0, chain.indexOf(reply.model));
      const next = k < retries ? at : at + 1;
      if (next >= chain.length) throw err;
      if (next > at) k = -1; // the next model gets its own retries
      reply = await models.run(route, {
        ...prompt,
        text: `${prompt.text}\n\nYour previous answer could not be used (${err.message}). Reply again with only the complete JSON object, shorter if needed.`,
      }, ctx, next);
    }
  }
}

export const askJson = async <T>(...a: Parameters<typeof askJsonReply<T>>) => (await askJsonReply(...a)).value;
