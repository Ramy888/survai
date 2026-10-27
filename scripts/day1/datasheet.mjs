// Day-1 check 5: Spark 1.3 with web search returns U and W for the demo device, with a cited source.
import { meta, responseText, firstJson, save, report } from "./lib.mjs";

const device = "Juniper MX104";
const body = {
  model: "muse-spark-1.3",
  reasoning: { effort: "low" },
  tools: [{ type: "web_search" }],
  input:
    `Look up the official datasheet or hardware guide for the ${device} router. Reply with only a JSON object: ` +
    `{"height_u": number, "depth_mm": number, "power_w_typical": number|null, "power_w_max": number, ` +
    `"feed_types": ["AC"|"DC"], "feed_count": number, "breaker_rating_a": number|null, "airflow": string, ` +
    `"weight_kg": number, "sources": [{"url": string, "title": string}]}. Use null when the source does not say.`,
};
const { data, seconds } = await meta(body);
const text = responseText(data);
const spec = firstJson(text);
const urls = [
  ...(spec.sources ?? []).map((s) => s.url),
  ...(data.output ?? []).flatMap((o) => o.content ?? []).flatMap((c) => c.annotations ?? []).map((a) => a.url).filter(Boolean),
];
const path = save("datasheet-mx104", { check: "datasheet", device, seconds, request: body, response: data, parsed: spec });
const ok = typeof spec.height_u === "number" && typeof spec.power_w_max === "number" && urls.some((u) => /^https?:\/\//.test(u));
report("datasheet", ok, `${device}: ${spec.height_u}U, ${spec.power_w_max} W max, ${urls.length} citation(s), ${seconds.toFixed(1)}s -> ${path}`);
