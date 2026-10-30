// Calculated rules: run in code before the agents meet. A failing result forces an objection for the owning
// department; `pass: null` means an input is missing and becomes a question instead.
// Units: 1 tile = 0.6 m, positions in tiles; 1 W = 3.412 BTU/h.
export const TILE_M = 0.6;
const BTU_PER_W = 3.412;
const UNDERFLOOR_DROP_M = 0.5;
const SLACK = 1.1;

export interface Calc<R = Record<string, unknown>> {
  rule: string;
  inputs: Record<string, unknown>;
  result: R;
  pass: boolean | null;
}
export interface Rect { label: string; x: number; y: number; w: number; d: number }
export interface Block { from_u: number; to_u: number } // inclusive
export interface Breaker { position: number | null; dc: boolean | null; rating_a: number | null; free: boolean }
export type Point = [number, number];
export interface CablePath { label: string; cable_type: "power" | "data" | "fibre"; route: "overhead" | "underfloor"; points: Point[] }

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const unknown = (rule: string, inputs: Record<string, unknown>, missing: string[]): Calc => ({ rule, inputs, result: { missing }, pass: null });

export const heatLoad = (powerW: number, quantity: number) => r1(powerW * BTU_PER_W * quantity);

// shortcut: an assumed design heat density for a small equipment room, not a measured A/C capacity; set it per operator
export const ROOM_W_PER_M2 = 500;

/** R10: the added heat against the spare A/C capacity when one is known; otherwise against the room's floor area
 * (its size in 600 mm tiles, measured from the frames) at an assumed design density. */
export function r10Cooling(i: { power_w: number; quantity: number; spare_ac_btu: number | null; room_tiles?: { w: number; d: number } | null }): Calc {
  if (i.spare_ac_btu == null) {
    if (!i.room_tiles) return unknown("R10", i, ["spare_ac_btu"]);
    const roomM2 = r1(i.room_tiles.w * i.room_tiles.d * TILE_M * TILE_M);
    const density = r1((i.power_w * i.quantity) / roomM2);
    return { rule: "R10", inputs: i, pass: density <= ROOM_W_PER_M2, result: { heat_btu: heatLoad(i.power_w, i.quantity), heat_w: i.power_w * i.quantity, room_m2: roomM2, w_per_m2: density, limit_w_per_m2: ROOM_W_PER_M2 } };
  }
  const heat = heatLoad(i.power_w, i.quantity);
  const pass = heat <= i.spare_ac_btu;
  return { rule: "R10", inputs: i, pass, result: { heat_btu: heat, spare_btu: i.spare_ac_btu, ...(pass ? {} : { over_btu: r1(heat - i.spare_ac_btu) }) } };
}

/** The largest contiguous free block; touching or overlapping blocks merge. */
export function contiguousFree(blocks: Block[]): (Block & { units: number }) | null {
  const sorted = [...blocks].sort((a, b) => a.from_u - b.from_u);
  let best: Block | null = null;
  let cur: Block | null = null;
  for (const b of sorted) {
    cur = cur && b.from_u <= cur.to_u + 1 ? { from_u: cur.from_u, to_u: Math.max(cur.to_u, b.to_u) } : { ...b };
    if (!best || cur.to_u - cur.from_u > best.to_u - best.from_u) best = cur;
  }
  return best && { ...best, units: best.to_u - best.from_u + 1 };
}

export function r8FreeU(i: { height_u: number; quantity: number; rack: { label: string; free_blocks: Block[] } | null }): Calc {
  if (!i.rack) return unknown("R8", i, ["target_rack"]);
  // A 3.5U device takes 4U of rack space; 2U stay clear above it.
  const needed = Math.ceil(i.height_u) * i.quantity + 2;
  const block = contiguousFree(i.rack.free_blocks);
  return { rule: "R8", inputs: i, pass: !!block && block.units >= needed, result: { needed_u: needed, block, rack: i.rack.label } };
}

