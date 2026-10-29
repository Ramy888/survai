// protects: the in-app walk-through picks frames exactly like tools/prepare (cases ported from
// tools/prepare/test_prepare.py) and scores sharpness the same way; fails_when: picks bunch up, break the 1 s gap,
// ignore a segment's sharpest frame, or a flat image scores as sharp; no_claim: video decoding in a real browser
// (checked end to end with headless Chrome).
// Type-checked with the app (browser) config, not the Worker one.
import { describe, expect, it } from "vitest";
import { pickSharpest, sharpness } from "../src/footage/pick";

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
