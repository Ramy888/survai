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
export type Shape =
  | { type: "rect"; kind: string; label: string; x: number; y: number; w: number; d: number; facing: string | null; hatched?: "reserved" | "off_limits"; target?: boolean }
  | { type: "door"; label: string; x: number; y: number; w: number; d: number; side: string; swing: number }
  | { type: "ladder"; label: string; x: number; y: number; w: number; d: number }
  | { type: "path"; label: string; cable_type: string; route: string; points: [number, number][] }
  | { type: "arrow"; from: [number, number]; at: [number, number]; label: string };

export function buildPlan(i: PlanInput): { w: number; d: number; shapes: Shape[] } {
  const shapes: Shape[] = [];
  for (const it of i.items) {
    const base = { label: it.label ?? it.kind, x: it.x, y: it.y, w: it.w ?? 1, d: it.d ?? 1 };
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
        ...(it.kind === "reserved" ? { hatched: "reserved" as const } : it.props.off_limits ? { hatched: "off_limits" as const } : {}),
        ...(it.props.is_target ? { target: true } : {}),
      });
    }
  }
  for (const c of i.clearances) shapes.push({ type: "arrow", from: c.from, at: c.at, label: `${c.m} m` });
  const w = i.size?.w ?? Math.ceil(Math.max(4, ...i.items.map((it) => it.x + (it.w ?? 1))) + 1);
  const d = i.size?.d ?? Math.ceil(Math.max(4, ...i.items.map((it) => it.y + (it.d ?? 1))) + 1);
  return { w, d, shapes };
}