export function r11Breakers(i: { feed_type: "AC" | "DC"; feed_count: number; quantity: number; breaker_rating_a: number | null; breakers: Breaker[] | null }): Calc {
  if (!i.breakers) return unknown("R11", i, ["breakers_confirmed"]);
  const needed = i.feed_count * i.quantity;
  const matching = i.breakers.filter((b) => b.free && b.dc === (i.feed_type === "DC") &&
    (i.breaker_rating_a == null || (b.rating_a ?? 0) >= i.breaker_rating_a)).length;
  return { rule: "R11", inputs: i, pass: matching >= needed, result: { needed, matching } };
}

export function cableLength(i: { points: Point[]; route: "overhead" | "underfloor"; ladder_height_m?: number | null; rack_top_m?: number; inter_room_m?: number | null }) {
  const run = r2(i.points.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - i.points[k][0], p[1] - i.points[k][1]), 0) * TILE_M);
  if (i.route === "overhead" && i.ladder_height_m == null) return { length_m: null, run_m: run, drops_m: null, missing: ["ladder_height_m"] };
  const drops = r2(i.route === "overhead" ? Math.max(0, i.ladder_height_m! - (i.rack_top_m ?? 2.0)) * 2 : UNDERFLOOR_DROP_M * 2);
  const total = (run + drops + (i.inter_room_m ?? 0)) * SLACK;
  return { length_m: Math.ceil(total - 1e-9), run_m: run, drops_m: drops, missing: [] as string[] };
}

const overlaps = (a: { x0: number; x1: number; y0: number; y1: number }, b: Rect) =>
  a.x0 < b.x + b.w && b.x < a.x1 && a.y0 < b.y + b.d && b.y < a.y1;

export function r6DoorSwing(i: { door: Rect & { swing_m?: number; side?: "north" | "south" | "east" | "west" | null }; items: (Rect & { kind: string })[] }): Calc {
  const d = i.door;
  const s = (d.swing_m ?? 0.9) / TILE_M;
  const zone = {
    south: { x0: d.x, x1: d.x + d.w, y0: d.y + d.d, y1: d.y + d.d + s },
    north: { x0: d.x, x1: d.x + d.w, y0: d.y - s, y1: d.y },
    east: { x0: d.x + d.w, x1: d.x + d.w + s, y0: d.y, y1: d.y + d.d },
    west: { x0: d.x - s, x1: d.x, y0: d.y, y1: d.y + d.d },
  }[d.side ?? "south"]; // the door wall is y = 0 by convention, so it opens into +y
  // Overhead ladders and cable paths do not block a door; floor items do.
  const blocking = i.items.filter((it) => !["ladder", "cable_path", "door"].includes(it.kind) && overlaps(zone, it)).map((it) => it.label);
  return { rule: "R6", inputs: { door: d.label, swing_m: d.swing_m ?? 0.9, side: d.side ?? "south" }, pass: blocking.length === 0, result: { blocking, zone } };
}

const PARALLEL = 0.05; // sine of the angle between segments
const SAME_TRAY_TILES = 0.3; // closer than this is the same tray
const MIN_OVERLAP_TILES = 0.5;

/** Length (tiles) over which segment b runs alongside segment a, or 0. */
function alongside(a: [Point, Point], b: [Point, Point]) {
  const [ax, ay] = [a[1][0] - a[0][0], a[1][1] - a[0][1]];
  const [bx, by] = [b[1][0] - b[0][0], b[1][1] - b[0][1]];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (!la || !lb || Math.abs(ax * by - ay * bx) / (la * lb) > PARALLEL) return 0;
  const dist = Math.abs(ax * (b[0][1] - a[0][1]) - ay * (b[0][0] - a[0][0])) / la;
  if (dist > SAME_TRAY_TILES) return 0;
  const t = (p: Point) => ((p[0] - a[0][0]) * ax + (p[1] - a[0][1]) * ay) / la;
  const [t0, t1] = [t(b[0]), t(b[1])].sort((m, n) => m - n);
  return Math.max(0, Math.min(la, t1) - Math.max(0, t0));
}

