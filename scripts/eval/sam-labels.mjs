// Accuracy check: which labels, stickers and taped sheets Meta SAM 3.1 finds on the sample's key frames (the in-app
// blur keeps boxes at confidence >= 0.4, like worker/routes/redact.ts). Boxes are written to docs/eval/; a person then
// marks each box right or wrong and counts the labels SAM missed (docs/eval/accuracy.md).
// Usage: node --env-file=.env scripts/eval/sam-labels.mjs <frames-dir> <frame numbers...>
// Each frame is asked for every concept, so concept sets can be compared on the same frames.
import { mkdirSync, writeFileSync } from "node:fs";
import { imageDataUrl, meta, responseText } from "../day1/lib.mjs";

const [dir, ...nums] = process.argv.slice(2);
const CONCEPTS = ["label", "paper", "sticker"];
const out = {};
for (const n of nums) for (const concept of CONCEPTS) {
  const frame = `${dir}/frame-${String(n).padStart(2, "0")}.jpg`;
  const { data } = await meta({
    model: "sam-3.1",
    metadata: { mask_encoding: "one_bit", include_confidence: "true" },
    input: [{ role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: imageDataUrl(frame) }] }],
  }, 60_000);
  const boxes = [...responseText(data).matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=\d+;h=\d+;c=([\d.]+)\|>/g)]
    .map((m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], c: +m[5] })).filter((b) => b.c >= 0.4);
  (out[n] ??= {})[concept] = boxes;
  console.log(`frame ${n} ${concept}: ${boxes.length} boxes`);
}
mkdirSync("docs/eval", { recursive: true });
writeFileSync("docs/eval/sam-labels.json", JSON.stringify(out, null, 1) + "\n");
