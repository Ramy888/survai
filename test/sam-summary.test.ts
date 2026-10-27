// protects: the SAM facts handed to the inventory model and AC 2's tile-grid ratio; fails_when: frames with fewer
// than 3 tiles count as grid frames, the scale hint uses far tiles, or rack frames are misnumbered; no_claim: SAM
// accuracy itself.
import { describe, expect, it } from "vitest";
import { summarizeSam } from "../worker/vision/sam-summary";

const box = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
const tiles = (n: number, y = 800) => Array.from({ length: n }, (_, i) => box(i * 100, y, i * 100 + 89, y + 40));

describe("summarizeSam", () => {
  it("counts grid frames, the near-tile scale and rack frames", () => {
    const s = summarizeSam([
      { fileId: "a", n: 1, width: 478, height: 850, tiles: tiles(4), racks: [box(10, 100, 200, 600)] },
      { fileId: "b", n: 2, width: 478, height: 850, tiles: tiles(2), racks: [] },
      { fileId: "c", n: 3, width: 478, height: 850, tiles: [...tiles(3), box(0, 300, 29, 320)], racks: [box(0, 0, 1, 1), box(2, 2, 3, 3)] },
      { fileId: "d", n: 4, width: 478, height: 850, tiles: tiles(5), racks: [] },
    ]);
    expect(s.tile_grid_ratio).toBe(0.75);
    expect(s.median_tile_px).toBe(90); // the far 30 px tile at y=300 is ignored
    expect(s.rack_frames).toEqual([1, 3]);
    expect(s.max_racks_in_frame).toBe(2);
  });

  it("handles no frames and no detections", () => {
    expect(summarizeSam([])).toMatchObject({ frames: 0, tile_grid_ratio: 0, median_tile_px: null, max_racks_in_frame: 0 });
  });
});
