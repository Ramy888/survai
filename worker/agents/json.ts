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
export async function askJson<T>(models: Models, route: RunArgs[0], prompt: RunArgs[1], schema: z.ZodType<T>, what: string, ctx?: RunArgs[2]): Promise<T> {
  const first = await models.run(route, prompt, ctx);
  try {
    return parseAnswer(first.text, schema, what);
  } catch (err) {
    if (!(err instanceof BadModelAnswer)) throw err;
    const retry = await models.run(route, {
      ...prompt,
      text: `${prompt.text}\n\nYour previous answer could not be used (${err.message}). Reply again with only the complete JSON object, shorter if needed.`,
    }, ctx);
    return parseAnswer(retry.text, schema, what);
  }
}
