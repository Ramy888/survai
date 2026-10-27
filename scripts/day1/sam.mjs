// Records one SAM 3.1 reply per concept on an anonymised key frame, to test the box parser on the real format.
import { meta, responseText, imageDataUrl, save, report } from "./lib.mjs";

const frame = "tools/prepare/out/demo-room/frames/frame-03.jpg";
for (const concept of ["floor tile", "server rack"]) {
  const body = {
    model: "sam-3.1",
    metadata: { mask_encoding: "one_bit", include_confidence: "true" },
    input: [{ role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: imageDataUrl(frame) }] }],
  };
  const { data, seconds } = await meta(body, 60_000);
  const text = responseText(data);
  const boxes = (text.match(/<\|box;[^|]*\|>/g) ?? []).length;
  const path = save(`sam-${concept.replace(" ", "-")}`, { check: "sam", frame, concept, seconds, request: body, response: data });
  report(`sam ${concept}`, boxes > 0, `${boxes} box(es), ${text.length} chars, ${seconds.toFixed(1)}s -> ${path}`);
}