export function r3PowerSeparation(paths: CablePath[]): Calc {
  const segs = (p: CablePath) => p.points.slice(1).map((q, k) => [p.points[k], q] as [Point, Point]);
  const shared: { power: string; other: string; route: string; overlap_m: number }[] = [];
  for (const power of paths.filter((p) => p.cable_type === "power")) {
    for (const other of paths.filter((p) => p.cable_type !== "power" && p.route === power.route)) {
      const tiles = segs(power).reduce((s, a) => s + segs(other).reduce((t, b) => t + alongside(a, b), 0), 0);
      if (tiles > MIN_OVERLAP_TILES) shared.push({ power: power.label, other: other.label, route: power.route, overlap_m: r2(tiles * TILE_M) });
    }
  }
  return { rule: "R3", inputs: { paths: paths.map((p) => ({ label: p.label, cable_type: p.cable_type, route: p.route })) }, pass: shared.length === 0, result: { shared } };
}

/** Closest points between two rectangles (mid-overlap on an axis where they overlap) and the gap in tiles. */
function gap(a: Rect, b: Rect) {
  const axis = (a0: number, a1: number, b0: number, b1: number): [number, number] =>
    a1 < b0 ? [a1, b0] : b1 < a0 ? [a0, b1] : [(Math.max(a0, b0) + Math.min(a1, b1)) / 2, (Math.max(a0, b0) + Math.min(a1, b1)) / 2];
  const [fx, ax] = axis(a.x, a.x + a.w, b.x, b.x + b.w);
  const [fy, ay] = axis(a.y, a.y + a.d, b.y, b.y + b.d);
  return { from: [r2(fx), r2(fy)] as Point, at: [r2(ax), r2(ay)] as Point, tiles: Math.hypot(ax - fx, ay - fy) };
}

/** Arrows from the reserved area to the nearest rack, the nearest wall and the door (metres, edge to edge). */
export function clearances(i: { reserved: Rect; room: { w: number; d: number }; racks: Rect[]; door: Rect | null }) {
  const r = i.reserved;
  const out: { to: string; m: number; from: Point; at: Point }[] = [];
  const nearest = i.racks.map((k) => ({ k, g: gap(r, k) })).sort((p, q) => p.g.tiles - q.g.tiles)[0];
  if (nearest) out.push({ to: `rack ${nearest.k.label}`, m: r2(nearest.g.tiles * TILE_M), from: nearest.g.from, at: nearest.g.at });
  const midY = r2(r.y + r.d / 2);
  const midX = r2(r.x + r.w / 2);
  const walls = [
    { tiles: r.x, from: [r.x, midY] as Point, at: [0, midY] as Point },
    { tiles: i.room.w - (r.x + r.w), from: [r.x + r.w, midY] as Point, at: [i.room.w, midY] as Point },
    { tiles: r.y, from: [midX, r.y] as Point, at: [midX, 0] as Point },
    { tiles: i.room.d - (r.y + r.d), from: [midX, r.y + r.d] as Point, at: [midX, i.room.d] as Point },
  ];
  const wall = walls.reduce((m, w) => (w.tiles < m.tiles ? w : m));
  out.push({ to: "wall", m: r2(wall.tiles * TILE_M), from: wall.from, at: wall.at });
  if (i.door) {
    const g = gap(r, i.door);
    out.push({ to: `door ${i.door.label}`, m: r2(g.tiles * TILE_M), from: g.from, at: g.at });
  }
  return out;
}

type Zone = { x0: number; x1: number; y0: number; y1: number };
const zoneOf = (r: Rect): Zone => ({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.d });
const hits = (a: Zone, b: Zone) => a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6;
const FRONT_CLEAR_TILES = 2; // 1.2 m in front of a rack stays free to work and to pass
const SWING_TILES = 0.9 / TILE_M;

