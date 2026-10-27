// Model calls: Meta Model API (Muse Spark 1.3, Muse Wonder, SAM 3.1) and Baseten (Muse Spark Open).
// Each attempt takes from the daily cap first; 429/5xx retry with 1-2-4 s backoff; a route falls back to its next
// model on timeout, rate limit or refusal. A 4xx other than 429 is a bug in the request and is never retried.
import { BudgetExceeded, takeBudget } from "./budget";

export { BudgetExceeded };

export class ModelError extends Error {
  constructor(message: string, readonly model: ModelId) {
    super(`${model}: ${message}`);
  }
}
export class ModelTimeout extends ModelError {}
export class ModelRateLimited extends ModelError {}
export class ModelRefusal extends ModelError {}
export class ModelRequestError extends ModelError {}
export class SamUnavailable extends ModelError {}

export type ModelId = "muse-spark-open" | "muse-spark-1.3" | "muse-wonder-1.0" | "sam-3.1";

export const ROUTES = {
  agent: ["muse-spark-open", "muse-spark-1.3"],
  lead: ["muse-wonder-1.0", "muse-spark-1.3"],
  reader: ["muse-spark-1.3"],
  panel: ["muse-spark-1.3"], // Day-1: Spark Open refused a panel photo
  datasheet: ["muse-spark-1.3"],
} as const satisfies Record<string, readonly ModelId[]>;
export type Route = keyof typeof ROUTES;

export interface Prompt {
  text: string;
  images?: string[]; // data: or https: URLs
  reasoning?: "minimal" | "low" | "medium" | "high";
  webSearch?: boolean;
  maxTokens?: number;
}
export interface Reply {
  text: string;
  model: ModelId;
  fellBack: boolean;
  raw: unknown;
}
export interface LogContext {
  survey?: string;
  round?: number;
  agent?: string;
}
export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c?: number;
}

const META_URL = "https://api.meta.ai/v1/responses";
const BASETEN_URL = "https://inference.baseten.co/v1/chat/completions";
const BASETEN_MODEL = "meta-models/muse-spark-open-1026";
const BACKOFF_MS = [1000, 2000, 4000];
// Wonder gets no timeout retry: the spec gives the Lead 20 s before Spark 1.3 takes over.
const LIMITS: Record<ModelId, { timeoutMs: number; timeoutRetries: number }> = {
  "muse-spark-open": { timeoutMs: 60_000, timeoutRetries: 1 },
  "muse-spark-1.3": { timeoutMs: 60_000, timeoutRetries: 1 },
  "muse-wonder-1.0": { timeoutMs: 20_000, timeoutRetries: 0 },
  "sam-3.1": { timeoutMs: 30_000, timeoutRetries: 1 },
};
const WEB_SEARCH_TIMEOUT_MS = 120_000; // Day-1: an MX104 lookup took 35 s across ~20 searches

interface Deps {
  env: Env;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (record: Record<string, unknown>) => void;
}

