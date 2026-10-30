// protects: the in-app walk-through picks frames exactly like tools/prepare (cases ported from
// tools/prepare/test_prepare.py) and scores sharpness the same way; fails_when: picks bunch up, break the 1 s gap,
// ignore a segment's sharpest frame, or a flat image scores as sharp; no_claim: video decoding in a real browser
// (checked end to end with headless Chrome).
// Type-checked with the app (browser) config, not the Worker one.
import { describe, expect, it } from "vitest";
import { coverage, padBox, scaleBoxes } from "../src/footage/blur";
import { peaks } from "../src/footage/narration";
import { pickSharpest, sharpness } from "../src/footage/pick";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { FrameStrip } from "../src/components/Footage";
import { footageNote } from "../src/replay/Replay";

describe("pickSharpest (same rule as tools/prepare)", () => {
  it("spreads 30 picks across the whole clip, sorted and at least 1 s apart", () => {
    const times = Array.from({ length: 600 }, (_, i) => i * 0.2); // 120 s at 5 fps
    const scores = times.map((_, i) => (i * 37) % 101);
    const picked = pickSharpest(times, scores, 30, 1.0);
    expect(picked).toHaveLength(30);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    expect(picked.slice(1).every((t, k) => t - picked[k] >= 1.0)).toBe(true);
    expect(picked.at(-1)! - picked[0]).toBeGreaterThan(100);
  });

  it("takes the sharpest frame in each segment", () => {
    expect(pickSharpest([0, 1, 2, 3, 4, 5], [1, 9, 2, 3, 8, 1], 2, 1.0)).toEqual([1, 4]);
  });

  it("replaces an excluded frame with the next sharpest in its segment", () => {
    expect(pickSharpest([0, 1, 2, 3, 4, 5], [1, 9, 2, 3, 8, 1], 2, 1.0, new Set([1]))).toEqual([2, 4]);
  });

  it("returns fewer picks for a clip too short to hold them", () => {
    expect(pickSharpest([0, 0.2, 0.4], [1, 2, 3], 30, 1.0)).toHaveLength(1);
  });
});

describe("sharpness (variance of the Laplacian on grey pixels)", () => {
  const image = (w: number, h: number, at: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = at(x, y); data.set([v, v, v, 255], (y * w + x) * 4); }
    return { data, width: w, height: h };
  };

  it("scores a flat image 0 and a detailed one far higher", () => {
    expect(sharpness(image(40, 30, () => 128))).toBe(0);
    expect(sharpness(image(40, 30, (x, y) => ((x + y) % 2 ? 255 : 0)))).toBeGreaterThan(1000);
  });

  it("scores a soft gradient lower than hard edges", () => {
    const soft = sharpness(image(40, 30, (x) => x * 6));
    const hard = sharpness(image(40, 30, (x) => (x % 8 < 4 ? 0 : 255)));
    expect(soft).toBeLessThan(hard);
  });
});

describe("blur boxes (same padding and coverage as tools/prepare)", () => {
  it("pads a box by 15% of its size and clamps it to the image", () => {
    expect(padBox({ x1: 100, y1: 50, x2: 200, y2: 100 }, 400, 300)).toEqual({ x1: 85, y1: 42, x2: 215, y2: 108 });
    expect(padBox({ x1: 0, y1: 0, x2: 200, y2: 100 }, 200, 100)).toEqual({ x1: 0, y1: 0, x2: 200, y2: 100 });
  });

  it("measures covered area as a union, never counting an overlap twice", () => {
    expect(coverage([{ x1: 0, y1: 0, x2: 50, y2: 100 }, { x1: 0, y1: 0, x2: 50, y2: 100 }], 100, 100)).toBeCloseTo(0.5);
    expect(coverage([{ x1: 0, y1: 0, x2: 50, y2: 50 }, { x1: 25, y1: 0, x2: 75, y2: 50 }], 100, 100)).toBeCloseTo(0.375);
  });

  it("rescales SAM's boxes from the size it saw to the frame's size", () => {
    expect(scaleBoxes([{ x1: 10, y1: 20, x2: 30, y2: 40 }], 100, 200, 300, 600)).toEqual([{ x1: 30, y1: 60, x2: 90, y2: 120 }]);
  });
});

describe("the replay's note on how the frames were made", () => {
  const f = { frames: 30, narration: true, photos: 4 };
  it("says labels were blurred only when they were", () => {
    expect(footageNote({ ...f, source: "prepared", blurred: true }).text).toBe("Faces, labels and logos were blurred before upload.");
    const logos = footageNote({ ...f, source: "prepared", blurred: false });
    expect(logos.label).toBe("Filmed, logos blurred on the engineer's computer");
    expect(logos.text).toBe("Only faces and equipment logos were blurred before upload; the room is shown as filmed.");
  });
});

describe("the live frame strip", () => {
  it("outlines what SAM 3.1 found on each frame and counts it, so the blurring is visible as it happens", () => {
    const box = { x1: 10, y1: 20, x2: 60, y2: 40 };
    const html = renderToStaticMarkup(createElement(FrameStrip, { items: [
      { key: "a", src: "blob:a", n: 1, found: { w: 478, h: 850, boxes: [box, box] } },
      { key: "b", src: "blob:b", n: 2, found: { w: 478, h: 850, boxes: [] } },
    ] }));
    expect(html.match(/<rect /g)).toHaveLength(2);
    expect(html).toContain('viewBox="0 0 478 850"');
    expect(html).toContain("1 · 2");
    expect(html).not.toContain("2 · 0");
  });
});

describe("narration waveform", () => {
  it("keeps the loudest sample of each bucket, so a short loud word still shows", () => {
    expect(peaks(new Float32Array([0, 0.1, -0.9, 0.2, 0, 0, 0.3, -0.4]), 4)).toEqual([0.1, 0.9, 0, 0.4].map((v) => Math.fround(v)));
    expect(peaks(new Float32Array(3), 10)).toHaveLength(3); // fewer samples than bars: one bar per sample
  });
});