/** The space in front of a rack, where people work and pass. */
function frontZone(z: Zone, facing: string | null | undefined): Zone {
  switch (facing ?? "east") {
    case "west": return { ...z, x0: z.x0 - FRONT_CLEAR_TILES, x1: z.x0 };
    case "north": return { ...z, y0: z.y0 - FRONT_CLEAR_TILES, y1: z.y0 };
    case "south": return { ...z, y0: z.y1, y1: z.y1 + FRONT_CLEAR_TILES };
    default: return { ...z, x0: z.x1, x1: z.x1 + FRONT_CLEAR_TILES };
  }
}

/** A door and the floor it swings over, into the room from the wall it sits on. */
function doorZone(d: Rect, room: { w: number; d: number }): Zone {
  const z = zoneOf(d);
  if (z.y0 <= 0.5) return { ...z, y1: z.y1 + SWING_TILES };
  if (z.y1 >= room.d - 0.5) return { ...z, y0: z.y0 - SWING_TILES };
  if (z.x0 <= 0.5) return { ...z, x1: z.x1 + SWING_TILES };
  if (z.x1 >= room.w - 0.5) return { ...z, x0: z.x0 - SWING_TILES };
  return { x0: z.x0 - SWING_TILES, x1: z.x1 + SWING_TILES, y0: z.y0 - SWING_TILES, y1: z.y1 + SWING_TILES };
}

/**
 * Where a new rack (80 x 80 cm by default) fits: beside an existing rack in its row, front flush and facing the same
 * way (R4, R5), not on anything on the floor, not in a door's swing, with 1.2 m clear in front of it, and outside the
 * working space in front of every other rack, so no aisle is blocked. Overhead ladders and cable paths don't count.
 */
export function rackSpots(i: { room: { w: number; d: number }; items: (Rect & { kind: string; facing?: string | null })[]; size_m?: number; max?: number }) {
  const s = (i.size_m ?? 0.8) / TILE_M;
  const floor = i.items.filter((it) => !["ladder", "cable_path"].includes(it.kind));
  const racks = floor.filter((it) => it.kind === "rack" || it.kind === "reserved");
  const blocked = [
    ...floor.filter((it) => it.kind !== "door").map(zoneOf),
    ...floor.filter((it) => it.kind === "door").map((d) => doorZone(d, i.room)),
    ...racks.map((r) => frontZone(zoneOf(r), r.facing)),
  ];
  const inRoom = (z: Zone) => z.x0 >= -1e-6 && z.y0 >= -1e-6 && z.x1 <= i.room.w + 1e-6 && z.y1 <= i.room.d + 1e-6;
  const out: { x: number; y: number; w: number; d: number; facing: string; next_to: string }[] = [];
  for (const r of racks) {
    const f = r.facing ?? "east";
    // Front flush with the rack, one rack-width along the row on either side.
    const along = f === "east" || f === "west"
      ? [r.y - s, r.y + r.d].map((y) => ({ x: f === "east" ? r.x + r.w - s : r.x, y }))
      : [r.x - s, r.x + r.w].map((x) => ({ x, y: f === "south" ? r.y + r.d - s : r.y }));
    for (const p of along) {
      const z = { x0: p.x, x1: p.x + s, y0: p.y, y1: p.y + s };
      const front = frontZone(z, f);
      if (!inRoom(z) || !inRoom(front) || blocked.some((b) => hits(z, b) || hits(front, b))) continue;
      if (out.some((o) => hits(z, { x0: o.x, x1: o.x + o.w, y0: o.y, y1: o.y + o.d }))) continue; // one spot per gap
      out.push({ x: r2(p.x), y: r2(p.y), w: r2(s), d: r2(s), facing: f, next_to: r.label });
    }
  }
  return out.slice(0, i.max ?? 3);
}