export function createModels({ env, fetch: doFetch = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (r) => console.log(JSON.stringify(r)) }: Deps) {
  async function post(model: ModelId, body: object, ctx: LogContext, timeoutMs: number): Promise<unknown> {
    const sam = model === "sam-3.1";
    const [url, key] = model === "muse-spark-open" ? [BASETEN_URL, env.BASETEN_API_KEY] : [META_URL, env.META_MODEL_API_KEY];
    const cap = Number(sam ? env.SAM_DAILY_CAP : env.MODEL_DAILY_CAP);
    let busy = 0;
    let timeouts = 0;
    for (let attempt = 1; ; attempt++) {
      await takeBudget(env.DB, sam ? "sam" : "model", cap);
      const t0 = Date.now();
      let status = 0;
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = res.status;
        log({ evt: "model_call", model, attempt, status, ms: Date.now() - t0, ...ctx });
        if (res.ok) return await res.json();
        const detail = (await res.text()).slice(0, 300);
        if (status !== 429 && status < 500) throw new ModelRequestError(`HTTP ${status} ${detail}`, model);
        if (busy === BACKOFF_MS.length) {
          throw sam ? new SamUnavailable(`HTTP ${status} after retries`, model) : new ModelRateLimited(`HTTP ${status} after retries`, model);
        }
        await sleep(BACKOFF_MS[busy++]);
      } catch (err) {
        if (!(err instanceof DOMException) || (err.name !== "TimeoutError" && err.name !== "AbortError")) throw err;
        log({ evt: "model_call", model, attempt, status: "timeout", ms: Date.now() - t0, ...ctx });
        if (timeouts++ === LIMITS[model].timeoutRetries) {
          throw sam ? new SamUnavailable("timed out", model) : new ModelTimeout(`no reply in ${timeoutMs / 1000} s`, model);
        }
      }
    }
  }

  async function callModel(model: Exclude<ModelId, "sam-3.1">, p: Prompt, ctx: LogContext): Promise<Omit<Reply, "fellBack">> {
    const images = p.images ?? [];
    const timeoutMs = p.webSearch ? WEB_SEARCH_TIMEOUT_MS : LIMITS[model].timeoutMs;
    let raw: unknown;
    let text: string;
    if (model === "muse-spark-open") {
      raw = await post(model, {
        model: BASETEN_MODEL,
        max_tokens: p.maxTokens ?? 12_000, // Day-1: 3,000 left no room for the answer after reasoning
        messages: [{ role: "user", content: [{ type: "text", text: p.text }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] }],
      }, ctx, timeoutMs);
      text = (raw as { choices?: { message?: { content?: string | null } }[] }).choices?.[0]?.message?.content ?? "";
    } else {
      raw = await post(model, {
        model,
        reasoning: { effort: p.reasoning ?? "low" },
        ...(p.webSearch ? { tools: [{ type: "web_search" }] } : {}),
        input: [{ role: "user", content: [{ type: "input_text", text: p.text }, ...images.map((image_url) => ({ type: "input_image", image_url }))] }],
      }, ctx, timeoutMs);
      text = lastMessageText(raw);
    }
    if (!text.trim()) throw new ModelRefusal("empty reply", model);
    return { text, model, raw };
  }

  return {
    /** Runs a prompt on its route's models in order; the reply says which model answered. */
    async run(route: Route, prompt: Prompt, ctx: LogContext = {}): Promise<Reply> {
      const chain = ROUTES[route];
      for (let i = 0; ; i++) {
        try {
          return { ...(await callModel(chain[i], prompt, ctx)), fellBack: i > 0 };
        } catch (err) {
          const retryable = err instanceof ModelTimeout || err instanceof ModelRateLimited || err instanceof ModelRefusal;
          if (!retryable || i === chain.length - 1) throw err;
          log({ evt: "model_fallback", route, from: chain[i], to: chain[i + 1], reason: err.constructor.name, ...ctx });
        }
      }
    },

    /** SAM 3.1 boxes for one concept on one image; no match is an empty result. */
    async segment(image: string, concept: string, ctx: LogContext = {}) {
      const raw = await post("sam-3.1", {
        model: "sam-3.1",
        metadata: { mask_encoding: "one_bit", include_confidence: "true" },
        input: [{ role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: image }] }],
      }, ctx, LIMITS["sam-3.1"].timeoutMs);
      return parseSamBoxes(lastMessageText(raw));
    },
  };
}

/** Text of the final message (web-search runs emit several messages; earlier ones are progress notes). */
function lastMessageText(raw: unknown): string {
  const output = (raw as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] }).output ?? [];
  const last = output.filter((o) => o.type === "message").at(-1);
  return (last?.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
}

/** SAM records look like `<|box;x1=455;y1=448;x2=477;y2=465;w=478;h=850;c=0.67|><|mask;...|>`. */
export function parseSamBoxes(text: string): { boxes: SamBox[]; width: number; height: number } {
  let width = 0;
  let height = 0;
  const boxes = [...text.matchAll(/<\|box;([^|]*)\|>/g)].map((m) => {
    const f = Object.fromEntries(m[1].split(";").map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
    width = f.w;
    height = f.h;
    return { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, ...(f.c === undefined ? {} : { c: f.c }) };
  });
  return { boxes, width, height };
}
