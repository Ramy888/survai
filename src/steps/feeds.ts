// What feeds the meeting: each value the department agents start from, where it came from (the frames, the narration,
// the datasheet, the panel photos), and whether the engineer changed it. Pure, so the layout step and the public
// replay say the same thing.
import { TILE_M } from "../../worker/calc";

export type FeedSource = "frames" | "sam" | "narration" | "datasheet" | "panel" | "engineer" | "assumed" | "missing";
export interface FeedRow { key: string; label: string; value: string; source: FeedSource; note?: string }

type Block = { from_u: number; to_u: number };
export interface FeedInput {
  device: { model: string; quantity: number; height_u: number; power_w: number; feed_type: string; feed_count: number; breaker_rating_a: number | null; connectors?: string | null; interfaces?: string | null } | null;
  request: { source?: string; route?: string; cables?: string[] } | null;
  target: { label: string; free: Block[]; samFrame: number | null; edited: boolean } | null;
  spots: number; // free floor spots for a new 80 x 80 cm rack
  room: { w: number; d: number; edited: boolean } | null;
  spareAcBtu: number | null;
  ladder: { m: number | null; assumed: boolean };
  breakers: { seen: number; free: number; rated: number; edited: boolean };
  observations: string[];
}

const blocks = (b: Block[]) => b.map((x) => (x.from_u === x.to_u ? `U${x.from_u}` : `U${x.from_u}–U${x.to_u}`)).join(", ");
const units = (b: Block[]) => Math.max(0, ...b.map((x) => x.to_u - x.from_u + 1));

export function feedRows(i: FeedInput): FeedRow[] {
  const rows: FeedRow[] = [];
  const d = i.device;
  const q = d?.quantity ?? 1;
  const need = d ? d.height_u * q : 0;
  if (i.target) {
    const free = units(i.target.free);
    rows.push(i.target.free.length
      ? { key: "space", label: "Space for the device", value: `Yes: ${i.target.label} has ${blocks(i.target.free)} free (${free}U)${d ? `, the ${d.model} needs ${need + 2}U with 2U clearance` : ""}`,
        source: i.target.edited ? "engineer" : "sam", note: !i.target.edited && i.target.samFrame != null ? `the gap below its devices, frame ${i.target.samFrame}` : undefined }
      : { key: "space", label: "Space for the device", value: `No free units known in ${i.target.label}${i.spots ? `; ${i.spots} free floor spot${i.spots > 1 ? "s" : ""} for a new rack` : ""}`, source: "missing" });
  } else {
    rows.push({ key: "space", label: "Space for the device", value: i.spots ? `No target rack; ${i.spots} free floor spot${i.spots > 1 ? "s" : ""} for a new rack` : "No target rack and no free floor spot", source: i.spots ? "frames" : "missing" });
  }
  if (i.request?.source) rows.push({ key: "where", label: "Where it goes", value: i.request.source, source: "narration" });
  if (d) rows.push({ key: "device", label: "The device", value: [`${d.model}: ${d.height_u}U`, `${d.power_w} W`, `${d.feed_count} × ${d.feed_type} feeds${d.breaker_rating_a ? ` on ${d.breaker_rating_a} A breakers` : ""}`, d.connectors && `${d.connectors} fibre`].filter(Boolean).join(" · "), source: "datasheet" });
  if (!i.breakers.seen && !i.breakers.edited) rows.push({ key: "power", label: "Breakers", value: "No panel photo: enter the free breakers in the layout step", source: "missing" });
  else rows.push({ key: "power", label: "Breakers", value: `${i.breakers.seen} seen, ${i.breakers.free} free; ${i.breakers.rated ? `${i.breakers.rated} with a known rating` : "ratings hidden by the blur, confirm on site"}`, source: i.breakers.edited ? "engineer" : "panel" });
  if (i.spareAcBtu != null) rows.push({ key: "cooling", label: "Cooling", value: `Spare A/C ${i.spareAcBtu} BTU/h`, source: "engineer" });
  else if (i.room && d) {
    const m2 = Math.round(i.room.w * i.room.d * TILE_M * TILE_M * 10) / 10;
    const per = Math.round(((d.power_w * q) / m2) * 10) / 10;
    rows.push({ key: "cooling", label: "Cooling", value: `Room ${(i.room.w * TILE_M).toFixed(1)} × ${(i.room.d * TILE_M).toFixed(1)} m (${m2} m²): the device adds ${per} W per m²`, source: i.room.edited ? "engineer" : "sam", note: i.room.edited ? undefined : "measured on the 600 mm floor tiles" });
  } else rows.push({ key: "cooling", label: "Cooling", value: "No room size or spare A/C capacity yet", source: "missing" });
  if (i.request?.route) rows.push({ key: "route", label: "Cable route", value: [i.request.route, i.request.cables?.length ? i.request.cables.join(", ") : ""].filter(Boolean).join(" · "), source: "narration" });
  rows.push({ key: "ladder", label: "Ladder height", value: i.ladder.m == null ? "unknown" : `${i.ladder.m} m`, source: i.ladder.m == null ? "missing" : i.ladder.assumed ? "assumed" : "engineer" });
  if (i.observations.length) rows.push({ key: "room", label: "Housekeeping", value: i.observations.join(" · "), source: "frames" });
  return rows;
}
