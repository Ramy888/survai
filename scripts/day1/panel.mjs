// Day-1 check 3: Muse Spark Open (Baseten) reads a blurred power-panel photo into breakers JSON.
import { baseten, firstJson, imageDataUrl, save, report } from "./lib.mjs";

const photos = ["PWR1", "PWR2"];
const prompt =
  "Photo of a power distribution box in a telecom equipment room. Count every breaker module you can see, even when " +
  "its rating is unreadable (paper labels are blurred on purpose; that is expected). Give each one a position from " +
  "left to right per row, and set rating_a to null when you cannot read it. Reply with only " +
  'JSON: {"boxes": [{"breakers": [{"position": number, "kind": "MCB|MCCB|RCD|isolator|unknown", "poles": number|null, ' +
  '"rating_a": number|null, "curve": "B|C|D|null", "dc": true|false|null, "looks_free": true|false|null}]}], ' +
  '"free_breakers": number|null, "readable": "all|some|none", "notes": "one sentence"}. Use null when you cannot read it.';

// Spark Open is the department agents' model; Spark 1.3 (Meta) is its fallback, so both are recorded.
async function spark13(body) {
  const { meta, responseText } = await import("./lib.mjs");
  const [text, image] = body.messages[0].content;
  const { data, seconds } = await meta({ model: "muse-spark-1.3", reasoning: { effort: "low" }, input: [{ role: "user", content: [
    { type: "input_text", text: text.text }, { type: "input_image", image_url: image.image_url.url }] }] });
  return { data, seconds, content: responseText(data) };
}

for (const name of photos) for (const model of ["spark-open", "spark-1.3"]) {
  const body = {
    model: "meta-models/muse-spark-open-1026",
    max_tokens: 12000,
    messages: [{ role: "user", content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: imageDataUrl(`tools/prepare/out/demo-room/photos/${name}.jpg`) } },
    ] }],
  };
  const r = model === "spark-open" ? await baseten(body) : await spark13(body);
  const { data, seconds } = r;
  const reply = r.content ?? data.choices[0].message.content;
  let parsed;
  try {
    parsed = firstJson(reply);
  } catch {
    parsed = { boxes: [], refused: true, reply: (reply ?? "").slice(0, 500) };  // a refusal is a result too
  }
  const breakers = (parsed.boxes ?? []).flatMap((b) => b.breakers ?? []);
  const rated = breakers.filter((b) => typeof b.rating_a === "number");
  const path = save(`panel-${name.toLowerCase()}-${model}`, { check: "panel", photo: `${name}.jpg`, seconds, request: body, response: data, parsed });
  report(`panel ${name} ${model}`, breakers.length > 0 && breakers.every((b) => "kind" in b && "rating_a" in b),
    `${breakers.length} breaker(s), ${rated.length} with a rating, free=${parsed.free_breakers}, readable=${parsed.readable}, ${seconds.toFixed(1)}s -> ${path}`);
}
