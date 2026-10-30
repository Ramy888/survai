// Floor-plan geometry from layout items and the round's calculations, in tiles (600 mm). Pure, so the labels can be
// tested against the calculations; FloorPlan.tsx only draws these shapes.
export interface PlanItem {
  id: string; kind: string; label: string | null; x: number; y: number; w: number | null; d: number | null;
  facing: string | null; props: Record<string, unknown>; source: string;
}
export interface PlanInput {
  size: { w: number; d: number } | null;
  items: PlanItem[];
  lengths: Record<string, number | null>; // cable path label -> length (m) from its LEN calculation
  clearances: { to: string; m: number; from: [number, number]; at: [number, number] }[];
}
type Box = { id: string; fixed: boolean; label: string; x: number; y: number; w: number; d: number }; // fixed: the Survey Lead's, not the engineer's to move
export type Shape =
  | Box & { type: "rect"; kind: string; facing: string | null; hatched?: "reserved" | "off_limits" | "spot"; target?: boolean }
  | Box & { type: "door"; side: string; swing: number }
  | Box & { type: "ladder" }
  | { type: "path"; label: string; cable_type: string; route: string; points: [number, number][] }
  | { type: "arrow"; from: [number, number]; at: [number, number]; label: string };

export function buildPlan(i: PlanInput): { w: number; d: number; shapes: Shape[] } {
  const shapes: Shape[] = [];
  for (const it of i.items) {
    const base = { id: it.id, fixed: it.source === "lead", label: it.label ?? it.kind, x: it.x, y: it.y, w: it.w ?? 1, d: it.d ?? 1 };
    if (it.kind === "cable_path") {
      const len = i.lengths[it.label ?? ""];
      const type = String(it.props.cable_type ?? "cable");
      shapes.push({ type: "path", label: `${type} · ${len == null ? "length unknown" : `${len} m`}`, cable_type: type, route: String(it.props.route ?? "overhead"), points: (it.props.points as [number, number][]) ?? [] });
    } else if (it.kind === "door") {
      shapes.push({ type: "door", ...base, side: String(it.props.side ?? (it.y <= 0.3 ? "south" : "north")), swing: Number(it.props.swing_m ?? 0.9) / 0.6 });
    } else if (it.kind === "ladder") {
      shapes.push({ type: "ladder", ...base });
    } else {
      shapes.push({
        type: "rect", kind: it.kind, ...base, facing: it.facing,
        ...(it.kind === "reserved" ? { hatched: "reserved" as const } : it.kind === "spot" ? { hatched: "spot" as const } : it.props.off_limits ? { hatched: "off_limits" as const } : {}),
        ...(it.props.is_target ? { target: true } : {}),
      });
    }
  }
  for (const c of i.clearances) shapes.push({ type: "arrow", from: c.from, at: c.at, label: `${c.m} m` });
  const w = i.size?.w ?? Math.ceil(Math.max(4, ...i.items.map((it) => it.x + (it.w ?? 1))) + 1);
  const d = i.size?.d ?? Math.ceil(Math.max(4, ...i.items.map((it) => it.y + (it.d ?? 1))) + 1);
  return { w, d, shapes };
}

/** Where a dragged item lands: moved by the pointer's offset in tiles, snapped to a tenth of a tile, kept in the room. */
export function dragTo(at: { x: number; y: number }, by: { dx: number; dy: number }, size: { w: number; d: number }, room: { w: number; d: number }) {
  const place = (v: number, len: number, max: number) => Math.round(Math.min(Math.max(0, max - len), Math.max(0, v)) * 10) / 10;
  return { x: place(at.x + by.dx, size.w, room.w), y: place(at.y + by.dy, size.d, room.d) };
}

const CLOCKWISE: Record<string, string> = { north: "east", east: "south", south: "west", west: "north" };
/** An item turned a quarter clockwise about its centre (front included), snapped to a tenth of a tile, never past the wall at 0. */
export function turned(i: { x_tiles: number; y_tiles: number; w_tiles: number | null; d_tiles: number | null; facing: string | null }) {
  const w = i.w_tiles ?? 1, d = i.d_tiles ?? 1;
  const snap = (v: number) => Math.max(0, Math.round(v * 10 + 1e-9) / 10);
  return { x_tiles: snap(i.x_tiles + (w - d) / 2), y_tiles: snap(i.y_tiles + (d - w) / 2), w_tiles: d, d_tiles: w, facing: i.facing ? CLOCKWISE[i.facing] ?? i.facing : i.facing };
}
