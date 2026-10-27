// Facts from SAM 3.1 boxes across key frames, given to the inventory model and kept as evidence.
import type { SamBox } from "../clients/models";

export interface FrameBoxes {
  fileId: string;
  n: number; // frame number in walk-through order, 1-based
  width: number;
  height: number;
  tiles: SamBox[];
  racks: SamBox[];
}

export interface SamSummary {
  frames: number;
  tile_grid_ratio: number; // share of frames where SAM found at least 3 floor tiles (AC 2: >= 0.8)
  median_tile_px: number | null; // width of the nearest tiles, a scale hint
  max_racks_in_frame: number;
  rack_frames: number[]; // frame numbers with at least one rack
  per_frame: { n: number; tiles: number; racks: number }[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function summarizeSam(frames: FrameBoxes[]): SamSummary {
  // The nearest tiles sit lowest in the frame; their widths say how big a 600 mm tile looks up close.
  const nearWidths = frames.flatMap((f) =>
    f.tiles.filter((t) => t.y2 > f.height * 0.75).map((t) => t.x2 - t.x1 + 1),
  );
  return {
    frames: frames.length,
    tile_grid_ratio: frames.length ? Number((frames.filter((f) => f.tiles.length >= 3).length / frames.length).toFixed(2)) : 0,
    median_tile_px: median(nearWidths),
    max_racks_in_frame: Math.max(0, ...frames.map((f) => f.racks.length)),
    rack_frames: frames.filter((f) => f.racks.length).map((f) => f.n),
    per_frame: frames.map((f) => ({ n: f.n, tiles: f.tiles.length, racks: f.racks.length })),
  };
}
