// Facts from SAM 3.1 boxes across key frames, given to the inventory model and kept as evidence.
import type { SamBox } from "../clients/models";

export interface FrameBoxes {
  fileId: string;
  n: number; // frame number in walk-through order, 1-based
  width: number;
  height: number;
  tiles: SamBox[];
  racks: SamBox[];
  devices?: SamBox[]; // "electronic device": routers and switches mounted in the racks
  shelves?: SamBox[];
}

export interface SamSummary {
  frames: number;
  tile_grid_ratio: number; // share of frames where SAM found at least 3 floor tiles (AC 2: >= 0.8)
  median_tile_px: number | null; // width of the nearest tiles, a scale hint
  max_racks_in_frame: number;
  rack_frames: number[]; // frame numbers with at least one rack
  per_frame: { n: number; tiles: number; racks: number; devices: number }[];
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
    per_frame: frames.map((f) => ({ n: f.n, tiles: f.tiles.length, racks: f.racks.length, devices: f.devices?.length ?? 0 })),
  };
}

const RACK_U = 42; // a full-height rack, the scale for turning pixels into rack units

/**
 * The empty space in a rack, estimated from SAM's boxes: the largest gap below a device (to the next device or the
 * rack's bottom), in U with the rack's box as 42U, U1 at the bottom. Taken from the frame with the most devices inside
 * a rack. An estimate for the engineer to confirm: camera angle and a cropped rack skew it.
 */
export function estimateFreeU(frames: FrameBoxes[], only?: number[]) {
  let best: { frame: number; from_u: number; to_u: number; devices: number; height: number } | null = null;
  for (const f of frames.filter((x) => !only?.length || only.includes(x.n))) {
    for (const r of f.racks) {
      const inside = (f.devices ?? []).filter((d) => {
        const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
        return cx > r.x1 && cx < r.x2 && cy > r.y1 && cy < r.y2;
      }).sort((a, b) => a.y1 - b.y1);
      if (!inside.length) continue;
      const u = (r.y2 - r.y1) / RACK_U;
      let gap = { top: 0, bottom: 0 };
      inside.forEach((d, k) => {
        const bottom = inside[k + 1]?.y1 ?? r.y2;
        if (bottom - d.y2 > gap.bottom - gap.top) gap = { top: d.y2, bottom };
      });
      const from_u = Math.floor((r.y2 - gap.bottom) / u) + 1;
      const to_u = Math.floor((r.y2 - gap.top) / u);
      const better = !best || inside.length > best.devices || (inside.length === best.devices && r.y2 - r.y1 > best.height);
      if (to_u >= from_u && better) best = { frame: f.n, from_u, to_u, devices: inside.length, height: r.y2 - r.y1 };
    }
  }
  return best && { frame: best.frame, from_u: best.from_u, to_u: best.to_u, devices: best.devices };
}
