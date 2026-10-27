// Room inventory draft from key frames + SAM facts (Muse Spark Open, falling back to Spark 1.3).
// Positions are rough on purpose: the engineer corrects them in the layout step.
import { z } from "zod";
import type { SamSummary } from "../vision/sam-summary";

const Item = z.object({
  kind: z.enum(["rack", "ac", "door", "panel", "column", "ladder"]),
  label: z.string().max(20),
  x_tiles: z.number().min(0).max(200),
  y_tiles: z.number().min(0).max(200),
  w_tiles: z.number().positive().max(200).nullish(),
  d_tiles: z.number().positive().max(200).nullish(),
  facing: z.enum(["north", "south", "east", "west"]).nullish(),
  contents: z.enum(["active", "passive", "empty", "unknown"]).nullish(),
  frames: z.array(z.number().int()).max(30).default([]),
  notes: z.string().max(300).nullish(),
});
export const Inventory = z.object({
  room: z.object({ w_tiles: z.number().int().min(2).max(200), d_tiles: z.number().int().min(2).max(200), confidence: z.enum(["low", "medium", "high"]) }),
  items: z.array(Item).max(80),
  observations: z.array(z.object({ rule: z.enum(["R1", "R2"]), text: z.string().max(300), frames: z.array(z.number().int()).max(30).default([]) })).max(20).default([]),
  notes: z.string().max(600).default(""),
});
export type Inventory = z.infer<typeof Inventory>;

export function inventoryPrompt(summary: SamSummary, frameNumbers: number[]) {
  return (
    `You are drafting the inventory of a telecom equipment room for a site survey. The images are key frames ` +
    `${frameNumbers.map((n) => `F${n}`).join(", ")} of one walk-through, in order. The footage is anonymised: blurred ` +
    `patches are labels, logos and papers, not damage. Raised-floor tiles are 600 x 600 mm; a standard rack is about ` +
    `1 tile wide and 1.7 tiles deep. SAM 3.1 detections per frame (data): ${JSON.stringify(summary.per_frame)}; ` +
    `floor tiles found on ${Math.round(summary.tile_grid_ratio * 100)}% of frames.\n` +
    `List every rack, A/C unit, door, power panel, column and overhead cable ladder you can see, each once even if it ` +
    `appears in several frames. Place them on a tile grid: origin at the corner left of the entrance door, x along the ` +
    `door wall, y into the room. Estimate the room size in tiles. Note leftover materials (R1) and untidy cables (R2). ` +
    `Keep every note under 100 characters. ` +
    `Reply with only JSON: {"room": {"w_tiles": int, "d_tiles": int, "confidence": "low"|"medium"|"high"}, ` +
    `"items": [{"kind": "rack"|"ac"|"door"|"panel"|"column"|"ladder", "label": "R1", "x_tiles": number, ` +
    `"y_tiles": number, "w_tiles": number, "d_tiles": number, "facing": "north"|"south"|"east"|"west"|null, ` +
    `"contents": "active"|"passive"|"empty"|"unknown"|null, "frames": [frame numbers], "notes": string}], ` +
    `"observations": [{"rule": "R1"|"R2", "text": string, "frames": [frame numbers]}], "notes": string}`
  );
}
